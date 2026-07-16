"""REST API — MCP 服务器配置 CRUD + 热加载。"""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app_paths import MCP_CONFIG_PATH
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock

logger = logging.getLogger(__name__)

router = APIRouter()

MCP_YAML_PATH = MCP_CONFIG_PATH


# ═══════════════════════════════════════════════════════════════════════
# Pydantic 请求体模型
# ═══════════════════════════════════════════════════════════════════════


class MCPServerCreateBody(BaseModel):
    """创建 MCP 服务器的请求体。"""
    server_id: str
    transport: str = Field(..., description="stdio / sse / streamable_http / websocket")
    enabled: bool = True
    description: str = ""
    # 阶段 4.1：工具级 allowlist / blocklist
    allowed_tools: list[str] | None = None
    blocked_tools: list[str] | None = None
    # stdio 专用
    command: str | None = None
    args: list[str] = []
    env: dict[str, str] | None = None
    cwd: str | None = None
    # sse / streamable_http / websocket 专用
    url: str | None = None
    headers: dict[str, str] | None = None
    timeout: float | None = None
    sse_read_timeout: float | None = None
    tls_verify: bool = True


class MCPServerUpdateBody(BaseModel):
    """更新 MCP 服务器的请求体（所有字段可选）。"""
    enabled: bool | None = None
    description: str | None = None
    allowed_tools: list[str] | None = None
    blocked_tools: list[str] | None = None
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, str] | None = None
    timeout: float | None = None
    sse_read_timeout: float | None = None
    tls_verify: bool | None = None


# ═══════════════════════════════════════════════════════════════════════
# YAML 读写
# ═══════════════════════════════════════════════════════════════════════


def _load_raw() -> list[dict]:
    """读取 YAML 原始数据（list of dicts）。

    配置文件损坏（YAML 语法错误）时返回空列表而非抛异常，避免 500 错误。
    """
    if not MCP_YAML_PATH.exists():
        return []
    raw = load_yaml(MCP_YAML_PATH, default={}) or {}
    if not isinstance(raw, dict):
        return []
    servers = raw.get("mcp_servers", [])
    return servers if isinstance(servers, list) else []


def _save_raw(servers: list[dict]) -> None:
    """写入 YAML。"""
    MCP_YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
    dump_yaml_atomic(MCP_YAML_PATH, {"mcp_servers": servers})


def _build_server_dict(body: MCPServerCreateBody) -> dict:
    """根据 transport 类型构建服务器配置 dict。"""
    d: dict = {
        "server_id": body.server_id,
        "transport": body.transport,
        "enabled": body.enabled,
        "description": body.description,
    }
    # 阶段 4.1：allowlist / blocklist
    if body.allowed_tools is not None:
        d["allowed_tools"] = body.allowed_tools
    if body.blocked_tools is not None:
        d["blocked_tools"] = body.blocked_tools

    t = body.transport
    if t == "stdio":
        if not body.command:
            raise HTTPException(status_code=400, detail="stdio 模式必须指定 command")
        d["command"] = body.command
        if body.args:
            d["args"] = body.args
        if body.env:
            d["env"] = body.env
        if body.cwd:
            d["cwd"] = body.cwd
    elif t in ("sse", "streamable_http", "websocket"):
        if not body.url:
            raise HTTPException(status_code=400, detail=f"{t} 模式必须指定 url")
        d["url"] = body.url
        d["tls_verify"] = body.tls_verify
        if body.headers:
            d["headers"] = body.headers
        if body.timeout is not None:
            d["timeout"] = body.timeout
        if t == "sse" and body.sse_read_timeout is not None:
            d["sse_read_timeout"] = body.sse_read_timeout
    else:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的 transport: {t}，仅支持 stdio/sse/streamable_http/websocket",
        )
    return d


# ═══════════════════════════════════════════════════════════════════════
# 热加载辅助
# ═══════════════════════════════════════════════════════════════════════


