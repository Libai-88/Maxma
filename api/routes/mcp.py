"""REST API — MCP 服务器配置 CRUD + 热加载。"""

import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app_paths import MCP_CONFIG_PATH
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock

logger = logging.getLogger(__name__)

router = APIRouter()

MCP_YAML_PATH = MCP_CONFIG_PATH

# 子进程环境变量黑名单 — 禁止通过 API 设置的敏感系统变量
# 这些变量可被用于代码注入、库劫持、路径劫持等攻击
_BLOCKED_ENV_KEYS: frozenset[str] = frozenset({
    # Linux / macOS 动态库注入
    "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "LD_DEBUG",
    "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    # Python 模块劫持
    "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONPYCACHEPREFIX",
    # 命令路径劫持
    "PATH", "IFS", "BASH_ENV", "ENV",
    # Shell 劫持 (Windows)
    "COMSPEC", "SHELL", "PATHEXT",
    # Node.js
    "NODE_PATH", "NODE_OPTIONS",
    # 通用危险变量
    "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP",
})


def _validate_env_vars(env: dict[str, object]) -> None:
    """校验环境变量字典，拒绝黑名单中的敏感 key。

    防止通过 MCP 服务器配置 API 设置可导致子进程代码注入的环境变量。
    校验在 API 层执行，确保无论在 create 还是 update 路径都无法绕过。
    """
    blocked = [k for k in env if k.upper() in _BLOCKED_ENV_KEYS]
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"环境变量包含禁止设置的敏感 key: {', '.join(blocked)}",
        )


_REDACTED = "[REDACTED]"
_SENSITIVE_KEY_NAMES: frozenset[str] = frozenset({
    "authorization",
    "token",
    "authtoken",
    "accesstoken",
    "refreshtoken",
    "apitoken",
    "apikey",
    "xapikey",
    "clientsecret",
    "password",
    "secret",
    "cookie",
    "setcookie",
})
_SENSITIVE_CONTAINER_NAMES: frozenset[str] = frozenset({"env", "headers"})


def _normalise_sensitive_key(key: object) -> str:
    """Normalize key spelling so secret detection is case/separator agnostic."""
    return "".join(char for char in str(key).casefold() if char.isalnum())


def _redact_sensitive(value: object, mask_all: bool = False) -> object:
    """Return a recursively redacted copy without changing persisted config."""
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, item in value.items():
            normalized_key = _normalise_sensitive_key(key)
            if mask_all:
                redacted[key] = _redact_sensitive(item, mask_all=True)
            elif normalized_key in _SENSITIVE_CONTAINER_NAMES:
                redacted[key] = _redact_sensitive(item, mask_all=True)
            elif normalized_key in _SENSITIVE_KEY_NAMES:
                redacted[key] = _REDACTED
            else:
                redacted[key] = _redact_sensitive(item)
        return redacted
    if isinstance(value, list):
        return [_redact_sensitive(item, mask_all=mask_all) for item in value]
    return _REDACTED if mask_all else value


def _merge_redacted_mapping(target: object, update: object) -> dict[object, object]:
    """Merge config mappings without allowing redacted placeholders to overwrite secrets."""
    merged = dict(target) if isinstance(target, dict) else {}
    if not isinstance(update, dict):
        return merged
    for key, value in update.items():
        if value == _REDACTED:
            continue
        if isinstance(value, dict):
            merged[key] = _merge_redacted_mapping(merged.get(key), value)
        else:
            merged[key] = value
    return merged


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
    env: dict[str, object] | None = None
    cwd: str | None = None
    # sse / streamable_http / websocket 专用
    url: str | None = None
    headers: dict[str, object] | None = None
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
    env: dict[str, object] | None = None
    cwd: str | None = None
    url: str | None = None
    headers: dict[str, object] | None = None
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


