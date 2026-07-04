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
    # Stage 1 RAG 子系统：chromadb / transformers / onnxruntime 动态导入
    # 注意：不收集 sentence_transformers / torch（已改用 ONNX Runtime 直推）
    "chromadb",
    "transformers",
    "onnxruntime",
    # 自动收集 tools 下所有子模块，避免 pkgutil.walk_packages 在 PyInstaller
    # 打包后遗漏动态注册的工具（如 tool_ask_user 曾遗漏导致启动校验失败）
    "tools",
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
    # 阶段 5.1：SQLite 持久化 checkpointer（langgraph.checkpoint.sqlite.aio
    # 已被 collect_submodules("langgraph") 覆盖，但 aiosqlite 是独立包需显式声明）
    "langgraph.checkpoint.sqlite",
    "langgraph.checkpoint.sqlite.aio",
    "aiosqlite",
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
    "tools.interaction.tool_ask_user",  # ask_user_for_info 工具（曾遗漏导致打包后启动失败）
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
    # Stage 1 子任务 1.2：4 层记忆架构新增工具
    "tools.memory.tool_search_episodic",
    "tools.memory.tool_search_semantic",
    # Stage 1 子任务 1.4：通用知识库工具
    "tools.kb.tool_kb_search",
    "tools.kb.tool_kb_add",
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
    # 阶段 5.1：持久化 checkpointer 工厂（lifespan + SessionState.__post_init__ 延迟导入）
    "api.checkpointer_factory",
    "api.providers.openai_provider",
    "api.routes.event_hooks",
    "api.routes.audit_log",
    # Phase 3.2：HTTP/WS 限流中间件（server.py 顶层导入 + 函数内导入）
    "api.middleware",
    "api.middleware.auth",
    "api.middleware.rate_limit",
    "api.middleware.request_log",
    # Phase 3.3：Provider fallback 链路（manager 在 server.py 顶层导入；
    # health_monitor 在 lifespan 内函数导入，PyInstaller 静态分析会遗漏）
    "api.providers.manager",
    "api.providers.health_monitor",
    "api.providers.store",
    # Stage 1 子任务 1.4/1.5：知识库 + 指标路由（函数内延迟导入）
    "api.routes.kb",
    "api.routes.metrics",

    # ── SQLite 数据层（Phase 1 新增，动态导入） ──
    "api.db.core",
    "api.db.providers",
    "api.db.auth",
    "api.db.hooks",
    # Stage 1 子任务 1.6：metrics SQLite 持久化
    "api.db.metrics",

    # ── langchain_core.messages 子类（动态 import，PyInstaller 可能遗漏） ──
    "langchain_core.messages.RemoveMessage",

    # ── Agent 模块 ──
    "agent.graph",
    "agent.prompts",
    "agent.planner",
    "agent.hooks",
    "agent.audit_log",
    "agent.error_recovery",
    "agent.performance",
    "agent.project_scanner",
    # Phase 3.1：工具熔断器（ErrorRecoveryManager 内延迟导入）
    "agent.circuit_breaker",
    # Stage 2 子任务 2.1：Plan-and-Execute 重构新增模块
    # executor.py 含 executor_node/StepStateMachine/detect_tool_failure（大量延迟导入）
    # step_state.py 含 PlanStep/StepStatus/ExecutionPlan/merge_dicts reducer（LangGraph 动态特性）
    "agent.executor",
    "agent.step_state",
    # 阶段 5.2：死循环检测器（graph.should_continue + loop_breaker_node 延迟导入）
    "agent.loop_detector",

    # ── Memory 模块 ──
    "memory.memory_manager",
    "memory.narrative",
    "memory.memory_callback",
    "memory.user_init",
    # Stage 1 子任务 1.2：4 层记忆架构
    "memory.episodic",
    "memory.semantic",
    "memory.coordinator",
    # Stage 1 子任务 1.3：TTL 遗忘机制
    "memory.ttl",
    # Stage 1 子任务 1.1：RAG 子系统
    "memory.rag",
    "memory.rag.embedding",
    "memory.rag.vector_store",
    "memory.rag.indexer",
    # Stage 1 子任务 1.4：通用知识库
    "memory.kb",
    "memory.kb.document_loader",
    "memory.kb.chunker",
    "memory.kb.indexer",
    "memory.kb.retriever",

    # ── 路径安全 ──
    "tools.path_security",

    # ── MCP 模块（Stage 4：MCP 工具管理 + 安全 + 限流） ──
    # tools.mcp 被 api.routes.mcp 顶层导入，但 init_mcp_tools() 内有大量延迟导入
    "tools.mcp",
    # tools.mcp_security 被 tools.mcp 顶层导入（validate_stdio_command 等）
    "tools.mcp_security",
    # 阶段 4.4：MCP 限流器（tools.mcp._wrap_tool_with_safety 内延迟导入）
    "tools.mcp_rate_limiter",

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
    "numpy.distutils",
    "setuptools",
    "unittest",
    "test",
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    # Stage 1 RAG 体积优化：已改用 ONNX Runtime 直推，排除 torch 全家桶（省 ~600MB）
    "torch",
    "torchvision",
    "torchaudio",
    "sentence_transformers",
    "scipy",
    "sklearn",
    "scikit_learn",
    "sympy",
    "networkx",
    # chromadb 的云端/可观测性依赖，桌面端不需要
    "kubernetes",
    "opentelemetry",
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
