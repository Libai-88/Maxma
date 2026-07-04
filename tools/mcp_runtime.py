"""MCP 运行时命令解析 — 把白名单命令解析到嵌入式运行时绝对路径。

打包模式下，用户机器可能没有 Node.js / Python / uv，
本模块负责把 MCP 配置中的命令名（如 "npx"）解析到 RUNTIME_DIR 下的绝对路径，
并构造子进程环境变量（PLAYWRIGHT_BROWSERS_PATH、PATH 前置等）。

开发模式下回退到系统 PATH 查找，保持开发体验。
"""

import logging
import shutil

from app_paths import (
    BUNDLE_DIR,
    NODE_EXE,
    NODE_NPX_CMD,
    PLAYWRIGHT_BROWSERS_PATH,
    PYTHON_EMBED_EXE,
    RUNTIME_DIR,
    UV_EXE,
    _is_frozen,
)

logger = logging.getLogger(__name__)

# PyInstaller 打包模式标志
IS_FROZEN: bool = _is_frozen()

# 命令名 → 模块级常量名（动态查找，便于测试 monkeypatch）
_COMMAND_ATTR: dict[str, str] = {
    "node": "NODE_EXE",
    "npx": "NODE_NPX_CMD",
    "python": "PYTHON_EMBED_EXE",
    "python3": "PYTHON_EMBED_EXE",
    "uvx": "UV_EXE",
}


def resolve_mcp_command(command: str) -> str:
    """把 MCP 配置中的命令名解析为嵌入式运行时的绝对路径。

    打包模式：优先使用 RUNTIME_DIR 下的二进制
    开发模式：回退到系统 PATH 查找（保持开发体验）

    Args:
        command: 用户配置的命令名（如 "npx" / "node" / "python"）

    Returns:
        解析后的命令路径（绝对路径或系统 PATH 查找结果）
    """
    if not command:
        return command

    if IS_FROZEN and command in _COMMAND_ATTR:
        # 动态读取模块级常量，避免在导入时固化引用（便于测试 monkeypatch）
        resolved = globals()[_COMMAND_ATTR[command]]
        if resolved.exists():
            return str(resolved)
        # 运行时文件不存在时降级到系统 PATH
        logger.warning(
            "[mcp_runtime] 嵌入式运行时缺失: %s, 回退到系统 PATH",
            resolved,
        )

    # 开发模式或回退：系统 PATH 查找
    return shutil.which(command) or command


def build_mcp_env(base_env: dict | None = None) -> dict:
    """构造 MCP 子进程环境变量。

    打包模式下注入：
    - PLAYWRIGHT_BROWSERS_PATH: 指向嵌入式 Chromium
    - PATH 前置嵌入式运行时目录（node / python / uv）

    Args:
        base_env: 用户配置的环境变量（来自 YAML）

    Returns:
        合并后的环境变量字典
    """
    env = (base_env or {}).copy()

    if not IS_FROZEN:
        return env

    # 注入 Playwright 浏览器路径
    env["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)

    # PATH 前置嵌入式运行时目录
    runtime_dirs = [
        str(NODE_EXE.parent),
        str(PYTHON_EMBED_EXE.parent),
        str(UV_EXE.parent),
    ]
    existing_path = env.get("PATH", "")
    env["PATH"] = ";".join([*runtime_dirs, existing_path]) if existing_path else ";".join(runtime_dirs)

    return env
