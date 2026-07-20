"""
认证中间件 — ASGI 中间件，统一拦截 HTTP API 和 WebSocket 请求进行 Token 鉴权。

Token 来源：
- HTTP / WebSocket 通用: X-Maxma-Token 请求头
- WebSocket (浏览器子协议): Sec-WebSocket-Protocol（前端通过 WebSocket sub-protocol 传入）

鉴权失败的响应：
- HTTP: 401 JSONResponse
- WebSocket: 4001 关闭码
"""

import hmac

from starlette.responses import JSONResponse


class AuthMiddleware:
    """ASGI 中间件 — 在请求到达路由前完成鉴权，HTTP 和 WebSocket 统一处理。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")

        # 仅保护 API 和 WebSocket 路径
        if not path.startswith("/api/") and not path.startswith("/ws/"):
            return await self.app(scope, receive, send)

        # CORS 预检请求由 CORS 中间件处理，不做鉴权
        if scope.get("type") == "http" and scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)

        # 白名单：健康检查 + Token 获取（桌面应用启动时需要）
        if path == "/api/health" or path == "/api/auth/token":
            return await self.app(scope, receive, send)

        # 表情包静态资源（img 标签无法携带自定义头）仅放行 GET/HEAD 读操作。
        # 仅放行真正的图片资源路径（/api/stickers/{category}/{filename}）和
        # 随机表情路径（/api/stickers/random/{category}，前端 useChat 用裸
        # fetch 调用、无法携带自定义头）。其他 /api/stickers/* 下的 GET 端点
        # （favorites/recent/recommendations/index/custom 等）返回用户数据，
        # 前端通过 tauriFetch 调用、可携带 token，必须鉴权，防止越权读取。
        if path.startswith("/api/stickers/"):
            subpath = path[len("/api/stickers/"):]
            parts = [p for p in subpath.split("/") if p]
            method = scope.get("method", "GET").upper()
            if method in {"GET", "HEAD"} and len(parts) >= 2:
                return await self.app(scope, receive, send)
            # POST/PUT/DELETE 或单段路径（如 favorites、recent）仍需鉴权

        # 提取并校验 Token
        token = self._extract_token(scope)
        app = scope.get("app")
        expected = app.state.auth_token if app is not None else None

        if not expected or not hmac.compare_digest(token, expected):
            return await self._reject(scope, receive, send)

        # WebSocket 鉴权通过后：拦截 handler 的 websocket.accept 消息，
        # 自动注入 subprotocol（前端通过 new WebSocket(url, [token]) 请求的协议），
        # 业务 handler 无需感知 sub-protocol 协商细节。
        if scope["type"] == "websocket":
            protocols = scope.get("subprotocols", [])
            if protocols:
                original_send = send

                async def _accept_with_subprotocol(message):
                    if message.get("type") == "websocket.accept" and not message.get("subprotocol"):
                        message = {**message, "subprotocol": protocols[0]}
                    await original_send(message)

                return await self.app(scope, receive, _accept_with_subprotocol)

        return await self.app(scope, receive, send)

    def _extract_token(self, scope) -> str:
        """从请求头或 query 参数提取 Token。

        HTTP / WebSocket 通用路径: X-Maxma-Token 自定义头
        HTTP 备用路径 (SSE / img 等无法设置自定义头的场景): ?token=xxx query 参数
        WebSocket 专用路径: scope.subprotocols（由 ASGI server/uvicorn 从
        Sec-WebSocket-Protocol 握手头部解析，前端通过 new WebSocket(url, [token])
        传入）。优先使用 subprotocols 字段，比手动解析 raw header 更可靠。
        """
        headers = dict(scope.get("headers", []))

        # 通用：X-Maxma-Token 自定义头
        token_bytes = headers.get(b"x-maxma-token", b"")
        if token_bytes:
            return str(token_bytes.decode())

        # HTTP 备用：token query 参数（EventSource / img 等无法设置自定义头时使用）
        if scope["type"] == "http":
            qs = scope.get("query_string", b"").decode("utf-8", errors="replace")
            if qs:
                from urllib.parse import parse_qs
                params = parse_qs(qs)
                token_list = params.get("token", [])
                if token_list:
                    token = str(token_list[0])
                    if len(token) >= 8 and not token.startswith("-"):
                        return token

        # WebSocket 专用：从 ASGI scope 的 subprotocols 字段提取
        # ASGI server 在握手时自动解析 Sec-WebSocket-Protocol 头部，
        # 存入 scope["subprotocols"] = [token]
        if scope["type"] == "websocket":
            protocols = scope.get("subprotocols", [])
            if protocols:
                token = str(protocols[0])
                # 验证 token 格式：最小长度 8，不以 '-' 开头（防参数注入）
                if len(token) >= 8 and not token.startswith("-"):
                    return token

        return ""

    async def _reject(self, scope, receive, send):
        """根据 scope 类型返回 HTTP 401 或 WebSocket 4001 关闭。"""
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4001})
        else:
            response = JSONResponse(
                {"detail": "Unauthorized — X-Maxma-Token 缺失或不匹配"},
                status_code=401,
            )
            await response(scope, receive, send)
