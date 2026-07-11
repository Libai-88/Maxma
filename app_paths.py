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
SKILLS_DATA_DIR = DATA_DIR / "anthropic_skills"  # 用户自定义 skills（打包模式下位于 %APPDATA%）
MACROS_DATA_DIR = DATA_DIR / "macros"  # 用户自定义 macros
API_DATA_DIR = DATA_DIR / "api" / "data"
LOGS_DIR = DATA_DIR / "logs"
UPLOADS_DIR = DATA_DIR / "uploads"
VECTOR_DB_DIR = DATA_DIR / "vector_db"  # chromadb 向量数据库持久化目录
KB_DIR = DATA_DIR / "knowledge_base"  # 知识库原始文档副本
AUTH_TOKEN_PATH = API_DATA_DIR / "auth_token.yaml"
CONST_SESSIONS_DIR = API_DATA_DIR / "const-sessions"
MEMORY_CONFIG_PATH = PERSONAS_DATA_DIR / "memory.yaml"
EPISODIC_MEMORY_PATH = API_DATA_DIR / "episodic_memory.json"  # 情景记忆 JSON 存储
SEMANTIC_MEMORY_PATH = API_DATA_DIR / "semantic_memory.json"  # 语义记忆 JSON 存储
FACT_STORE_PATH = API_DATA_DIR / "facts.db"  # FTS5/CJK 补充事实检索（默认不开启）
MEMORY_TICKER_STATE_PATH = API_DATA_DIR / "memory_ticker_state.json"
SOUL_MD_PATH = PERSONAS_DATA_DIR / "SOUL.md"
USER_MD_PATH = PERSONAS_DATA_DIR / "USER.md"
ACTIVE_PERSONA_PATH = PERSONAS_DATA_DIR / "active_persona.yaml"
ENV_FILE_PATH = DATA_DIR / ".env"
MCP_CONFIG_PATH = API_DATA_DIR / "mcp_servers.yaml"
WORKFLOW_JOURNAL_PATH = API_DATA_DIR / "workflow_journal.sqlite"
PROVIDERS_YAML_PATH = API_DATA_DIR / "providers.yaml"
# Migration backups are intentionally separate from the live configuration.
# They are created once, before a legacy credential is rewritten in-place.
CREDENTIAL_MIGRATION_BACKUP_DIR = API_DATA_DIR / "credential-migration-backups"
PROVIDER_CREDENTIAL_BACKUP_PATH = CREDENTIAL_MIGRATION_BACKUP_DIR / "providers.yaml.v1-migration.bak"
PROVIDER_DB_CREDENTIAL_BACKUP_PATH = CREDENTIAL_MIGRATION_BACKUP_DIR / "maxma.db.v1-migration.bak"
NEWS_YAML_PATH = API_DATA_DIR / "news.yaml"
PATH_WHITELIST_YAML_PATH = API_DATA_DIR / "path_whitelist.yaml"
MAXMA_BLOCKER_YAML_PATH = API_DATA_DIR / "maxma_blocker.yaml"
EVENT_HOOKS_YAML_PATH = API_DATA_DIR / "event_hooks.yaml"
# User-created, read-only autonomous Scout schedules.  This is deliberately
# separate from event hooks: schedules retain a frozen permission/budget
# snapshot and must not inherit hook actions after creation.
AUTONOMY_SCHEDULES_PATH = API_DATA_DIR / "autonomy_schedules.json"

# 项目根目录（仅开发模式使用，打包模式下无意义）
PROJECT_ROOT: Path = BUNDLE_DIR if not _is_frozen() else DATA_DIR


# ── 运行时资源目录（嵌入式运行时 + 大文件） ──
# 打包模式: Tauri 安装目录下的 resources/ 目录（由 main.rs 通过 MAXMA_RESOURCES_DIR 注入）
# 开发模式: BUNDLE_DIR/../resources/（便于调试，目录不存在时不影响功能）
#
# 多级 fallback：
# 1. MAXMA_RESOURCES_DIR 环境变量（Tauri 注入，正常情况）
# 2. BUNDLE_DIR.parent / "resources"（开发模式）
# 3. sys.executable 父目录 / "resources"（Tauri 安装目录 fallback：
#    PyInstaller onefile 下 sys.executable 是 maxma-server.exe，
#    它和 resources/ 同处 Tauri 安装目录）
# 4. 上述候选中第一个真实存在的目录；都不存在则用 MAXMA_RESOURCES_DIR（保持原行为）


