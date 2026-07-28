"""REST API — MCP 服务器配置 CRUD + 热加载 + Registry + OAuth。"""

import logging
import os
import time
import secrets
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app_paths import MCP_CONFIG_PATH, API_DATA_DIR
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


# stdio transport 允许的可执行命令白名单（仅命令名，不含路径）。
# MCP 服务器子进程只能通过这些常见的运行器启动，防止任意命令执行。
# Windows 下自动兼容 .exe / .cmd / .bat 后缀。
_ALLOWED_STDIO_COMMANDS: frozenset[str] = frozenset({
    # Node.js 生态（MCP 官方示例几乎都是 npx 启动）
    "npx", "node", "npm", "bun", "bunx", "deno",
    # Python 生态
    "python", "python3", "py", "uvx", "uv", "pipx",
    # Go / Rust / 通用运行器
    "go", "cargo", "ruby", "java",
    # 容器隔离
    "docker", "podman",
})


def _validate_stdio_command(command: str) -> str:
    """校验 stdio 命令名在白名单内，防止任意可执行文件启动。

    接受裸命令名（如 ``npx``）或绝对/相对路径——后者取 basename 校验。
    Windows 下自动剥离 .exe / .cmd / .bat 后缀后再比对。
    """
    if not isinstance(command, str) or not command.strip():
        raise HTTPException(status_code=400, detail="stdio 模式必须指定 command")
    # 取命令本体（剥离路径和引号）
    bare = command.strip().strip('"').strip("'")
    # 处理 Windows 路径分隔符
    basename = bare.rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    # 剥离 Windows 可执行文件后缀
    lower = basename.lower()
    for ext in (".exe", ".cmd", ".bat"):
        if lower.endswith(ext):
            basename = basename[: -len(ext)]
            break
    if basename not in _ALLOWED_STDIO_COMMANDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"stdio 命令 '{basename}' 不在白名单中，"
                f"允许的命令: {', '.join(sorted(_ALLOWED_STDIO_COMMANDS))}"
            ),
        )
    return command


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
        d["command"] = _validate_stdio_command(body.command or "")
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
        # 若 update 提供了新 command，必须过白名单；否则复用 target 已有 command
        if update_fields.get("command"):
            _validate_stdio_command(update_fields["command"])
        elif not cmd:
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
async def get_discovered_mcp_servers(request: Request):
    """返回 OMP 自动发现的 MCP 服务器列表。"""
    try:
        sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
        if sidecar_mgr is None:
            return []
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is None:
            return []
        result = await client.call("get_discovered_mcp", {})
        return result if isinstance(result, list) else []
    except Exception as e:
        logger.warning("[mcp] Failed to fetch discovered MCP: %s", e)
        return []


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


# ═══════════════════════════════════════════════════════════════════════
# Smithery Registry 代理
# ═══════════════════════════════════════════════════════════════════════

SMITHERY_REGISTRY_URL = "https://registry.smithery.ai/servers"


@router.get("/mcp/registry")
async def get_mcp_registry(q: str = "", page: int = 1, page_size: int = 20):
    """代理 Smithery Registry API，浏览可用的 MCP 服务器。

    服务端转发请求以避免浏览器 CORS 限制。
    """
    params: dict = {"page": page, "pageSize": page_size}
    if q:
        params["q"] = q
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(SMITHERY_REGISTRY_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Smithery Registry 请求超时")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Smithery Registry 返回错误: {e.response.status_code}")
    except Exception as e:
        logger.warning("[mcp-registry] Failed to fetch registry: %s", e)
        raise HTTPException(status_code=502, detail=f"无法连接 Smithery Registry: {e}")

    # 标准化返回格式
    servers = []
    raw_servers = data.get("servers", data.get("results", []))
    if isinstance(raw_servers, list):
        for item in raw_servers:
            if not isinstance(item, dict):
                continue
            servers.append({
                "name": item.get("qualifiedName", item.get("name", "")),
                "display_name": item.get("displayName", item.get("name", "")),
                "description": item.get("description", ""),
                "author": item.get("owner", item.get("author", "")),
                "downloads": item.get("downloads", item.get("useCount", 0)),
                "icon_url": item.get("iconUrl", item.get("icon", "")),
                "verified": item.get("verified", False),
            })
    return {
        "servers": servers,
        "total": data.get("totalCount", data.get("total", len(servers))),
        "page": page,
        "page_size": page_size,
    }


