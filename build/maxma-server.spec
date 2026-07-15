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
_tools_root = project_root / "tools"  # tools/ 已删除
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
    # Phase B：三层人设模板（persona_loader 读取）
    (str(project_root / "agent" / "persona"), "agent/persona"),
    # 工具文档（TOOL.md）
    *_tool_docs,
    # oh-my-pi sidecar（Bun TypeScript 源码 + node_modules）
    # 生产模式需要 bun.exe + sidecar 源码来启动 agent 引擎
    (str(project_root / "bun-sidecar" / "src"), "bun-sidecar/src"),
    (str(project_root / "bun-sidecar" / "package.json"), "bun-sidecar"),
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
    # "langgraph" — langgraph 已移除，由 oh-my-pi 替代
    "langchain_openai",
    # Stage 1 RAG 子系统：chromadb / transformers / onnxruntime 动态导入
    # 注意：不收集 sentence_transformers / torch（已改用 ONNX Runtime 直推）
    "chromadb",
    "transformers",
    "onnxruntime",
    # MCP 客户端库（tools/mcp.py 动态导入，PyInstaller 静态分析可能遗漏）
    "langchain_mcp_adapters",
    # Tavily 网络搜索 SDK（tools/network/tavily/ 动态导入）
    "tavily",
    # 自动收集 tools 下所有子模块，避免 pkgutil.walk_packages 在 PyInstaller
    # 打包后遗漏动态注册的工具（如 tool_ask_user 曾遗漏导致启动校验失败）
    # "tools" — tools/ 目录已删除，工具已重写为 TS AgentTool
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
    # "langgraph.checkpoint.memory" — langgraph 已移除
    # 阶段 5.1：SQLite 持久化 checkpointer（langgraph.checkpoint.sqlite.aio
    # 已被 collect_submodules("langgraph") 覆盖，但 aiosqlite 是独立包需显式声明）
    # "langgraph.checkpoint.sqlite" — langgraph 已移除
    # "langgraph.checkpoint.sqlite.aio" — langgraph 已移除
    "aiosqlite",
    # "langgraph.stream" — langgraph 已移除
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
    # "tools.system.tool_python", — 已删除
    # "tools.system.tool_project_info", — 已删除
    # "tools.system.tool_context_strategy", — 已删除
    # "tools.system.tool_forget", — 已删除
    # "tools.system.tool_create_persona", — 已删除
    # "tools.todo.tool_add", — 已删除
    # "tools.todo.tool_list", — 已删除
    # "tools.todo.tool_complete", — 已删除
    # "tools.todo.tool_uncomplete", — 已删除
    # "tools.todo.tool_delete", — 已删除
    # "tools.todo.tool_update", — 已删除
    # "tools.todo.tool_query", — 已删除
    # "tools.todo.tool_list_projects", — 已删除
    # "tools.todo.tool_list_sections", — 已删除
    # "tools.todo.tool_list_labels", — 已删除
    # "tools.map.tool_nearby", — 已删除
    # "tools.map.tool_geocode", — 已删除
    # "tools.map.tool_transit", — 已删除
    # "tools.map.tool_cycling", — 已删除
    # "tools.map.tool_fuzzy_addr", — 已删除
    # "tools.network.tool_weather", — 已删除
    # "tools.network.tool_holiday", — 已删除
    # "tools.network.tool_image_understand", — 已删除
    # "tools.network.tavily", — 已删除
    # "tools.network.tavily.tool_search", — 已删除
    # "tools.network.tavily.tool_extract", — 已删除
    # "tools.network.playwright_tools", — 已删除
    # "tools.network.playwright_tools.browser_manager", — 已删除
    # "tools.files.tool_file_read", — 已删除
    # "tools.files.tool_file_write", — 已删除
    # "tools.files.tool_file_manage", — 已删除
    # "tools.files.tool_file_search", — 已删除
    # "tools.files.tool_file_edit", — 已删除
    # "tools.task.tool_tracker", — 已删除
    # "tools.sub_agent.tool_call_sub_agent", — 已删除
    # "tools.sub_agent.tool_parallel", — 已删除
    # "tools.quick_task.tool_quick_task", — 已删除
    # "tools.interaction.tool_ask_qa", — 已删除
    "tools.interaction.tool_ask_user",  # ask_user_for_info 工具（曾遗漏导致打包后启动失败）
    # "tools.interaction.tool_single_choice", — 已删除
    # "tools.interaction.tool_multi_choice", — 已删除
    # "tools.interaction.tool_ask_confirm", — 已删除
    # "tools.entertainment.tool_tarot", — 已删除
    # "tools.memory.tool_list_memories", — 已删除
    # "tools.memory.tool_read_memories", — 已删除
    # "tools.memory.tool_create_memory", — 已删除
    # "tools.memory.tool_update_memory", — 已删除
    # "tools.memory.tool_delete_memory", — 已删除
    # "tools.memory.tool_merge_memories", — 已删除
    # "tools.memory.tool_search_memories", — 已删除
    # Stage 1 子任务 1.2：4 层记忆架构新增工具
    # "tools.memory.tool_search_episodic", — 已删除
    # "tools.memory.tool_search_semantic", — 已删除
    # Stage 1 子任务 1.4：通用知识库工具
    # "tools.kb.tool_kb_search", — 已删除
    # "tools.kb.tool_kb_add", — 已删除
    # 知识库文档加载器依赖（PyInstaller 静态分析可能遗漏函数级 import）
    "PyPDF2",
    "docx",
    "lxml",
    # "tools.config.tool_manage_mcp", — 已删除
    # "tools.config.tool_manage_skills", — 已删除
    # "tools.config.tool_manage_macros", — 已删除
    # "tools.config.tool_manage_providers", — 已删除
    # "tools.config.tool_manage_env_vars", — 已删除
    # "tools.config.tool_manage_whitelist", — 已删除
    # "tools.git.tool_git_status", — 已删除
    # "tools.git.tool_git_diff", — 已删除
    # "tools.git.tool_git_log", — 已删除
    # "tools.git.tool_git_commit", — 已删除
    # "tools.git.tool_git_branch", — 已删除
    # "tools.git.tool_git_push", — 已删除
    # "tools.git.tool_git_pr", — 已删除
    # "tools.crypto", — 已删除

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
    # 错误诊断与导出（server.py 顶层导入 + 全局 exception_handler）
    "api.diagnostics",
    "api.routes.diagnostics",
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
    # Task 4：MCP 测试路由（server.py 顶层注册路由时延迟导入）
    "api.routes.mcp_test",
    # Phase 3：Activity Hub + 会话压缩路由（server.py 延迟导入）
    "api.activity_hub",
    "api.routes.activity",
    "api.routes.session_compress",

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
    "agent.prompts",
    "agent.hooks",
    "agent.audit_log",
    "agent.error_recovery",
    "agent.project_scanner",
    # Phase 3.1：工具熔断器（ErrorRecoveryManager 内延迟导入）
    "agent.circuit_breaker",
    "agent.context_manager",
    # Phase B/C/D/E：openhanako 对齐新增模块
    "agent.persona_loader",
    "agent.runtime_context",
    # 新增：模型路由 + ThinkPath + 权限策略
    "agent.model_routing",
    "agent.think_path",
    "agent.permission_policy",
    "agent.delegation_scope",
    # 自治层（scheduler/runner/diagnostics 在 lifespan 和路由中延迟导入，
    # PyInstaller 静态分析会遗漏；scheduler.py 内部还延迟导入 runner）
    "agent.autonomy",
    "agent.autonomy.scheduler",
    "agent.autonomy.runner",
    "agent.autonomy.diagnostics",
    # Halo 功能性增强：完成信号 + escalation 边界
    "agent.autonomy.completion_signal",
    "agent.autonomy.escalation",

    # ── Halo 架构增强：Disposable 资源管理 ──
    "agent.lifecycle",
    "agent.lifecycle.disposable",

    # ── Halo 功能性增强：工作记忆 Push 注入 ──
    "agent.memory",
    "agent.memory.working_memory",

    # ── oh-my-pi sidecar 桥接层（Phase 1 新增）──
    "api.pi_bridge",
    "api.pi_bridge.sidecar_manager",
    "api.pi_bridge.rpc_client",
    "api.pi_bridge.session_adapter",
    "api.pi_bridge.security_adapter",
    "api.pi_bridge.approval_adapter",
    "api.pi_bridge.ws_event_mapper",

    # ── maxma_platform（从 platform 重命名，避免标准库遮蔽） ──
    "maxma_platform",
    "maxma_platform.event_dedup",
    "maxma_platform.keep_alive",

    # ── Halo 架构增强：启动分层 + 凭据掩码 + JSONL Transcript ──
    "api.bootstrap",
    "api.bootstrap.idle_queue",
    "api.security",
    "api.security.credential_mask",
    "api.transcript",
    "api.transcript.jsonl_writer",
    "api.routes.transcripts",

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
    # Phase C：openhanako 对齐新增记忆模块
    "memory.fact_store",
    "memory.deep_memory",
    "memory.rolling_summary",
    "memory.memory_scheduler",
    "memory.pinned_store",
    "memory.pii_guard",
    # 长期记忆事务 outbox
    "memory.ltm_outbox",

    # ── 路径安全 ──
    # "tools.path_security", — 已删除

    # ── Halo 功能性增强：report_to_user 工具 + 诊断基类 ──
    # "tools.system.tool_report_to_user", — 已删除
    # "tools.system.tool_rag_diagnose", — 已删除
    # "tools.system.tool_system_diagnose", — 已删除
    # "tools.system.sandbox_runner", — 已删除
    # "tools.base_diagnose", — 已删除
    # ── 委派上下文（子 Agent 权限继承） ──
    # "tools.sub_agent.delegation_context", — 已删除

    # ── MCP 模块（Stage 4：MCP 工具管理 + 安全 + 限流） ──
    # tools.mcp 被 api.routes.mcp 顶层导入，但 init_mcp_tools() 内有大量延迟导入
    # "tools.mcp", — 已删除
    # tools.mcp_security 被 tools.mcp 顶层导入（validate_stdio_command 等）
    # "tools.mcp_security", — 已删除
    # 阶段 4.4：MCP 限流器（tools.mcp._wrap_tool_with_safety 内延迟导入）
    # "tools.mcp_rate_limiter", — 已删除
    # Task 2：MCP 运行时管理器（tools.mcp._init_mcp_tools 内延迟导入）
    # "tools.mcp_runtime", — 已删除

    # ── 第三方库 ──
    "portalocker",
    "dotenv",
    "cryptography",
    "cryptography.fernet",
    "zai",
    # json_repair（流式修复管道修复破损 tool JSON）
    "json_repair",

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
    # chromadb 的云端依赖，桌面端不需要
    "kubernetes",
    # 注意：opentelemetry 不能排除 — chromadb 1.5.x 在运行时 import chromadb
    # 会触发 opentelemetry.instrumentation 的导入，排除后导致 ImportError，
    # 使 vector_store.get_vector_store() 返回 None，知识库功能完全不可用。
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
