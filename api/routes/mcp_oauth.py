"""mcp_oauth.py — MCP OAuth 授权流程（从 mcp.py 拆分，S2-4）。"""

import logging
import time

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

from app_paths import API_DATA_DIR
from api.yaml_store import dump_yaml_atomic, load_yaml

logger = logging.getLogger(__name__)

OAUTH_TOKENS_PATH = API_DATA_DIR / "mcp_oauth_tokens.yaml"

# 内存中暂存 OAuth state（防 CSRF），生产环境应使用 Redis 等持久化
_oauth_pending_states: dict[str, dict] = {}


def _load_oauth_tokens() -> dict:
    """读取已存储的 OAuth tokens。"""
    if not OAUTH_TOKENS_PATH.exists():
        return {}
    raw = load_yaml(OAUTH_TOKENS_PATH, default={}) or {}
    return raw if isinstance(raw, dict) else {}


def _save_oauth_tokens(tokens: dict) -> None:
    """持久化 OAuth tokens。"""
    OAUTH_TOKENS_PATH.parent.mkdir(parents=True, exist_ok=True)
    dump_yaml_atomic(OAUTH_TOKENS_PATH, tokens)


class OAuthAuthorizeBody(BaseModel):
    """发起 OAuth 授权的请求体。"""
    server_name: str
    client_id: str | None = None
    auth_endpoint: str | None = None  # 自定义授权端点
    redirect_uri: str | None = None
    scope: str | None = None


class OAuthCallbackBody(BaseModel):
    """OAuth 回调请求体。"""
    code: str
    state: str
    server_name: str | None = None


async def _exchange_oauth_code(code: str, state: str, server_name_override: str | None = None) -> dict:
    """用 authorization code 换取 access token 并持久化。

    验证 state（防 CSRF），调用 token 端点交换，存储 token，清除已用 state。
    成功返回结构化结果字典；失败抛 HTTPException。
    供 POST（前端手动提交）与 GET（浏览器重定向）两个回调入口共用。
    """
    pending = _oauth_pending_states.get(state)
    if not pending:
        raise HTTPException(status_code=400, detail="无效或已过期的 state 参数")

    server_name = server_name_override or pending["server_name"]
    client_id = pending["client_id"]
    redirect_uri = pending["redirect_uri"]

    token_endpoint = "https://auth.smithery.ai/token"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(token_endpoint, json={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "redirect_uri": redirect_uri,
            })
            resp.raise_for_status()
            token_data = resp.json()
    except httpx.HTTPStatusError as e:
        logger.warning("[mcp-oauth] Token exchange failed for %s: %s", server_name, e)
        raise HTTPException(status_code=502, detail=f"Token 交换失败: {e.response.status_code}")
    except Exception as e:
        logger.warning("[mcp-oauth] Token exchange error for %s: %s", server_name, e)
        raise HTTPException(status_code=502, detail=f"Token 交换失败: {e}")

    tokens = _load_oauth_tokens()
    tokens[server_name] = {
        "access_token": token_data.get("access_token", ""),
        "refresh_token": token_data.get("refresh_token", ""),
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_at": time.time() + token_data.get("expires_in", 3600),
        "scope": token_data.get("scope", ""),
        "authorized_at": time.time(),
    }
    _save_oauth_tokens(tokens)

    _oauth_pending_states.pop(state, None)

    logger.info("[mcp-oauth] OAuth authorized for server: %s", server_name)
    return {
        "status": "authorized",
        "server_name": server_name,
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_in": token_data.get("expires_in", 3600),
    }


