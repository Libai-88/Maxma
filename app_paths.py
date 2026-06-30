"""
应用路径解析 — 兼容开发模式和 PyInstaller 打包模式。

开发模式：BUNDLE_DIR 和 DATA_DIR 都指向项目根目录。
打包模式：BUNDLE_DIR 指向 PyInstaller 解压的临时目录（只读），
          DATA_DIR 指向 %APPDATA%/MaxmaHere/（可写，用户数据持久化）。
"""

import os
import sys
from pathlib import Path


def _is_frozen() -> bool:
    """是否运行在 PyInstaller 打包环境中。"""
    return getattr(sys, "frozen", False)


def _get_bundle_dir() -> Path:
    """获取打包资源目录（只读）。

    开发模式：项目根目录（__file__ 的父目录）。
    打包模式：PyInstaller 解压的 _MEIxxxxxx 临时目录。
    """
    if _is_frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def _get_data_dir() -> Path:
    """获取用户数据目录（可写）。

    开发模式：项目根目录（与 BUNDLE_DIR 相同）。
    打包模式：%APPDATA%/MaxmaHere/（Windows）或 ~/.maxmahere/（其他）。
    """
    if _is_frozen():
        if sys.platform == "win32":
            base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path.home() / ".maxmahere"
            return base
        return base / "MaxmaHere"
    # 开发模式：数据就在项目根目录
    return Path(__file__).resolve().parent


# ── 公共常量 ──

# 打包资源根目录（只读：前端 dist、anthropic_skills、macros 等）
BUNDLE_DIR: Path = _get_bundle_dir()

# 用户数据根目录（可写：memory、sessions、uploads、logs 等）
DATA_DIR: Path = _get_data_dir()

# ── 常用子路径快捷方式 ──

# 打包资源（只读）
WEB_DIST_DIR = BUNDLE_DIR / "web" / "dist"
ANTHROPIC_SKILLS_DIR = BUNDLE_DIR / "anthropic_skills"
MACROS_DIR = BUNDLE_DIR / "macros"
CONFIG_DIR = BUNDLE_DIR / "config"
PERSONAS_DIR = CONFIG_DIR / "personas"  # 只读模板目录（打包模式下位于 _MEIPASS）

# 用户数据（可写）
PERSONAS_DATA_DIR = DATA_DIR / "config" / "personas"  # 可写人设目录（打包模式下位于 %APPDATA%）
API_DATA_DIR = DATA_DIR / "api" / "data"
LOGS_DIR = DATA_DIR / "logs"
UPLOADS_DIR = DATA_DIR / "uploads"
AUTH_TOKEN_PATH = API_DATA_DIR / "auth_token.yaml"
CONST_SESSIONS_DIR = API_DATA_DIR / "const-sessions"
MEMORY_CONFIG_PATH = PERSONAS_DATA_DIR / "memory.yaml"
SOUL_MD_PATH = PERSONAS_DATA_DIR / "SOUL.md"
USER_MD_PATH = PERSONAS_DATA_DIR / "USER.md"
ENV_FILE_PATH = DATA_DIR / ".env"
MCP_CONFIG_PATH = CONFIG_DIR / "mcp_servers.yaml"
PROVIDERS_YAML_PATH = API_DATA_DIR / "providers.yaml"
NEWS_YAML_PATH = API_DATA_DIR / "news.yaml"
PATH_WHITELIST_YAML_PATH = API_DATA_DIR / "path_whitelist.yaml"
MAXMA_BLOCKER_YAML_PATH = API_DATA_DIR / "maxma_blocker.yaml"

# 项目根目录（仅开发模式使用，打包模式下无意义）
PROJECT_ROOT: Path = BUNDLE_DIR if not _is_frozen() else DATA_DIR


def ensure_data_dirs():
    """确保所有用户数据目录存在（首次运行时自动创建）。"""
    for d in [API_DATA_DIR, LOGS_DIR, UPLOADS_DIR, CONST_SESSIONS_DIR, PERSONAS_DATA_DIR]:
        d.mkdir(parents=True, exist_ok=True)