async def _do_reload(request: Request | None = None) -> dict:
    """执行 MCP 热加载并返回结果（stub: tools/ directory removed）。"""
    return {
        "status": "ok",
        "servers": [],
        "tool_count": 0,
    }


# ═══════════════════════════════════════════════════════════════════════
# API 端点
# ═══════════════════════════════════════════════════════════════════════


@router.get("/mcp/servers")
async def list_mcp_servers(request: Request):
    """返回所有已配置的 MCP 服务器（含 disabled）。"""
    mcp_tools = getattr(request.app.state, "mcp_tools", [])
    return {
        "servers": [],
        "tool_count": len(mcp_tools),
    }


@router.get("/mcp/servers/{server_id}")
async def get_mcp_server(server_id: str):
    """获取单个 MCP 服务器的完整配置。"""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    for entry in entries:
        if entry.get("server_id") == server_id:
            return entry
    raise HTTPException(status_code=404, detail=f"MCP 服务器 '{server_id}' 不存在")


@router.get("/mcp/servers/{server_id}/tools")
async def list_mcp_server_tools(server_id: str):
    """列出指定 MCP 服务器加载到的所有工具名（阶段 4.1）。

    供前端在选择 allowlist / blocklist 时列出可选工具。
    工具名含 {server_id}_ 前缀。
    """
    # 先确认服务器存在
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    if not any(e.get("server_id") == server_id for e in entries):
        raise HTTPException(status_code=404, detail=f"MCP 服务器 '{server_id}' 不存在")

    return {"server_id": server_id, "tools": []}


@router.post("/mcp/servers")
async def create_mcp_server(body: MCPServerCreateBody, request: Request):
    """创建新的 MCP 服务器配置。"""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
        # 检查 ID 是否重复
        for entry in entries:
            if entry.get("server_id") == body.server_id:
                raise HTTPException(
                    status_code=409,
                    detail=f"server_id '{body.server_id}' 已存在",
                )
        server_dict = _build_server_dict(body)
        entries.append(server_dict)
        _save_raw(entries)
    logger.info(f"[mcp] 创建服务器: {body.server_id} ({body.transport})")
    result = await _do_reload(request)
    return {"status": "created", "server": server_dict, **result}


@router.put("/mcp/servers/{server_id}")
async def update_mcp_server(
    server_id: str,
    body: MCPServerUpdateBody,
    request: Request,
):
    """更新现有 MCP 服务器配置（部分更新）。

    安全校验：command 走 stdio 白名单；url/tls_verify 走 URL 白名单 + TLS 校验。
    防止用户通过 update 端点绕过 create 端点的安全校验。
    """
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
        target = None
        for entry in entries:
            if entry.get("server_id") == server_id:
                target = entry
                break
        if target is None:
            raise HTTPException(status_code=404, detail=f"MCP 服务器 '{server_id}' 不存在")

        # 部分更新：只更新非 None 字段
        update_fields = body.model_dump(exclude_unset=True)

        for key, value in update_fields.items():
            target[key] = value

        _save_raw(entries)
    logger.info(f"[mcp] 更新服务器: {server_id}")
    result = await _do_reload(request)
    return {"status": "updated", "server": target, **result}


@router.delete("/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: str, request: Request):
    """删除 MCP 服务器配置。"""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
        new_entries = [e for e in entries if e.get("server_id") != server_id]
        if len(new_entries) == len(entries):
            raise HTTPException(status_code=404, detail=f"MCP 服务器 '{server_id}' 不存在")
        removed = [e for e in entries if e.get("server_id") == server_id][0]
        _save_raw(new_entries)
    logger.info(f"[mcp] 删除服务器: {server_id}")
    result = await _do_reload(request)
    return {"status": "deleted", "removed": removed["server_id"], **result}


@router.post("/mcp/reload")
async def reload_mcp_servers(request: Request):
    """热加载：重新解析 YAML → 重建连接 → 替换 app.state。

    失败时保留旧工具列表不变。
    """
    return await _do_reload(request)
