"""MCP 工具管理器 — 从 YAML 配置加载的通用 MCP 客户端桥接框架。

所有 MCP 工具统一使用前端 ToolCallCard 兜底组件展示，
无需在 registry.ts 中注册专属气泡组件。
"""

import asyncio
import fnmatch
import functools
import logging
import time
from pathlib import Path
from typing import Annotated, Any, Literal, Union

import yaml
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from pydantic import BaseModel, Field, field_validator

from agent.audit_log import log_mcp_call
from app_paths import MCP_CONFIG_PATH
from tools.mcp_rate_limiter import get_mcp_rate_limiter
from tools.mcp_security import validate_stdio_command, validate_transport_url, validate_tls_config

logger = logging.getLogger(__name__)

_CONFIG_PATH = MCP_CONFIG_PATH

_client: MultiServerMCPClient | None = None
_tools: list[BaseTool] | None = None
_config: list["MCPServerConfig"] | None = None
_last_error: str | None = None

# 重载回调：由 server.py 在启动时注入，工具修改 YAML 后调用此回调触发异步重载
_reload_callback: Any = None


def set_reload_callback(callback) -> None:
    """注入 MCP 重载回调函数（由 api/server.py lifespan 调用）。"""
    global _reload_callback
    _reload_callback = callback


def trigger_reload() -> None:
    """同步触发 MCP 重载（供工具 _run 调用）。"""
    if _reload_callback is not None:
        try:
            _reload_callback()
        except Exception as exc:
            print(f"[mcp] 重载回调调用失败: {exc}")


# ═══════════════════════════════════════════════════════════════════════
# Pydantic 配置模型
# ═══════════════════════════════════════════════════════════════════════


class _BaseServerMixin(BaseModel):
    """所有 MCP 服务器配置变体共享的字段。"""

    server_id: str
    enabled: bool = True
    description: str = ""
    # 阶段 4.1：工具级 allowlist / blocklist
    allowed_tools: list[str] | None = None
    blocked_tools: list[str] | None = None


class StdioServerConfig(_BaseServerMixin):
    """stdio 传输 — 本地子进程。"""

    transport: Literal["stdio"] = "stdio"
    command: str
    args: list[str] = []
    env: dict[str, str] | None = None
    cwd: str | None = None

    @field_validator("command")
    @classmethod
    def _validate_command(cls, v: str) -> str:
        error = validate_stdio_command(v)
        if error:
            raise ValueError(error)
        return v

    def to_connection(self) -> dict[str, Any]:
        conn: dict[str, Any] = {
            "transport": "stdio",
            "command": self.command,
            "args": self.args,
        }
        if self.env is not None:
            conn["env"] = self.env
        if self.cwd is not None:
            conn["cwd"] = self.cwd
        return conn


class SSEServerConfig(_BaseServerMixin):
    """SSE 传输 — HTTP 服务器推送事件。"""

    transport: Literal["sse"] = "sse"
    url: str
    headers: dict[str, str] | None = None
    timeout: float | None = None
    sse_read_timeout: float | None = None
    tls_verify: bool = True

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        error = validate_transport_url(v, "sse")
        if error:
            raise ValueError(error)
        tls_error = validate_tls_config(v, True)
        if tls_error:
            raise ValueError(tls_error)
        return v

    def to_connection(self) -> dict[str, Any]:
        conn: dict[str, Any] = {
            "transport": "sse",
            "url": self.url,
        }
        if self.headers is not None:
            conn["headers"] = self.headers
        if self.timeout is not None:
            conn["timeout"] = self.timeout
        if self.sse_read_timeout is not None:
            conn["sse_read_timeout"] = self.sse_read_timeout
        return conn


class StreamableHttpServerConfig(_BaseServerMixin):
    """Streamable HTTP 传输 — MCP 2025-03-26 规范。"""

    transport: Literal["streamable_http"] = "streamable_http"
    url: str
    headers: dict[str, str] | None = None
    timeout: float | None = None
    tls_verify: bool = True

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        error = validate_transport_url(v, "streamable_http")
        if error:
            raise ValueError(error)
        tls_error = validate_tls_config(v, True)
        if tls_error:
            raise ValueError(tls_error)
        return v

    def to_connection(self) -> dict[str, Any]:
        conn: dict[str, Any] = {
            "transport": "streamable_http",
            "url": self.url,
        }
        if self.headers is not None:
            conn["headers"] = self.headers
        if self.timeout is not None:
            conn["timeout"] = self.timeout
        return conn