@router.get("/mcp/registry/{name:path}")
async def get_mcp_registry_detail(name: str):
    """获取 Smithery Registry 中特定服务器的详细信息。"""
    url = f"{SMITHERY_REGISTRY_URL}/{name}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Smithery Registry 请求超时")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Registry 中未找到 '{name}'")
        raise HTTPException(status_code=502, detail=f"Smithery Registry 返回错误: {e.response.status_code}")
    except Exception as e:
        logger.warning("[mcp-registry] Failed to fetch detail for %s: %s", name, e)
        raise HTTPException(status_code=502, detail=f"无法连接 Smithery Registry: {e}")

    return {
        "name": data.get("qualifiedName", data.get("name", name)),
        "display_name": data.get("displayName", data.get("name", name)),
        "description": data.get("description", ""),
        "author": data.get("owner", data.get("author", "")),
        "downloads": data.get("downloads", data.get("useCount", 0)),
        "icon_url": data.get("iconUrl", data.get("icon", "")),
        "verified": data.get("verified", False),
        "readme": data.get("readme", ""),
        "config": data.get("config", {}),
        "connection": data.get("connection", {}),
    }


class RegistryInstallBody(BaseModel):
    """从 Registry 安装 MCP 服务器的请求体。"""
    name: str  # Registry 中的服务器名称
    server_id: str | None = None  # 可选自定义 ID，默认用 registry name
    config: dict | None = None  # 可选覆盖配置


