"""mcp_validation.py — MCP 配置校验与敏感信息脱敏（从 mcp.py 拆分，S2-4）。"""

import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)

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