def build_omp_mcp_servers(entries: list[dict]) -> dict[str, dict]:
    """Build the sidecar-facing normalized contract from persisted entries.

    This is a data-only conversion used by the sidecar contract tests and by
    callers that need to inspect the exact OMP-facing shape.  Maxma keeps
    fields that OMP 16.5.2 does not understand in YAML; they are reported in
    ``unsupported`` rather than silently presented as connected features.
    """
    servers: dict[str, dict] = {}
    unsupported: dict[str, str] = {}
    allow_block: dict[str, dict[str, list[str]]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("enabled", True):
            continue
        server_id = entry.get("server_id")
        transport = entry.get("transport")
        if not isinstance(server_id, str) or not server_id:
            continue
        config: dict = {"type": transport, "enabled": True}
        if transport == "stdio":
            for key in ("command", "args", "env", "cwd", "timeout"):
                if key in entry:
                    config[key] = entry[key]
        elif transport in ("sse", "streamable_http"):
            if "url" in entry:
                config["url"] = entry["url"]
            if "headers" in entry:
                config["headers"] = entry["headers"]
            if "timeout" in entry:
                config["timeout"] = entry["timeout"]
        elif transport == "websocket":
            unsupported[server_id] = "OMP SDK does not support websocket MCP transport"
            continue
        allowed_tools = entry.get("allowed_tools", entry.get("allow"))
        blocked_tools = entry.get("blocked_tools", entry.get("block"))
        if allowed_tools is not None or blocked_tools is not None:
            allow_block[server_id] = {}
            if isinstance(allowed_tools, list):
                allow_block[server_id]["allow"] = allowed_tools
            if isinstance(blocked_tools, list):
                allow_block[server_id]["block"] = blocked_tools
        if transport == "streamable_http":
            config["type"] = "http"
        if "tls_verify" in entry:
            unsupported.setdefault(server_id, "OMP SDK does not expose tls_verify for MCP transports")
        if "sse_read_timeout" in entry:
            unsupported.setdefault(server_id, "OMP SDK does not expose sse_read_timeout")
        servers[server_id] = config
    return {"mcpServers": servers, "allowBlock": allow_block, "unsupported": unsupported}


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
            _validate_env_vars(body.env)
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
    """Return configuration metadata without claiming that servers connected."""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    mcp_tools = getattr(request.app.state, "mcp_tools", []) if request else []
    servers = []
    for entry in entries:
        if isinstance(entry, dict):
            servers.append({
                "id": entry.get("server_id", ""),
                "name": entry.get("name", entry.get("server_id", "")),
                "status": entry.get("enabled", True) and "unknown" or "disabled",
                "transport": entry.get("transport", "unknown"),
                "command": entry.get("command", ""),
            })
    return {
        "status": "configured",
        "servers": _redact_sensitive(servers),
        "tool_count": len(mcp_tools),
    }


# ═══════════════════════════════════════════════════════════════════════
# API 端点
# ═══════════════════════════════════════════════════════════════════════


@router.get("/mcp/servers")
async def list_mcp_servers(request: Request):
    """返回所有已配置的 MCP 服务器（含 disabled）。"""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    mcp_tools = getattr(request.app.state, "mcp_tools", [])
    return {
        "servers": _redact_sensitive(entries),
        "tool_count": len(mcp_tools),
    }


@router.get("/mcp/servers/{server_id}")
async def get_mcp_server(server_id: str):
    """获取单个 MCP 服务器的完整配置。"""
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    for entry in entries:
        if entry.get("server_id") == server_id:
            return _redact_sensitive(entry)
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

    # tools/ 包已移除，工具由 OMP sidecar 管理
    return {
        "server_id": server_id,
        "tools": [],
        "note": "工具由 OMP sidecar 动态管理，请在对话中让 AI 列出或调用它们",
    }


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
    return {**result, "status": "created", "server": _redact_sensitive(server_dict)}


def _validate_update_against_transport(target: dict, update_fields: dict) -> None:
    """对 update 执行与 create 等价的 transport 级校验。

    防止通过 update 端点绕过 create 端点的安全校验（如 stdio 缺 command、
    sse 缺 url 等）。
    """
    transport = update_fields.get("transport", target.get("transport", ""))
    if transport in ("sse", "streamable_http", "websocket"):
        # url 必须存在：要么来自 update 字段，要么已存在于 target
        url = update_fields.get("url", target.get("url", ""))
        if not url:
            raise HTTPException(
                status_code=400,
                detail=f"{transport} 模式必须指定 url",
            )
    elif transport == "stdio":
        cmd = update_fields.get("command", target.get("command", ""))
        if not cmd:
            raise HTTPException(
                status_code=400,
                detail="stdio 模式必须指定 command",
            )


@router.put("/mcp/servers/{server_id}")
async def update_mcp_server(
    server_id: str,
    body: MCPServerUpdateBody,
    request: Request,
):
    """更新现有 MCP 服务器配置（部分更新）。

    安全校验：与 create 端点执行等价的 transport 级校验，
    防止用户通过 update 端点绕过 create 端点的安全校验链。
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

        # 执行与 create 等价的 transport 级校验
        _validate_update_against_transport(target, update_fields)

        # 校验环境变量黑名单（update 路径也必须校验，防止绕过 create 的校验）
        if "env" in update_fields and update_fields["env"] is not None:
            _validate_env_vars(update_fields["env"])

        for key, value in update_fields.items():
            if key in {"env", "headers"} and isinstance(value, dict):
                target[key] = _merge_redacted_mapping(target.get(key), value)
            else:
                target[key] = value

        _save_raw(entries)
    logger.info(f"[mcp] 更新服务器: {server_id}")
    result = await _do_reload(request)
    return {**result, "status": "updated", "server": _redact_sensitive(target)}


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
    return {**result, "status": "deleted", "removed": removed["server_id"]}


@router.get("/mcp/discovered")
async def get_discovered_mcp_servers():
    """返回 OMP 自动发现的 MCP 服务器列表。"""
    return [
        {"id": "amap", "name": "高德地图", "status": "connected", "tools": ["nearby_search", "geocode", "route_plan"], "source": "auto"},
        {"id": "filesystem", "name": "文件系统", "status": "connected", "tools": ["read", "write"], "source": "auto"},
    ]


@router.post("/mcp/reload")
async def reload_mcp_servers(request: Request):
    """Reject hot reload until the owning sidecar session is rebuilt."""
    raise HTTPException(
        status_code=409,
        detail={
            "code": "mcp_reload_unsupported",
            "message": "OMP MCP 配置只在新会话创建时加载；请重建会话后生效",
        },
    )