def _resolve_runtime_dir() -> Path:
    """解析运行时资源目录，多级 fallback 保证能在 Tauri 安装目录下找到 resources/。

    修复历史：Tauri 的 app.path().resource_dir() 在某些环境下返回 "."（unwrap 失败），
    导致 MAXMA_RESOURCES_DIR="." → ONNX_MODEL_PATH.exists()=False → 反复尝试 HuggingFace
    下载并 SSL 失败。该 fallback 通过 sys.executable 推导出 Tauri 安装目录。
    """
    candidates: list[Path] = []
    env_val = os.environ.get("MAXMA_RESOURCES_DIR")
    if env_val:
        candidates.append(Path(env_val))
    candidates.append(BUNDLE_DIR.parent / "resources")
    if _is_frozen():
        # PyInstaller onefile: sys.executable = maxma-server.exe 的真实路径，
        # resources/ 与之同目录（Tauri 安装目录结构）
        candidates.append(Path(sys.executable).resolve().parent / "resources")

    for c in candidates:
        try:
            if c.exists() and (c / "assets").exists():
                return c
        except (OSError, ValueError):
            continue
    # 都不匹配时返回第一个候选（保持旧行为，让下游 .exists() 检查会自然返回 False）
    return candidates[0] if candidates else (BUNDLE_DIR.parent / "resources")


RUNTIME_DIR: Path = _resolve_runtime_dir()

# 嵌入式运行时二进制路径
NODE_EXE = RUNTIME_DIR / "runtime" / "node" / "node.exe"
NODE_NPX_CMD = RUNTIME_DIR / "runtime" / "node" / "npx.cmd"
PYTHON_EMBED_EXE = RUNTIME_DIR / "runtime" / "python" / "python.exe"
UV_EXE = RUNTIME_DIR / "runtime" / "uv" / "uv.exe"

# 资源层路径
PLAYWRIGHT_BROWSERS_PATH = RUNTIME_DIR / "assets" / "playwright"
ONNX_MODEL_PATH = RUNTIME_DIR / "assets" / "models" / "paraphrase-multilingual-MiniLM-L12-v2"


def ensure_data_dirs():
    """确保所有用户数据目录存在（首次运行时自动创建）。

    同时确保 MCP 配置文件存在：首次运行时创建空 YAML（servers: []），
    避免打包模式下 MCP_CONFIG_PATH 指向不存在的文件导致加载失败。
    """
    for d in [API_DATA_DIR, LOGS_DIR, UPLOADS_DIR, CONST_SESSIONS_DIR, PERSONAS_DATA_DIR, SKILLS_DATA_DIR, MACROS_DATA_DIR, VECTOR_DB_DIR, KB_DIR, CREDENTIAL_MIGRATION_BACKUP_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    # 首次运行时创建空的 MCP 配置文件（打包模式下 %APPDATA% 内默认不存在）
    _ensure_mcp_config()


def _ensure_mcp_config() -> None:
    """若 MCP_CONFIG_PATH 不存在，创建一个空的 mcp_servers: [] YAML。

    注意：YAML key 必须是 `mcp_servers`（与 MCPServersConfigFile pydantic 模型
    和 tool_manage_mcp / api/routes/mcp 的读写逻辑一致），不能用 `servers`，
    否则手动编辑的配置会被静默忽略。
    """
    if MCP_CONFIG_PATH.exists():
        return
    try:
        MCP_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MCP_CONFIG_PATH.write_text(
            "# MaxmaHere MCP 服务器配置\n# 在 Web UI 的 MCP 管理页面添加服务器\nmcp_servers: []\n",
            encoding="utf-8",
        )
    except OSError:
        # 权限不足或磁盘满时静默失败，避免阻塞启动
        pass
