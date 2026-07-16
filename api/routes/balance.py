"""DeepSeek 余额查询 — 从环境变量获取凭据"""

import os

import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance"

# 模块级共享异步 HTTP 客户端（连接池复用，延迟创建）
_shared_async_client: httpx.AsyncClient | None = None


def _get_async_client() -> httpx.AsyncClient:
    """获取共享的异步 HTTP 客户端。"""
    global _shared_async_client
    if _shared_async_client is None or _shared_async_client.is_closed:
        _shared_async_client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
            ),
        )
    return _shared_async_client


async def close_async_client() -> None:
    """关闭共享异步 HTTP 客户端（在应用关闭时调用）。"""
    global _shared_async_client
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
            detail="DeepSeek API key not configured. Set DEEPSEEK_API_KEY in .env.",
        )
    return api_key


@router.get("/deepseek-balance")
async def get_deepseek_balance(request: Request):
    api_key = _find_deepseek_api_key(request)
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    client = _get_async_client()
    try:
        response = await client.get(DEEPSEEK_BALANCE_URL, headers=headers)
        data = response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="DeepSeek API timeout")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=500, detail=f"DeepSeek API error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DeepSeek API error: {e}")
    return data
