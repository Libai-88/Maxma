# -*- mode: python ; coding: utf-8 -*-
"""
MaxmaHere PyInstaller spec — 将后端打包为独立可执行文件。

构建命令（在项目根目录执行）：
    .venv\\Scripts\\pyinstaller.exe build\\maxma-server.spec --clean --noconfirm

产物位于：
    dist/maxma-server.exe
"""

import os
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None
project_root = Path(SPECPATH).parent  # SPECPATH = build/ 目录的父目录

# ── 数据文件：打包进 _MEIPASS 临时目录的资源 ──

# 收集所有工具目录下的 TOOL.md 文档
_tool_docs = []
_tools_root = project_root / "tools"
if _tools_root.exists():
    for md in _tools_root.rglob("TOOL.md"):
        _tool_docs.append((str(md), str(md.relative_to(project_root).parent)))

datas = [
    # 前端构建产物
    (str(project_root / "web" / "dist"), "web/dist"),
    # 配置文件（personas 目录包含 SOUL.md、USER.md 模板等）
    (str(project_root / "config"), "config"),
    # Anthropic Skills
    (str(project_root / "anthropic_skills"), "anthropic_skills"),
    # Macros
    (str(project_root / "macros"), "macros"),
    # 工具文档（TOOL.md）
    *_tool_docs,
]

# 过滤掉不存在的目录
datas = [(src, dst) for src, dst in datas if Path(src).exists()]

site_packages_root = project_root / ".venv" / "Lib" / "site-packages"


def collect_local_extension_modules():
    binaries = []
    hidden = []
    for package_root in site_packages_root.iterdir():
        if not package_root.is_dir():
            continue
        package_name = package_root.name
        for pyd in package_root.glob("*.pyd"):
            binaries.append((str(pyd), package_name))
            module_name = pyd.name.split(".", 1)[0]
            hidden.append(f"{package_name}.{module_name}")
    return binaries, hidden


local_extension_binaries, local_extension_hiddenimports = collect_local_extension_modules()


def safe_collect_submodules(package_name):
    """Collect submodules for packages that rely on dynamic imports."""
    try:
        return collect_submodules(package_name)
    except Exception:
        return []


framework_hiddenimports = []
for package_name in (
    "langgraph",
    "langchain_openai",
):
    framework_hiddenimports.extend(safe_collect_submodules(package_name))

# ── 隐式导入：PyInstaller 无法自动检测的动态导入 ──

hiddenimports = [
    # uvicorn 内部模块
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",

    # LangChain / LangGraph
    "langchain_openai",
    "langchain_openai.chat_models",
    "langchain_core.messages",
    "langchain_core.runnables",
    "langgraph.checkpoint.memory",
    "langgraph.stream",
    "openai",

    # 第三方库
    "pydantic_settings",
    "requests",
    "yaml",
    "yaml._yaml",
    "tiktoken",
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    "httpx",
    "httpx._transports.default",
    "anyio",
    "anyio._backends",
    "anyio._backends._asyncio",
    "sniffio",
    "certifi",
    "charset_normalizer",
    "idna",

    # ── 工具模块（tools/__init__.py 中延迟导入） ──
    "tools.system.tool_python",
    "tools.system.tool_project_info",
    "tools.system.tool_context_strategy",
    "tools.system.tool_forget",
    "tools.system.tool_create_persona",
    "tools.todo.tool_add",
    "tools.todo.tool_list",
    "tools.todo.tool_complete",
    "tools.todo.tool_uncomplete",
    "tools.todo.tool_delete",
    "tools.todo.tool_update",
    "tools.todo.tool_query",
    "tools.todo.tool_list_projects",
    "tools.todo.tool_list_sections",
    "tools.todo.tool_list_labels",
    "tools.map.tool_nearby",
    "tools.map.tool_geocode",
    "tools.map.tool_transit",
    "tools.map.tool_cycling",
    "tools.map.tool_fuzzy_addr",
    "tools.network.tool_weather",
    "tools.network.tool_holiday",
    "tools.network.tool_image_understand",
    "tools.network.tavily",
    "tools.network.tavily.tool_search",
    "tools.network.tavily.tool_extract",
    "tools.network.playwright_tools",
    "tools.network.playwright_tools.browser_manager",
    "tools.files.tool_file_read",
    "tools.files.tool_file_write",
    "tools.files.tool_file_manage",
    "tools.files.tool_file_search",
    "tools.files.tool_file_edit",
    "tools.task.tool_tracker",
    "tools.sub_agent.tool_call_sub_agent",
    "tools.sub_agent.tool_parallel",
    "tools.quick_task.tool_quick_task",
    "tools.interaction.tool_ask_qa",
    "tools.interaction.tool_single_choice",
    "tools.interaction.tool_multi_choice",
    "tools.interaction.tool_ask_confirm",
    "tools.entertainment.tool_tarot",
    "tools.memory.tool_list_memories",
    "tools.memory.tool_read_memories",
    "tools.memory.tool_create_memory",
    "tools.memory.tool_update_memory",
    "tools.memory.tool_delete_memory",
    "tools.memory.tool_merge_memories",
    "tools.memory.tool_search_memories",
    "tools.config.tool_manage_mcp",
    "tools.config.tool_manage_skills",
    "tools.config.tool_manage_macros",
    "tools.config.tool_manage_providers",
    "tools.config.tool_manage_env_vars",
    "tools.config.tool_manage_whitelist",
    "tools.git.tool_git_status",
    "tools.git.tool_git_diff",
    "tools.git.tool_git_log",
    "tools.git.tool_git_commit",
    "tools.git.tool_git_branch",
    "tools.git.tool_git_push",
    "tools.git.tool_git_pr",
    "tools.crypto",

    # ── API 模块（函数内延迟导入） ──
    "api.context_usage",
    "api.dependencies",
    "api.time_traveler",
    "api.const_session_store",
    "api.interaction",
    "api.providers.openai_provider",
    "api.routes.event_hooks",
    "api.routes.audit_log",

    # ── Agent 模块 ──
    "agent.graph",
    "agent.prompts",
    "agent.planner",
    "agent.hooks",
    "agent.audit_log",
    "agent.error_recovery",
    "agent.performance",
    "agent.project_scanner",

    # ── Memory 模块 ──
    "memory.memory_manager",
    "memory.narrative",
    "memory.memory_callback",
    "memory.user_init",

    # ── 路径安全 ──
    "tools.path_security",

    # ── 第三方库 ──
    "portalocker",
    "dotenv",
    "cryptography",
    "cryptography.fernet",
    "zai",

    # ── 版本 ──
    "version",
    "app_paths",
]

hiddenimports.extend(framework_hiddenimports)
hiddenimports.extend(local_extension_hiddenimports)
hiddenimports = list(dict.fromkeys(hiddenimports))

# ── 排除模块：减小打包体积 ──

excludes = [
    "tkinter",          # 文件选择器在桌面模式下由 Tauri 处理
    "matplotlib",
    "scipy",
    "numpy.distutils",
    "setuptools",
    "unittest",
    "test",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
]

a = Analysis(
    [str(project_root / "main.py")],
    pathex=[str(project_root)],
    binaries=local_extension_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="maxma-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # 保留控制台窗口以便查看日志
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon=None,  # 可后续添加 .ico 图标
)
