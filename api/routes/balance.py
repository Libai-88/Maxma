"""DeepSeek 余额查询 — 从环境变量获取凭据"""

import asyncio
import os

import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance"

# 模块级共享异步 HTTP 客户端（连接池复用，延迟创建）
_shared_async_client: httpx.AsyncClient | None = None

# B-005: asyncio.Lock serializes lazy create / close of the shared singleton.
# Previously two concurrent /deepseek-balance requests could both observe
# _shared_async_client is None (or .is_closed), both construct a new client,
# and one would be silently lost — leaking its 20-connection pool. Symmetric
# race on close_async_client() could half-close a client a request was about
# to use. Violates the project convention "Async locks required for global
# state" (SessionManager, WebSocketRegistry, ActivityHub, TokenBucket all lock).
#
# Note: asyncio.Lock binds to the running loop on first await. Tests that use
# asyncio.run() create a fresh loop each call, so we lazily recreate the lock
# when the running loop changes. In production (single FastAPI loop) the lock
# is created once and reused for the lifetime of the process.
_client_lock: asyncio.Lock | None = None
_client_lock_loop: object | None = None  # tracks which loop the lock belongs to


async def _get_client_lock() -> asyncio.Lock:
    """Return a Lock bound to the currently-running event loop.

    Recreates the lock if the running loop has changed (e.g. across multiple
    asyncio.run() calls in tests). In production this is a no-op after the
    first call — the FastAPI event loop is stable for the process lifetime.
    """
    global _client_lock, _client_lock_loop
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop — fall back to creating a fresh lock. Callers must
        # be inside an async context for the lock to actually be acquired,
        # so this branch is defensive only.
        running_loop = None
    if _client_lock is None or _client_lock_loop is not running_loop:
        _client_lock = asyncio.Lock()
        _client_lock_loop = running_loop
    return _client_lock


async def _get_async_client() -> httpx.AsyncClient:
    """获取共享的异步 HTTP 客户端。

    B-005: now async + holds _client_lock across the check-then-assign window
    so concurrent callers cannot construct duplicate clients.
    """
    global _shared_async_client  # noqa: PLW0603
    lock = await _get_client_lock()
    async with lock:
        if _shared_async_client is None or _shared_async_client.is_closed:
            # asyncio.Lock held — assignment + construction are atomic w.r.t.
            # other callers. The inner assignment uses the module-level global.
            _shared_async_client = httpx.AsyncClient(
                timeout=httpx.Timeout(10.0),
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                ),
            )
        return _shared_async_client


async def close_async_client() -> None:
    """关闭共享异步 HTTP 客户端（在应用关闭时调用）。

    B-005: serialized against _get_async_client() via the same _client_lock so
    a request in flight cannot observe a half-closed client.
    """
    global _shared_async_client
    lock = await _get_client_lock()
    async with lock:
        if _shared_async_client is not None and not _shared_async_client.is_closed:
            await _shared_async_client.aclose()
        _shared_async_client = None


def _find_deepseek_api_key(request: Request) -> str:
    """在环境变量中查找 DeepSeek API key。

    OMP ModelRegistry 管理所有 provider，Python 端通过 DEEPSEEK_API_KEY
    环境变量获取凭据以查询余额。
    """
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="DeepSeek API key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY",
        )
    return api_key


@router.get("/deepseek-balance")
async def get_deepseek_balance(request: Request):
    api_key = _find_deepseek_api_key(request)
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    client = await _get_async_client()
    try:
        response = await client.get(DEEPSEEK_BALANCE_URL, headers=headers)
        # 修复：未调用 raise_for_status()，导致 except HTTPStatusError 成为死代码。
        # 当 DeepSeek 返回 401/403/5xx 时，错误 JSON 会被当作余额数据静默返回给前端。
        response.raise_for_status()
        data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="DeepSeek API 请求超时")
    except httpx.HTTPStatusError as e:
        status = e.response.status_code if e.response is not None else 0
        raise HTTPException(status_code=500, detail=f"DeepSeek API 错误：HTTP {status}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DeepSeek API 错误：{e}")
    return data
