"""请求日志 + 耗时中间件 — ASGI 中间件，记录每个 HTTP 请求。

功能：
- 生成唯一 request_id 注入 ContextVar
- 记录请求方法、路径、状态码、耗时
- 通过 X-Request-ID 响应头返回 request_id
- 跳过静态资源和健康检查路径
"""

import logging
import time
import uuid

from api.logging_config import ctx_request_id, ctx_session_id
from api.metrics import get_metrics

logger = logging.getLogger(__name__)

# 不记录日志的路径（高频低价值）
_SKIP_PATHS = {"/api/health", "/favicon.ico"}
_SKIP_PREFIXES = ("/assets/", "/static/")


class RequestLogMiddleware:
    """ASGI 中间件 — 记录 HTTP 请求日志和指标。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        path = scope.get("path", "")

        # 跳过不需要记录的路径
        if path in _SKIP_PATHS or any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await self.app(scope, receive, send)

        # 生成 request_id
        request_id = uuid.uuid4().hex[:12]
        token_rid = ctx_request_id.set(request_id)

        # 从请求头提取 session_id（前端通过 X-Session-ID 传入）
        headers = dict(scope.get("headers", []))
        session_id_bytes = headers.get(b"x-session-id", b"")
        session_id = session_id_bytes.decode() if session_id_bytes else ""
        token_sid = ctx_session_id.set(session_id) if session_id else None

        start = time.monotonic()
        status_code = 500  # 默认值，如果 handler 崩溃

        async def _send_wrapper(message):
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = message.get("status", 500)
                # 注入 X-Request-ID 响应头
                headers_list = list(message.get("headers", []))
                headers_list.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": headers_list}
            await send(message)

        try:
            await self.app(scope, receive, _send_wrapper)
        finally:
            duration_ms = (time.monotonic() - start) * 1000
            method = scope.get("method", "?")

            # 记录指标
            get_metrics().record_request(method, path, status_code, duration_ms)

            # 日志输出
            client_ip = self._get_client_ip(scope)
            extra = {
                "duration_ms": round(duration_ms, 1),
                "status_code": status_code,
                "method": method,
                "path": path,
                "client_ip": client_ip,
            }

            if status_code >= 500:
                logger.error(
                    "%s %s → %d (%.1fms)",
                    method, path, status_code, duration_ms,
                    extra=extra,
                )
            elif status_code >= 400:
                logger.warning(
                    "%s %s → %d (%.1fms)",
                    method, path, status_code, duration_ms,
                    extra=extra,
                )
            else:
                logger.info(
                    "%s %s → %d (%.1fms)",
                    method, path, status_code, duration_ms,
                    extra=extra,
                )

            # 清理 ContextVar
            ctx_request_id.reset(token_rid)
            if token_sid is not None:
                ctx_session_id.reset(token_sid)

    @staticmethod
    def _get_client_ip(scope) -> str:
        """从 ASGI scope 提取客户端 IP。"""
        client = scope.get("client")
        if client:
            return str(client[0])
        # 代理场景：X-Forwarded-For
        headers = dict(scope.get("headers", []))
        xff = headers.get(b"x-forwarded-for", b"")
        if xff:
            return str(xff.decode().split(",")[0].strip())
        return "-"
