"""MCP 安全校验 — stdio 命令白名单 + transport URL 白名单 + TLS 校验。

stdio 传输通过本地子进程执行命令，若允许任意命令则等同于命令执行后门。
SSE/HTTP/WebSocket transport 通过 URL 连接远程服务器，若不限制则可连接
任意内网/外网地址，存在 SSRF 风险。

本模块提供两类校验：
1. ``validate_stdio_command`` — stdio 命令白名单
2. ``validate_transport_url`` / ``validate_tls_config`` — URL scheme/host/port + TLS 校验
"""

import logging
import os
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# 允许的 stdio 命令基名（大小写不敏感）。
# 仅允许无路径分隔符的简单命令名，由系统 PATH 解析。
# 需要新增时请评估：该命令是否会执行用户可控的任意代码/脚本。
_ALLOWED_STDIO_COMMANDS: frozenset[str] = frozenset({
    "npx",
    "node",
    "python",
    "python3",
    "uvx",
    "uv",
    "pip",
    "pip3",
    "go",
    "cargo",
    "rustc",
    "java",
    "javac",
    "dotnet",
    "ruby",
    "gem",
    "php",
    "composer",
    "git",
    "docker",
    "docker-compose",
    "podman",
    "bash",
    "sh",
    "zsh",
    "pwsh",
    "powershell",
    "cmd",
    "deno",
    "bun",
    "tsx",
    "ts-node",
    "maven",
    "mvn",
    "gradle",
    "make",
    "cmake",
})


def validate_stdio_command(command: str | None) -> str | None:
    """校验 stdio 命令是否在白名单中。

    安全策略：
    - 硬拒绝：空命令、含路径分隔符的命令、相对路径命令（防目录遍历）
    - 白名单内的命令直接通过
    - 白名单外的命令记录警告日志但不拒绝（用户自主决策）

    Args:
        command: 用户配置的命令字符串。

    Returns:
        None 表示通过（白名单内或白名单外但不阻断）。
        非 None 字符串表示硬错误（阻断配置保存）。
        白名单外命令的警告通过日志记录，不影响返回值。
    """
    if not command or not command.strip():
        return "stdio 命令不能为空"

    cmd = command.strip()

    # 拒绝任何路径分隔符，防止调用任意路径的可执行文件。
    if os.path.sep in cmd or (os.path.altsep and os.path.altsep in cmd):
        return f"stdio 命令不能包含路径分隔符: {command}"

    # 拒绝相对路径修饰符与目录遍历。
    if cmd.startswith((".", "~")) or cmd.startswith(".."):
        return f"stdio 命令不能以相对路径开头: {command}"

    # 统一去除 Windows .exe 后缀后比较。
    basename = cmd
    if basename.lower().endswith(".exe"):
        basename = basename[:-4]

    # 白名单校验：白名单外命令记录警告但不阻断
    allowed_lower = {c.lower() for c in _ALLOWED_STDIO_COMMANDS}
    if basename.lower() not in allowed_lower:
        logger.warning(
            "[mcp_security] stdio 命令 '%s' 不在推荐白名单中，"
            "用户需自行确保该命令安全。推荐命令: %s",
            command,
            ", ".join(sorted(_ALLOWED_STDIO_COMMANDS)),
        )

    return None


def is_command_whitelisted(command: str | None) -> bool:
    """检查命令是否在推荐白名单中（不阻断，仅用于 UI 提示）。

    Args:
        command: 用户配置的命令字符串。

    Returns:
        True 表示在白名单中，False 表示不在（需用户注意）。
    """
    if not command or not command.strip():
        return False

    cmd = command.strip()
    basename = cmd
    if basename.lower().endswith(".exe"):
        basename = basename[:-4]

    allowed_lower = {c.lower() for c in _ALLOWED_STDIO_COMMANDS}
    return basename.lower() in allowed_lower


# ═══════════════════════════════════════════════════════════════════════
# Transport URL 白名单 + TLS 校验（阶段 4.3）
# ═══════════════════════════════════════════════════════════════════════

# 允许的 URL scheme — 与 transport 类型对应
_ALLOWED_URL_SCHEMES: dict[str, frozenset[str]] = {
    "sse": frozenset({"http", "https"}),
    "streamable_http": frozenset({"http", "https"}),
    "websocket": frozenset({"ws", "wss"}),
}