class WebsocketServerConfig(_BaseServerMixin):
    """WebSocket 传输。"""

    transport: Literal["websocket"] = "websocket"
    url: str
    tls_verify: bool = True

    @field_validator("url")
    @classmethod
    def _validate_url(cls, v: str) -> str:
        error = validate_transport_url(v, "websocket")
        if error:
            raise ValueError(error)
        tls_error = validate_tls_config(v, True)
        if tls_error:
            raise ValueError(tls_error)
        return v

    def to_connection(self) -> dict[str, Any]:
        return {"transport": "websocket", "url": self.url}


MCPServerConfig = Annotated[
    Union[
        StdioServerConfig,
        SSEServerConfig,
        StreamableHttpServerConfig,
        WebsocketServerConfig,
    ],
    Field(discriminator="transport"),
]


class MCPServersConfigFile(BaseModel):
    """config/mcp_servers.yaml 的根结构。"""

    mcp_servers: list[MCPServerConfig] = []


# ═══════════════════════════════════════════════════════════════════════
# 配置加载
# ═══════════════════════════════════════════════════════════════════════


def load_mcp_config() -> list[MCPServerConfig]:
    """解析并验证 config/mcp_servers.yaml。"""
    global _last_error, _config

    if _config is not None:
        return _config

    if not _CONFIG_PATH.exists():
        _config = []
        return []

    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        validated = MCPServersConfigFile(**raw)
        _config = validated.mcp_servers
        _last_error = None
        return _config
    except Exception as exc:
        _last_error = f"加载 MCP 配置失败: {exc}"
        print(f"[mcp] {_last_error}")
        _config = []
        return []


# ═══════════════════════════════════════════════════════════════════════
# 阶段 4.1：工具级 allowlist / blocklist 过滤
# ═══════════════════════════════════════════════════════════════════════


def _filter_tool_by_name(
    tool_name_with_prefix: str,
    server_id: str,
    allowed_tools: list[str] | None,
    blocked_tools: list[str] | None,
) -> bool:
    """判断工具是否应被保留（True=保留，False=过滤掉）。

    工具名格式：{server_id}_{tool_name}（langchain-mcp-adapters 自动加前缀）。
    allowlist/blocklist 内的名称可以是：
    - 完整工具名（不含 server_id 前缀）
    - 通配符模式（如 `github_*`，用 fnmatch 匹配）
    - 含前缀的完整名（如 `github_search`，兼容用户填写）

    Args:
        tool_name_with_prefix: 含 server_id 前缀的工具名
        server_id: 服务器 ID
        allowed_tools: 允许列表（None 表示不限制）
        blocked_tools: 屏蔽列表（None 表示不屏蔽）

    Returns:
        True 保留，False 过滤
    """
    prefix = f"{server_id}_"
    if tool_name_with_prefix.startswith(prefix):
        short_name = tool_name_with_prefix[len(prefix):]
    else:
        short_name = tool_name_with_prefix

    # blocklist 优先
    if blocked_tools:
        for pattern in blocked_tools:
            # 同时匹配短名和完整名
            if fnmatch.fnmatch(short_name, pattern) or fnmatch.fnmatch(tool_name_with_prefix, pattern):
                return False

    # allowlist：未配置 = 全部允许
    if allowed_tools:
        for pattern in allowed_tools:
            if fnmatch.fnmatch(short_name, pattern) or fnmatch.fnmatch(tool_name_with_prefix, pattern):
                return True
        # 配了 allowlist 但未命中 = 过滤
        return False

    return True


# ═══════════════════════════════════════════════════════════════════════
# 阶段 4.2 + 4.4：_wrap_tool_with_safety — 审计 + 限流单一装饰器
# ═══════════════════════════════════════════════════════════════════════


def _summarize(value: Any, max_len: int = 200) -> str:
    """生成入参/结果的摘要字符串（截断 + 脱敏占位）。"""
    try:
        s = str(value)
    except Exception:
        s = "<unrepresentable>"
    if len(s) > max_len:
        return s[:max_len] + "..."
    return s


