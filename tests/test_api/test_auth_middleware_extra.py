"""补充测试 — api/middleware/auth.py 覆盖 OPTIONS 预检、WS subprotocol 注入、
WS token via subprotocol、WS reject 4001 等未覆盖路径。

使用直接 ASGI scope 模拟（不依赖 TestClient），精确控制 scope 字段以触发各分支。
"""

import pytest

from api.middleware.auth import AuthMiddleware

TOKEN = "valid-token-123"


class _State:
    """模拟 app.state。"""

    def __init__(self, auth_token=None):
        self.auth_token = auth_token


class _AppRef:
    """作为 scope['app'] —— 持有 .state。"""

    def __init__(self, auth_token=None):
        self.state = _State(auth_token)


class _InnerApp:
    """作为 self.app —— 记录调用，模拟 accept/响应。

    type == "websocket" → send websocket.accept（可选 subprotocol）
    type == "http" → send 200 response
    """

    def __init__(self, accept_subprotocol=None):
        self.calls = []
        self._accept_subprotocol = accept_subprotocol

    async def __call__(self, scope, receive, send):
        self.calls.append(scope)
        if scope["type"] == "websocket":
            msg = {"type": "websocket.accept"}
            if self._accept_subprotocol is not None:
                msg["subprotocol"] = self._accept_subprotocol
            await send(msg)
        elif scope["type"] == "http":
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"{}"})


class _Recorder:
    """记录 send 调用。"""

    def __init__(self):
        self.messages = []

    async def __call__(self, message):
        self.messages.append(message)


def _http_scope(path="/api/test", method="GET", headers=None, app_ref=None):
    return {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
        "app": app_ref,
    }


def _ws_scope(path="/ws/test", headers=None, subprotocols=None, app_ref=None):
    return {
        "type": "websocket",
        "path": path,
        "headers": headers or [],
        "subprotocols": subprotocols or [],
        "app": app_ref,
    }


async def _http_receive():
    return {"type": "http.request"}


async def _ws_receive():
    return {"type": "websocket.connect"}


# ── OPTIONS preflight (行 32-33) ──


@pytest.mark.asyncio
async def test_options_preflight_passthrough():
    """OPTIONS 请求不做鉴权，直接放行。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(method="OPTIONS", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 1


# ── Non-API path passthrough (行 28-29) ──


@pytest.mark.asyncio
async def test_non_api_path_passthrough():
    """非 /api/ 非 /ws/ 路径直接放行。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/open", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 1


# ── Whitelist paths (行 36-37) ──


@pytest.mark.asyncio
async def test_auth_token_endpoint_whitelist():
    """/api/auth/token 白名单放行。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/api/auth/token", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 1


@pytest.mark.asyncio
async def test_stickers_prefix_whitelist():
    """图片资源路径 /api/stickers/{category}/{filename} 白名单放行。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/api/stickers/smile/happy.webp", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 1


@pytest.mark.asyncio
async def test_stickers_random_whitelist():
    """随机表情路径 /api/stickers/random/{category} 白名单放行（前端用裸 fetch）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/api/stickers/random/开心", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 1


@pytest.mark.asyncio
async def test_stickers_sensitive_get_requires_auth():
    """敏感端点 /api/stickers/favorites (GET) 必须鉴权，不能被前缀白名单放行。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/api/stickers/favorites", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 0
    starts = [m for m in rec.messages if m.get("type") == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 401


@pytest.mark.asyncio
async def test_stickers_recent_requires_auth():
    """/api/stickers/recent (GET) 必须鉴权。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(path="/api/stickers/recent", app_ref=_AppRef())
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 0
    starts = [m for m in rec.messages if m.get("type") == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 401


# ── HTTP 401 reject (行 96-100) ──


@pytest.mark.asyncio
async def test_http_reject_returns_401():
    """HTTP 请求无 token → 401 JSONResponse。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(app_ref=_AppRef(TOKEN))
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 0
    starts = [m for m in rec.messages if m.get("type") == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 401


# ── WebSocket reject 4001 (行 94-95) ──


@pytest.mark.asyncio
async def test_ws_reject_returns_4001():
    """WebSocket 请求无 token → 4001 关闭码。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(app_ref=_AppRef(TOKEN))
    await mw(scope, _ws_receive, rec)

    assert len(inner.calls) == 0
    closes = [m for m in rec.messages if m.get("type") == "websocket.close"]
    assert len(closes) == 1
    assert closes[0]["code"] == 4001


# ── WebSocket subprotocol injection (行 50-60) ──


@pytest.mark.asyncio
async def test_ws_subprotocol_injection_on_accept():
    """WS 鉴权通过后，自动注入 subprotocol 到 accept 消息。"""
    inner = _InnerApp()  # 发送 accept 无 subprotocol
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[(b"x-maxma-token", TOKEN.encode())],
        subprotocols=["custom-proto"],
        app_ref=_AppRef(TOKEN),
    )
    await mw(scope, _ws_receive, rec)

    assert len(inner.calls) == 1
    accepts = [m for m in rec.messages if m.get("type") == "websocket.accept"]
    assert len(accepts) == 1
    assert accepts[0]["subprotocol"] == "custom-proto"


@pytest.mark.asyncio
async def test_ws_subprotocol_injection_preserves_existing():
    """若 accept 已带 subprotocol，不覆盖。"""
    inner = _InnerApp(accept_subprotocol="already-set")
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[(b"x-maxma-token", TOKEN.encode())],
        subprotocols=["custom-proto"],
        app_ref=_AppRef(TOKEN),
    )
    await mw(scope, _ws_receive, rec)

    accepts = [m for m in rec.messages if m.get("type") == "websocket.accept"]
    assert len(accepts) == 1
    assert accepts[0]["subprotocol"] == "already-set"


@pytest.mark.asyncio
async def test_ws_no_subprotocols_skips_injection():
    """WS 无 subprotocols 时跳过注入，走最后的 return（行 62）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[(b"x-maxma-token", TOKEN.encode())],
        subprotocols=[],  # 空
        app_ref=_AppRef(TOKEN),
    )
    await mw(scope, _ws_receive, rec)

    assert len(inner.calls) == 1
    accepts = [m for m in rec.messages if m.get("type") == "websocket.accept"]
    assert len(accepts) == 1
    assert "subprotocol" not in accepts[0]


# ── WebSocket token via subprotocol (行 82-88) ──


@pytest.mark.asyncio
async def test_ws_token_via_subprotocol():
    """WS 无 X-Maxma-Token 头时，从 subprotocols[0] 提取 token。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[],  # 无 header token
        subprotocols=[TOKEN],  # token 在 subprotocol
        app_ref=_AppRef(TOKEN),
    )
    await mw(scope, _ws_receive, rec)

    # 鉴权通过，inner 应被调用
    assert len(inner.calls) == 1


@pytest.mark.asyncio
async def test_ws_subprotocol_token_too_short_rejected():
    """WS subprotocol token 长度 < 8 → 拒绝（行 87 条件 len(token) >= 8）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[],
        subprotocols=["short"],  # 长度 < 8
        app_ref=_AppRef("short"),
    )
    await mw(scope, _ws_receive, rec)

    assert len(inner.calls) == 0
    closes = [m for m in rec.messages if m.get("type") == "websocket.close"]
    assert len(closes) == 1
    assert closes[0]["code"] == 4001