# 默认允许的 host（本地开发地址）
_DEFAULT_ALLOWED_HOSTS: frozenset[str] = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
})

# 拒绝的 host 模式（防止 SSRF）— 任何时候都不允许
_BLOCKED_HOST_PATTERNS: tuple[str, ...] = (
    "169.254.169.254",  # AWS metadata
    "metadata.google.internal",  # GCP metadata
    "metadata.azure.com",  # Azure metadata
)


def _get_allowed_hosts() -> set[str]:
    """从 settings 获取允许的 host 列表（含默认值）。"""
    try:
        from config.settings import get_settings
        s = get_settings()
        return set(s.mcp_allowed_url_hosts) | _DEFAULT_ALLOWED_HOSTS
    except Exception:
        return set(_DEFAULT_ALLOWED_HOSTS)


def _get_allowed_ports() -> set[int] | None:
    """从 settings 获取允许的端口列表，None 表示不限制。"""
    try:
        from config.settings import get_settings
        s = get_settings()
        return set(s.mcp_allowed_url_ports) if s.mcp_allowed_url_ports else None
    except Exception:
        return None


def _is_force_tls() -> bool:
    """是否强制 TLS（生产模式）。"""
    try:
        from config.settings import get_settings
        s = get_settings()
        return s.mcp_force_tls
    except Exception:
        return False


def validate_transport_url(url: str | None, transport: str) -> str | None:
    """校验 transport URL 的 scheme、host、端口是否合规。

    Args:
        url: 用户配置的 URL 字符串
        transport: transport 类型（sse / streamable_http / websocket）

    Returns:
        错误信息（如果无效），None 表示有效。
    """
    if not url or not url.strip():
        return f"{transport} URL 不能为空"

    try:
        parsed = urlparse(url.strip())
    except Exception as exc:
        return f"URL 解析失败: {exc}"

    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()

    # 1. scheme 与 transport 匹配校验
    allowed_schemes = _ALLOWED_URL_SCHEMES.get(transport)
    if allowed_schemes is None:
        return f"不支持的 transport 类型: {transport}"
    if scheme not in allowed_schemes:
        return (
            f"{transport} transport 仅允许 {sorted(allowed_schemes)} 协议，"
            f"实际为 '{scheme}'"
        )

    # 2. host 非空
    if not host:
        return f"URL 缺少 host: {url}"

    # 3. 拒绝元数据服务地址（防 SSRF）
    for blocked in _BLOCKED_HOST_PATTERNS:
        if host == blocked or host.endswith("." + blocked):
            return f"URL host '{host}' 被禁止（元数据服务地址）"

    # 4. host 白名单校验
    allowed_hosts = _get_allowed_hosts()
    if host not in allowed_hosts:
        return (
            f"URL host '{host}' 不在白名单中。允许: {sorted(allowed_hosts)}"
        )

    # 5. 端口白名单校验
    allowed_ports = _get_allowed_ports()
    if allowed_ports is not None:
        port = parsed.port
        # port is None means default port for the scheme
        if port is not None and port not in allowed_ports:
            return (
                f"URL 端口 {port} 不在允许范围。允许: {sorted(allowed_ports)}"
            )

    return None


def validate_tls_config(url: str | None, tls_verify: bool = True) -> str | None:
    """校验 TLS 配置是否满足安全要求。

    生产模式（mcp_force_tls=True）下：
    - http/ws 协议被拒绝（必须使用 https/wss）
    - tls_verify=False 会被忽略并记录警告

    Args:
        url: 用户配置的 URL 字符串
        tls_verify: 是否启用 TLS 证书校验

    Returns:
        错误信息（如果无效），None 表示有效。
    """
    if not url:
        return None  # URL 非空校验由 validate_transport_url 负责

    try:
        parsed = urlparse(url.strip())
    except Exception:
        return None

    scheme = (parsed.scheme or "").lower()
    force_tls = _is_force_tls()

    if force_tls:
        # 生产模式：强制 HTTPS/WSS
        if scheme in ("http", "ws"):
            return (
                f"生产模式下 {scheme} 协议被禁止，必须使用 "
                f"{'https' if scheme == 'http' else 'wss'}"
            )
        if not tls_verify:
            logger.warning(
                "[mcp_security] 生产模式下忽略 tls_verify=False，强制启用 TLS 校验: %s",
                url,
            )

    return None