def _wrap_tool_with_safety(tool: BaseTool, server_id: str) -> BaseTool:
    """包装 MCP BaseTool 的 _run / _arun，注入审计日志 + 速率限制。

    - 调用前：try_acquire 限流，超限直接返回 format_error（不抛异常，避免触发
      CircuitBreaker 的失败计数）
    - 调用后：log_mcp_call 记录审计日志（含耗时/状态/错误）

    保留原工具的 name / description / args_schema，确保 LLM 能正确调用。
    """
    original_run = tool._run
    original_arun = tool._arun

    def _make_args_summary(*args, **kwargs) -> str:
        parts = []
        if args:
            parts.append(_summarize(args, max_len=300))
        if kwargs:
            parts.append(_summarize(kwargs, max_len=300))
        return " | ".join(parts) if parts else ""

    def _run_with_safety(*args, **kwargs):
        limiter = get_mcp_rate_limiter()
        allowed, info = limiter.try_acquire(server_id)
        if not allowed:
            # 限流：写审计日志并返回结构化错误（不抛异常）
            log_mcp_call(
                server_id=server_id,
                tool_name=tool.name,
                args_summary=_make_args_summary(*args, **kwargs),
                status="rate_limited",
                error=f"rate limit: retry_after={info['retry_after']}s",
            )
            return {
                "ok": False,
                "error": "MCP 工具调用速率超限，请稍后重试",
                "code": "RATE_LIMITED",
                "details": info,
            }

        start = time.monotonic()
        try:
            result = original_run(*args, **kwargs)
            duration_ms = int((time.monotonic() - start) * 1000)
            # 异步写日志（同步 _run 用线程）
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                # 无事件循环，直接同步写
                log_mcp_call(
                    server_id=server_id,
                    tool_name=tool.name,
                    args_summary=_make_args_summary(*args, **kwargs),
                    result_summary=_summarize(result),
                    duration_ms=duration_ms,
                    status="ok",
                )
            else:
                # 在事件循环中（不应发生在 _run，但兜底）
                log_mcp_call(
                    server_id=server_id,
                    tool_name=tool.name,
                    args_summary=_make_args_summary(*args, **kwargs),
                    result_summary=_summarize(result),
                    duration_ms=duration_ms,
                    status="ok",
                )
            return result
        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            log_mcp_call(
                server_id=server_id,
                tool_name=tool.name,
                args_summary=_make_args_summary(*args, **kwargs),
                duration_ms=duration_ms,
                status="error",
                error=str(exc),
            )
            raise

    async def _arun_with_safety(*args, **kwargs):
        limiter = get_mcp_rate_limiter()
        allowed, info = limiter.try_acquire(server_id)
        if not allowed:
            log_mcp_call(
                server_id=server_id,
                tool_name=tool.name,
                args_summary=_make_args_summary(*args, **kwargs),
                status="rate_limited",
                error=f"rate limit: retry_after={info['retry_after']}s",
            )
            return {
                "ok": False,
                "error": "MCP 工具调用速率超限，请稍后重试",
                "code": "RATE_LIMITED",
                "details": info,
            }

        start = time.monotonic()
        try:
            result = await original_arun(*args, **kwargs)
            duration_ms = int((time.monotonic() - start) * 1000)
            # 异步写日志避免阻塞 Agent 主循环
            await asyncio.to_thread(
                log_mcp_call,
                server_id=server_id,
                tool_name=tool.name,
                args_summary=_make_args_summary(*args, **kwargs),
                result_summary=_summarize(result),
                duration_ms=duration_ms,
                status="ok",
            )
            return result
        except Exception as exc:
            duration_ms = int((time.monotonic() - start) * 1000)
            await asyncio.to_thread(
                log_mcp_call,
                server_id=server_id,
                tool_name=tool.name,
                args_summary=_make_args_summary(*args, **kwargs),
                duration_ms=duration_ms,
                status="error",
                error=str(exc),
            )
            raise

    tool._run = functools.wraps(original_run)(_run_with_safety)
    tool._arun = functools.wraps(original_arun)(_arun_with_safety)
    return tool


# ═══════════════════════════════════════════════════════════════════════
# 生命周期
# ═══════════════════════════════════════════════════════════════════════