@pytest.mark.asyncio
async def test_ws_subprotocol_token_starts_with_dash_rejected():
    """WS subprotocol token 以 '-' 开头 → 拒绝（行 87 条件 not startswith('-')）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _ws_scope(
        headers=[],
        subprotocols=["-dash-token-123"],  # 以 - 开头
        app_ref=_AppRef("-dash-token-123"),
    )
    await mw(scope, _ws_receive, rec)

    assert len(inner.calls) == 0
    closes = [m for m in rec.messages if m.get("type") == "websocket.close"]
    assert len(closes) == 1
    assert closes[0]["code"] == 4001


# ── Token extraction unit tests (行 72-90) ──


def test_extract_token_prefers_header_over_subprotocol():
    """_extract_token 优先从 X-Maxma-Token 头提取（行 75-77 先于 82-88）。"""
    mw = AuthMiddleware(_InnerApp())
    scope = {
        "type": "websocket",
        "headers": [(b"x-maxma-token", b"header-token-123")],
        "subprotocols": ["subproto-token-123"],
    }
    assert mw._extract_token(scope) == "header-token-123"


def test_extract_token_empty_when_no_source():
    """无任何 token 来源 → 空字符串（行 90）。"""
    mw = AuthMiddleware(_InnerApp())
    scope = {
        "type": "http",
        "headers": [],
    }
    assert mw._extract_token(scope) == ""


def test_extract_token_from_header_http():
    """HTTP 请求从 X-Maxma-Token 头提取 token。"""
    mw = AuthMiddleware(_InnerApp())
    scope = {
        "type": "http",
        "headers": [(b"x-maxma-token", b"header-token-123")],
    }
    assert mw._extract_token(scope) == "header-token-123"


def test_extract_token_from_subprotocol_ws():
    """WS 请求从 subprotocols[0] 提取 token。"""
    mw = AuthMiddleware(_InnerApp())
    scope = {
        "type": "websocket",
        "headers": [],
        "subprotocols": ["sub-token-123"],
    }
    assert mw._extract_token(scope) == "sub-token-123"


def test_extract_token_empty_subprotocols_ws():
    """WS 请求 subprotocols 为空 → 空字符串。"""
    mw = AuthMiddleware(_InnerApp())
    scope = {
        "type": "websocket",
        "headers": [],
        "subprotocols": [],
    }
    assert mw._extract_token(scope) == ""


# ── app.state None edge case (行 41-44) ──


@pytest.mark.asyncio
async def test_no_app_in_scope_rejects():
    """scope 无 'app' key → expected None → 401（行 41-42）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/test",
        "headers": [(b"x-maxma-token", b"any-token")],
        # 无 "app" key
    }
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 0
    starts = [m for m in rec.messages if m.get("type") == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 401


@pytest.mark.asyncio
async def test_empty_expected_token_rejects():
    """app.state.auth_token 为 None → expected falsy → 401（行 44）。"""
    inner = _InnerApp()
    mw = AuthMiddleware(inner)
    rec = _Recorder()

    scope = _http_scope(
        headers=[(b"x-maxma-token", b"any-token")],
        app_ref=_AppRef(None),  # auth_token = None
    )
    await mw(scope, _http_receive, rec)

    assert len(inner.calls) == 0
    starts = [m for m in rec.messages if m.get("type") == "http.response.start"]
    assert len(starts) == 1
    assert starts[0]["status"] == 401