@router.post("/mcp/registry/install")
async def install_from_registry(body: RegistryInstallBody, request: Request):
    """从 Smithery Registry 安装 MCP 服务器到本地配置。

    获取 registry 详情后，将服务器配置写入本地 mcp_servers.yaml。
    """
    name = body.name
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")

    # 先获取 registry 详情
    url = f"{SMITHERY_REGISTRY_URL}/{name}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Smithery Registry 请求超时")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Registry 中未找到 '{name}'")
        raise HTTPException(status_code=502, detail=f"Smithery Registry 返回错误: {e.response.status_code}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"无法连接 Smithery Registry: {e}")

    # 确定 server_id
    server_id = body.server_id or \
                data.get("qualifiedName", name).replace("/", "-").replace("@", "")

    # 从 registry 数据构建本地配置
    connection = data.get("connection", {})
    config_override = body.config or {}

    # 判断 transport 类型
    if connection.get("type") == "http" or connection.get("url"):
        transport = "streamable_http"
        server_url = config_override.get("url", connection.get("url", ""))
        server_dict: dict = {
            "server_id": server_id,
            "transport": transport,
            "enabled": True,
            "description": data.get("description", f"Installed from Smithery: {name}"),
            "url": server_url,
            "tls_verify": True,
        }
        if connection.get("headers"):
            server_dict["headers"] = connection["headers"]
    else:
        # 默认 stdio
        transport = "stdio"
        command = config_override.get("command", connection.get("command", "npx"))
        args = config_override.get("args", connection.get("args", []))
        if not args and name:
            args = ["-y", f"@smithery/{name}"]
        server_dict = {
            "server_id": server_id,
            "transport": transport,
            "enabled": True,
            "description": data.get("description", f"Installed from Smithery: {name}"),
            "command": command,
            "args": args,
        }
        env = config_override.get("env", connection.get("env"))
        if env:
            server_dict["env"] = env

    # 写入本地配置
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
        # 检查 ID 是否重复
        for entry in entries:
            if entry.get("server_id") == server_id:
                raise HTTPException(
                    status_code=409,
                    detail=f"server_id '{server_id}' 已存在，请使用其他名称或先删除已有配置",
                )
        entries.append(server_dict)
        _save_raw(entries)

    logger.info("[mcp-registry] Installed server from registry: %s (as %s)", name, server_id)
    result = await _do_reload(request)
    return {**result, "status": "installed", "server": _redact_sensitive(server_dict), "registry_name": name}


# ═══════════════════════════════════════════════════════════════════════
# OAuth 授权流程
# ═══════════════════════════════════════════════════════════════════════

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


@router.post("/mcp/oauth/authorize")
async def mcp_oauth_authorize(body: OAuthAuthorizeBody, request: Request):
    """发起 MCP 服务器的 OAuth 授权流程。

    生成 state 参数防 CSRF，构建授权 URL 返回给前端。
    前端在新窗口中打开 auth_url，用户授权后回调到 callback 端点。
    """
    server_name = body.server_name
    if not server_name:
        raise HTTPException(status_code=400, detail="server_name 不能为空")

    # 生成随机 state
    state = secrets.token_urlsafe(32)

    # 确定 redirect_uri
    redirect_uri = body.redirect_uri or f"http://localhost:17321/api/mcp/oauth/callback"

    # 确定授权端点（可从 registry 或自定义）
    auth_endpoint = body.auth_endpoint or ""
    if not auth_endpoint:
        # 尝试从 registry 获取 OAuth 配置
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{SMITHERY_REGISTRY_URL}/{server_name}")
                if resp.status_code == 200:
                    data = resp.json()
                    oauth_config = data.get("oauth", data.get("auth", {}))
                    auth_endpoint = oauth_config.get("authorization_url", oauth_config.get("authorize_url", ""))
        except Exception:
            pass

    if not auth_endpoint:
        # 使用通用 OAuth 端点格式
        auth_endpoint = f"https://auth.smithery.ai/authorize"

    # 暂存 state 信息
    _oauth_pending_states[state] = {
        "server_name": server_name,
        "redirect_uri": redirect_uri,
        "client_id": body.client_id or "maxma-desktop",
        "created_at": time.time(),
    }

    # 清理过期 state（超过 10 分钟）
    now = time.time()
    expired = [k for k, v in _oauth_pending_states.items() if now - v["created_at"] > 600]
    for k in expired:
        del _oauth_pending_states[k]

    # 构建授权 URL
    from urllib.parse import urlencode
    params = {
        "response_type": "code",
        "client_id": body.client_id or "maxma-desktop",
        "redirect_uri": redirect_uri,
        "state": state,
        "server": server_name,
    }
    if body.scope:
        params["scope"] = body.scope

    auth_url = f"{auth_endpoint}?{urlencode(params)}"

    return {
        "auth_url": auth_url,
        "state": state,
        "server_name": server_name,
    }


class OAuthCallbackBody(BaseModel):
    """OAuth 回调请求体。"""
    code: str
    state: str
    server_name: str | None = None


@router.post("/mcp/oauth/callback")
async def mcp_oauth_callback(body: OAuthCallbackBody):
    """处理 OAuth 回调，用 authorization code 换取 access token。"""
    # 验证 state
    pending = _oauth_pending_states.get(body.state)
    if not pending:
        raise HTTPException(status_code=400, detail="无效或已过期的 state 参数")

    server_name = body.server_name or pending["server_name"]
    client_id = pending["client_id"]
    redirect_uri = pending["redirect_uri"]

    # 用 code 换 token
    token_endpoint = f"https://auth.smithery.ai/token"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(token_endpoint, json={
                "grant_type": "authorization_code",
                "code": body.code,
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

    # 存储 token
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

    # 清除已使用的 state
    _oauth_pending_states.pop(body.state, None)

    logger.info("[mcp-oauth] OAuth authorized for server: %s", server_name)
    return {
        "status": "authorized",
        "server_name": server_name,
        "token_type": token_data.get("token_type", "Bearer"),
        "expires_in": token_data.get("expires_in", 3600),
    }


@router.get("/mcp/oauth/status/{server_name:path}")
async def mcp_oauth_status(server_name: str):
    """检查指定 MCP 服务器的 OAuth 授权状态。"""
    tokens = _load_oauth_tokens()
    token_info = tokens.get(server_name)

    if not token_info:
        return {
            "server_name": server_name,
            "authorized": False,
            "status": "not_authorized",
        }

    # 检查是否过期
    expires_at = token_info.get("expires_at", 0)
    is_expired = time.time() > expires_at
    has_refresh = bool(token_info.get("refresh_token"))

    if is_expired and not has_refresh:
        return {
            "server_name": server_name,
            "authorized": False,
            "status": "expired",
            "authorized_at": token_info.get("authorized_at"),
        }

    return {
        "server_name": server_name,
        "authorized": True,
        "status": "expired" if is_expired else "active",
        "token_type": token_info.get("token_type", "Bearer"),
        "scope": token_info.get("scope", ""),
        "authorized_at": token_info.get("authorized_at"),
        "expires_at": expires_at,
        "has_refresh_token": has_refresh,
    }