async def init_mcp_tools() -> list[BaseTool]:
    """从 YAML 加载配置并初始化 MCP 客户端。

    仅连接 enabled=True 的服务器，工具名自动加 {serverId}_ 前缀。
    阶段 4.1：按 allowed_tools / blocked_tools 过滤工具。
    阶段 4.2/4.4：用 _wrap_tool_with_safety 包装每个工具（审计 + 限流）。
    """
    global _client, _tools, _last_error

    if _tools is not None:
        return _tools

    configs = load_mcp_config()
    enabled = [c for c in configs if c.enabled]
    if not enabled:
        _tools = []
        return _tools

    connections: dict[str, Any] = {}
    server_errors: list[str] = []

    for cfg in enabled:
        try:
            connections[cfg.server_id] = cfg.to_connection()
        except Exception as exc:
            msg = f"服务器 '{cfg.server_id}' 连接构建失败: {exc}"
            server_errors.append(msg)
            logger.warning(msg)

    if not connections:
        _tools = []
        if server_errors:
            _last_error = "; ".join(server_errors)
        return _tools

    try:
        _client = MultiServerMCPClient(
            connections=connections,
            tool_name_prefix=True,
        )
        raw_tools = await _client.get_tools()
        _last_error = None

        # 阶段 4.1：按 server_id 分组，应用 allowlist/blocklist 过滤
        # 阶段 4.2/4.4：对保留的工具应用 _wrap_tool_with_safety 包装
        filtered_tools: list[BaseTool] = []
        for cfg in enabled:
            prefix = f"{cfg.server_id}_"
            server_tools = [t for t in raw_tools if t.name.startswith(prefix)]

            kept = 0
            blocked = 0
            for t in server_tools:
                if _filter_tool_by_name(
                    t.name, cfg.server_id, cfg.allowed_tools, cfg.blocked_tools
                ):
                    wrapped = _wrap_tool_with_safety(t, cfg.server_id)
                    filtered_tools.append(wrapped)
                    kept += 1
                else:
                    blocked += 1

            if cfg.allowed_tools or cfg.blocked_tools:
                logger.info(
                    "[mcp] 服务器 '%s' 工具过滤: 保留 %d 个, 屏蔽 %d 个 (allowed=%s, blocked=%s)",
                    cfg.server_id, kept, blocked,
                    cfg.allowed_tools, cfg.blocked_tools,
                )
            else:
                logger.info(
                    "[mcp] 服务器 '%s' 已加载 %d 个工具（已包装审计+限流）",
                    cfg.server_id, kept,
                )

        _tools = filtered_tools
    except Exception as exc:
        _last_error = f"初始化 MCP 客户端失败: {exc}"
        logger.exception(_last_error)
        _tools = []

    return _tools


async def close_mcp():
    """释放 MCP 客户端资源。

    MultiServerMCPClient v0.2.2 没有 close() 方法（会话是短暂的，
    每次工具调用创建/销毁），这里仅重置模块级状态。
    """
    global _client, _tools, _config, _last_error
    _client = None
    _tools = None
    _config = None
    _last_error = None


# ═══════════════════════════════════════════════════════════════════════
# 热加载 & 查询
# ═══════════════════════════════════════════════════════════════════════


async def reload_mcp() -> list[BaseTool]:
    """重新加载 MCP 配置并重建连接。

    失败时保留旧状态不变。
    """
    global _client, _tools, _config, _last_error

    old_client = _client
    old_tools = _tools
    old_config = _config
    old_error = _last_error

    # 清除缓存，强制重新加载
    _client = None
    _tools = None
    _config = None
    _last_error = None

    try:
        result = await init_mcp_tools()
        if _last_error is not None:
            raise RuntimeError(_last_error)
        if result is None:
            result = []
        return result
    except Exception as exc:
        # 恢复旧状态
        _client = old_client
        _tools = old_tools
        _config = old_config
        _last_error = old_error
        raise


def get_mcp_servers_info() -> list[dict[str, Any]]:
    """返回序列化的服务器配置（供 API 使用）。"""
    global _config
    if _config is None:
        load_mcp_config()

    if not _config:
        return []

    result = []
    for c in _config:
        info: dict[str, Any] = {
            "server_id": c.server_id,
            "transport": c.transport,
            "enabled": c.enabled,
            "description": c.description,
            "allowed_tools": getattr(c, "allowed_tools", None),
            "blocked_tools": getattr(c, "blocked_tools", None),
        }
        # tls_verify 仅对 URL 类 transport 有意义
        if c.transport in ("sse", "streamable_http", "websocket"):
            info["tls_verify"] = getattr(c, "tls_verify", True)
        if _tools:
            prefix = f"{c.server_id}_"
            info["tool_count"] = sum(1 for t in _tools if t.name.startswith(prefix))
        else:
            info["tool_count"] = 0
        result.append(info)
    return result


def get_mcp_error() -> str | None:
    """返回最近一次的错误信息（无错误则返回 None）。"""
    return _last_error


def get_mcp_server_tools(server_id: str) -> list[str]:
    """返回指定 MCP 服务器加载到的工具名列表（阶段 4.1）。

    工具名含 {server_id}_ 前缀，与 _tools 中保持一致。
    若服务器不存在或未加载工具，返回空列表。
    """
    if not _tools:
        return []
    prefix = f"{server_id}_"
    return [t.name for t in _tools if t.name.startswith(prefix)]
