"""FastAPI 应用工厂 — 生命周期管理、CORS、路由挂载。"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import HumanMessage, SystemMessage

import time

from agent.hooks import HookUnsupportedError
from api.auth import load_or_create_token
from api.const_session_store import (
    load_all_const_sessions,
)
from api.dependencies import get_llm, get_system_prompt, get_tools
from api.health import get_health_report
from api.cors_config import build_cors_origins
from api.logging_config import setup_logging
from api.providers.manager import ProviderManager
from api.providers.store import ProviderConfigStore
from app_paths import AUTONOMY_SCHEDULES_PATH, PROVIDERS_YAML_PATH, WORKFLOW_JOURNAL_PATH
from api.routes import chat, files, memory, sessions, balance, providers
from api.routes import deferred_runs as deferred_runs_router
from api.routes import workflows as workflows_router
from api.routes import autonomy as autonomy_router
from api.routes import path_whitelist as path_whitelist_router
from api.routes import persona as persona_router
from api.routes import maxma_blocker as maxma_blocker_router
from api.routes import skills as skills_router
from api.routes import news as news_router
from api.routes import mcp as mcp_router
from api.routes import mcp_test as mcp_test_router
from api.routes import restart as restart_router
from api.routes import env_vars as env_vars_router
from api.routes import tool_stats as tool_stats_router
from api.routes import upload as upload_router
from api.routes import metrics as metrics_router
from api.routes import event_hooks as event_hooks_router
from api.routes import audit_log as audit_log_router
from api.routes import diagnostics as diagnostics_router
from api.session_manager import SessionManager, SessionState
from api.ws_registry import WebSocketRegistry
from config.settings import get_settings
from memory.episodic import EpisodicMemoryManager
from memory.memory_manager import MemoryManager
from memory.narrative import MEMORY_PATH, LongTermMemoryInterface
from memory.semantic import SemanticMemoryManager
from memory.coordinator import MemoryCoordinator
from tools import merge_tool_lists
from tools.mcp import init_mcp_tools, close_mcp, set_reload_callback
from version import __version__

from api.middleware.auth import AuthMiddleware
from api.middleware.rate_limit import RateLimitMiddleware
from api.middleware.request_log import RequestLogMiddleware

logger = logging.getLogger(__name__)


def _migrate_provider_from_env(store) -> object | None:
    """从 .env 读取 DeepSeek 配置写入 SQLite（向后兼容）。"""
    import os
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return None
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    model_name = os.getenv("MODEL_NAME", "deepseek-v4-flash")
    context_window_str = os.getenv("MODEL_CONTEXT_WINDOW", "256000")
    from api.providers import ProviderConfig
    config = ProviderConfig(
        id="deepseek-main",
        provider_type="openai",
        label="DeepSeek",
        api_key=api_key,
        base_url=base_url,
        models=[model_name],
        enabled=True,
        context_window=int(context_window_str),
    )
    store.save(config)
    return config


def _hook_tools_for_action(app_state, action: str, trigger_detail: str) -> list:
    """Select tools for a headless event-hook run.

    Event hooks execute without a live chat WebSocket, so tools that require
    immediate user interaction are intentionally excluded.
    """
    from tools import select_tools_for_query

    mcp_tools = getattr(app_state, "mcp_tools", None) or []
    selected = select_tools_for_query(
        f"{action}\n\n触发详情：{trigger_detail}",
        mcp_tools=list(mcp_tools),
    )
    return [
        tool
        for tool in selected
        if not str(getattr(tool, "name", "")).startswith("ask_user_")
    ]


def _extract_hook_final_answer(output) -> str:
    messages = output.get("messages", []) if isinstance(output, dict) else []
    if not messages:
        return ""
    last = messages[-1]
    content = last.content if hasattr(last, "content") else str(last)
    return str(content or "")


async def _run_event_hook_action(app: FastAPI, hook, trigger_detail: str) -> str:
    """Run one event-hook action through the normal LangGraph Agent entrypoint."""
    app_state = app.state
    llm = getattr(app_state, "llm", None)
    if llm is None:
        raise HookUnsupportedError("事件钩子执行不可用：未配置 LLM Provider")

    session_manager = getattr(app_state, "session_manager", None)
    if session_manager is None:
        raise HookUnsupportedError("事件钩子执行不可用：会话管理器未初始化")

    session = await session_manager.create()
    try:
        system_prompt = getattr(app_state, "system_prompt", "") or get_system_prompt()
        system_prompt = (
            system_prompt
            + "\n\n[事件钩子执行模式]\n"
            + "当前任务由后台事件钩子自动触发，没有可交互的聊天 WebSocket。"
            + "不要请求用户确认或等待用户输入；"
            + "如果动作需要人工确认，请说明无法在后台执行。"
        )
        tools = _hook_tools_for_action(app_state, hook.action, trigger_detail)
        # 4 层架构：注入情景记忆管理器（事件钩子场景也启用 episodic 检索）
        episodic_mm = getattr(app_state, "episodic_mm", None)
        prompt = (
            "[事件钩子触发]\n"
            f"钩子名称：{hook.name}\n"
            f"钩子类型：{hook.hook_type}\n"
            f"触发详情：{trigger_detail}\n\n"
            "[预设动作]\n"
            f"{hook.action}"
        )
        timeout = float(hook.config.get("timeout", 600))
        response = await asyncio.wait_for(
            llm.ainvoke([
                SystemMessage(content=system_prompt),
                HumanMessage(content=prompt),
            ]),
            timeout=timeout,
        )
        final_answer = response.content if hasattr(response, "content") else str(response)
        return (
            final_answer
            or "事件钩子动作已执行，但没有生成文本结果"
        )
    finally:
        delete_session = getattr(session_manager, "delete", None)
        if callable(delete_session):
            await delete_session(session.session_id)


def _build_event_hook_callback(app: FastAPI):
    async def _callback(hook, trigger_detail: str) -> str:
        return await _run_event_hook_action(app, hook, trigger_detail)

    return _callback


async def _load_const_sessions(app: FastAPI):
    """从 YAML 重建所有 const 固定会话的元数据到内存 SessionManager。

    sidecar 模式下，const session 的消息由 oh-my-pi 管理（通过 JSONL 持久化）。
    此函数只恢复元数据（is_const, const_name, message_count），不重建消息历史。
    消息在用户首次访问时通过 sidecar RPC 按需加载。
    """
    sm = app.state.session_manager
    const_list = load_all_const_sessions()
    if not const_list:
        return

    # 尝试获取 checkpointer（可选，sidecar 模式下不需要）
    shared_checkpointer = None
    try:
        from api.checkpointer_factory import get_persistent_checkpointer
        shared_checkpointer = get_persistent_checkpointer()
    except Exception:
        logger.debug("[const] No checkpointer available — sidecar-only mode for const sessions")

    loaded = 0
    for const_data in const_list:
        sid = const_data.get("session_id")
        if not sid or sid in sm._sessions:
            continue

        metadata = const_data.get("metadata", {})
        const_name = const_data.get("const_name", "")

        # sidecar 模式：只恢复元数据，消息由 sidecar 按需管理
        session = SessionState(
            session_id=sid,
            created_at=metadata.get("created_at", time.time()),
            last_active=metadata.get("last_active", time.time()),
            message_count=metadata.get("message_count", 0),
            permission_mode=metadata.get("permission_mode", "ask"),
            permission_mode_updated_at=metadata.get("permission_mode_updated_at", time.time()),
            checkpointer=shared_checkpointer,  # 可能为 None
            is_const=True,
            const_name=const_name,
        )
        sm._sessions[sid] = session
        loaded += 1
        logger.info("[const] Loaded const session %s (name=%s, msg_count=%d)",
                    sid[:8], const_name, metadata.get("message_count", 0))

    logger.info("[const] 已加载 %d/%d 个固定会话", loaded, len(const_list))


@asynccontextmanager
async def lifespan(app: FastAPI):
    from agent.lifecycle.disposable import DisposableStore, to_disposable

    # Disposable 资源集合 — 统一管理生命周期
    _disposables = DisposableStore()
    app.state._disposables = _disposables

    # 1. 初始化 Provider 管理器（SQLite 存储，兼容旧 YAML 导入）
    from api.db.core import initialize_database
    from api.db.providers import ProviderDbStore

    initialize_database()  # 确保 DB schema 已创建

    provider_store = ProviderDbStore()
    # 首次迁移：从旧 YAML 导入已有配置
    migrated_count = provider_store.migrate_from_yaml()
    if migrated_count:
        logger.info("[provider] migrated %d provider(s) from YAML", migrated_count)
    # 迁移 .env 中的 DeepSeek 配置（纯新安装场景）
    if provider_store.is_empty:
        migrated = _migrate_provider_from_env(provider_store)
        if migrated:
            logger.info("[provider] migrated %s from .env", migrated.label)

    provider_manager = ProviderManager(provider_store)
    provider_manager.load_all()
    app.state.provider_manager = provider_manager
    logger.info("[provider] loaded %d provider(s)", provider_manager.count)

    # 阶段 3.3：启动 provider 健康监控后台任务
    # - 健康 provider 每 check_interval 秒检查一次
    # - unhealthy provider 每 recovery_interval 秒重新探测
    # - 连续失败达 unhealthy_threshold 才标记 error（避免单次抖动）
    from api.providers.health_monitor import start_health_monitor
    from config.settings import get_settings as _get_settings_for_health
    _health_settings = _get_settings_for_health()
    start_health_monitor(
        provider_manager,
        check_interval=_health_settings.provider_health_check_interval_seconds,
        recovery_interval=_health_settings.provider_recovery_check_interval_seconds,
        unhealthy_threshold=_health_settings.provider_unhealthy_threshold,
    )
    logger.info(
        "[health_monitor] 已启动（check=%ds, recovery=%ds, threshold=%d）",
        _health_settings.provider_health_check_interval_seconds,
        _health_settings.provider_recovery_check_interval_seconds,
        _health_settings.provider_unhealthy_threshold,
    )

    # 2. 其他共享资源（不阻塞启动 — LLM 在后台初始化）
    app.state.system_prompt = get_system_prompt()
    app.state.native_tools = get_tools()
    app.state.session_manager = SessionManager()
    # The workflow API is always registered but runtime construction remains
    # opt-in. A disabled flag therefore has no journal or execution side effect.
    workflow_settings = get_settings()
    if (
        workflow_settings.workflow_enabled
        and workflow_settings.async_subagent_enabled
        and workflow_settings.permission_modes_enabled
    ):
        from tools.workflow.journal import WorkflowJournalStore
        from tools.workflow.registry import DEFAULT_WORKFLOW_REGISTRY
        from tools.workflow.run_manager import WorkflowRunManager

        app.state.workflow_run_manager = WorkflowRunManager(
            WorkflowJournalStore(WORKFLOW_JOURNAL_PATH), DEFAULT_WORKFLOW_REGISTRY
        )
        app.state.session_manager.set_workflow_run_manager(app.state.workflow_run_manager)
        app.state.workflow_run_manager.recover()
    app.state.ws_registry = WebSocketRegistry()
    app.state.ltm = LongTermMemoryInterface(
        MEMORY_PATH,
        retry_policy_enabled=get_settings().ltm_retry_policy_enabled,
    )

    # 阶段 5.1：初始化持久化 checkpointer（sidecar 模式下可选）
    # - 启用 SQLite 持久化：进程重启后可恢复会话状态
    # - langgraph 未安装时跳过，sidecar 模式下不需要 checkpointer
    try:
        from api.checkpointer_factory import init_persistent_checkpointer
        await init_persistent_checkpointer()
        from api.checkpointer_factory import get_checkpointer_info
        logger.info("[checkpointer] %s", get_checkpointer_info())
    except ImportError:
        logger.info("[checkpointer] langgraph not available — using sidecar-only mode")
    except Exception:
        logger.warning("[checkpointer] init failed — using sidecar-only mode", exc_info=True)

    # 后台初始化 LLM（不阻塞 lifespan，让 API 立即就绪）
    async def _init_llm_background():
        try:
            llm = get_llm(provider_manager)
            app.state.llm = llm
            logger.info("[llm] LLM 后台初始化完成")
            # LLM 就绪后启动长期记忆
            app.state.ltm.start_listening(
                llm, ws_registry=app.state.ws_registry,
            )
            logger.info("[ltm] 长期记忆监听器已启动")
        except RuntimeError as e:
            logger.warning("[llm] %s", e)
            logger.warning("[llm] No LLM configured — chat will be read-only until a provider is added")
            app.state.llm = None
    app.state._llm_init_task = asyncio.create_task(_init_llm_background())
    _disposables.add(to_disposable(lambda: app.state._llm_init_task.cancel() if not app.state._llm_init_task.done() else None))

    # 从 YAML 配置加载 MCP 工具
    app.state.mcp_tools = await init_mcp_tools()
    app.state.tools = merge_tool_lists(app.state.native_tools, app.state.mcp_tools)

    # 注入 MCP 重载回调：工具修改 YAML 后通过此回调触发异步重载
    _loop = asyncio.get_running_loop()  # 在 lifespan 协程中安全获取

    def _mcp_reload_callback():
        _loop.call_soon_threadsafe(lambda: _loop.create_task(_do_reload_from_tool()))

    async def _do_reload_from_tool():
        try:
            from tools.mcp import reload_mcp
            new_tools = await reload_mcp()
            app.state.mcp_tools = new_tools
            app.state.tools = merge_tool_lists(app.state.native_tools, new_tools)
            logger.info("[mcp] 工具触发热重载成功，共 %d 个 MCP 工具", len(new_tools))
        except Exception as exc:
            logger.error("[mcp] 工具触发热重载失败: %s", exc)

    set_reload_callback(_mcp_reload_callback)

    # 加载 const 固定会话（需要 tools 已就绪）
    await _load_const_sessions(app)

    # 4. 启动定时 session 清理任务（每 5 分钟清理超过 TTL 的不活跃会话）
    async def _periodic_cleanup():
        while True:
            await asyncio.sleep(300)  # 5 分钟
            sm = app.state.session_manager
            removed = await sm.cleanup_expired()
            if removed:
                logger.info(
                    "[session] cleanup: removed %d expired session(s), %d remaining",
                    removed, len(sm._sessions),
                )

    app.state._cleanup_task = asyncio.create_task(_periodic_cleanup())
    _disposables.add(to_disposable(lambda: app.state._cleanup_task.cancel() if not app.state._cleanup_task.done() else None))

    # 4.5 启动指标持久化 flush 任务（定期将内存快照写入 SQLite）
    from api.metrics import get_metrics
    get_metrics().start_flush_task()

    # 4.6 启动 TTL 遗忘机制后台清理任务（定期清理 memory.yaml 中已过期条目）
    from memory.ttl import schedule_purge as schedule_ttl_purge
    from app_paths import EPISODIC_MEMORY_PATH, SEMANTIC_MEMORY_PATH
    _settings = get_settings()
    # 初始化 4 层记忆：长期/情景/语义管理器 + 协调器
    _long_term_mm = MemoryManager(yaml_file=str(MEMORY_PATH))
    _episodic_mm = EpisodicMemoryManager(
        json_file=str(EPISODIC_MEMORY_PATH),
        default_ttl=_settings.default_episodic_ttl,
    )
    _semantic_mm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
    app.state.episodic_mm = _episodic_mm
    app.state.semantic_mm = _semantic_mm
    _fact_store = None
    _fact_retriever = None
    if _settings.fact_store_retrieval_enabled:
        from app_paths import FACT_STORE_PATH
        from memory.fact_retrieval import SupplementaryFactRetriever
        from memory.fact_store import FactStore

        _fact_store = FactStore(db_path=str(FACT_STORE_PATH))
        _fact_retriever = SupplementaryFactRetriever(_fact_store, enabled=True)
        app.state.fact_store = _fact_store
        logger.info("[memory] FactStore supplementary retrieval enabled")
    app.state.memory_coordinator = MemoryCoordinator(
        long_term_mm=_long_term_mm,
        episodic_mm=_episodic_mm,
        semantic_mm=_semantic_mm,
        fact_retriever=_fact_retriever,
    )
    logger.info(
        "[memory] memory layers initialized: long_term + episodic + semantic%s",
        " + facts" if _fact_retriever is not None else "",
    )
    ttl_managers = [_long_term_mm, _episodic_mm, _semantic_mm]
    if _fact_retriever is not None:
        # FactStore exposes the same purge contract; keeping it in the common
        # scheduler means expired FTS rows cannot accumulate after rollout.
        ttl_managers.append(_fact_retriever)
    schedule_ttl_purge(
        _settings.ttl_purge_interval_seconds,
        ttl_managers,
    )
    logger.info(
        "[ttl] 后台清理任务已启动，间隔 %d 秒", _settings.ttl_purge_interval_seconds,
    )

    # 5. 初始化认证 Token（SQLite 存储）
    from api.db.auth import load_or_create_token as load_token_db
    app.state.auth_token = load_token_db()
    logger.info("[auth] token: %s...%s", app.state.auth_token[:4], app.state.auth_token[-4:])

    # 6. 初始化事件钩子管理器
    from agent.hooks import get_hook_manager
    hook_manager = get_hook_manager()
    hook_manager.set_loop(asyncio.get_running_loop())
    hook_manager.set_trigger_callback(_build_event_hook_callback(app))
    hook_manager.load()
    hook_manager.start_all()
    app.state.hook_manager = hook_manager
    logger.info("[hooks] 事件钩子管理器已启动，%d 个钩子", len(hook_manager.list_hooks()))

    # 6.5 初始化 oh-my-pi sidecar 管理器（懒启动，首次调用时自动拉起 Bun 进程）
    from api.pi_bridge.sidecar_manager import SidecarManager
    app.state.sidecar_manager = SidecarManager()
    logger.info("[sidecar] SidecarManager 已创建")

    # 7. 启动自治调度器（默认关闭，需在 .env 中设置 autonomy_enabled=true）
    from config.settings import get_settings as _get_autonomy_settings
    _autonomy_settings = _get_autonomy_settings()
    if _autonomy_settings.autonomy_enabled:
        # User-created Scout schedules are a separate, deliberately
        # read-only capability.  Their durable store uses the regular audit
        # writer and the runner refuses to replay in-flight work after restart.
        from agent.audit_log import log_event
        from agent.autonomy.governance import AutonomyScheduleStore
        from agent.autonomy.scout import ScoutScheduleRunner, run_scout_lease

        app.state.autonomy_schedule_store = AutonomyScheduleStore(
            AUTONOMY_SCHEDULES_PATH, audit=log_event
        )
        app.state.autonomy_scout_runner = ScoutScheduleRunner(
            app.state.autonomy_schedule_store,
            lambda lease: run_scout_lease(app, lease),
        )
        app.state.autonomy_scout_runner.start()
        from agent.autonomy.scheduler import start_autonomy
        start_autonomy(
            app,
            interval_seconds=_autonomy_settings.autonomy_interval_seconds,
            self_improve_enabled=_autonomy_settings.autonomy_self_improve_enabled,
        )
        logger.info("[autonomy] 自治调度器已启动")
    else:
        logger.info("[autonomy] 自治调度器未启用（autonomy_enabled=False）")

    # === 注册 Idle Queue 任务（Tier 3，不阻塞启动）===
    from api.bootstrap.idle_queue import register_idle_task

    # const 会话重试加载（如果 LLM 初始化时未就绪）
    async def _retry_const_sessions():
        await asyncio.sleep(5)  # 等 LLM 初始化
        if getattr(app.state, "llm", None) is not None:
            await _load_const_sessions(app)

    register_idle_task("retry-const-sessions", _retry_const_sessions)

    # === 启动 Idle Queue drain（非阻塞）===
    from api.bootstrap.idle_queue import start_idle_drain
    asyncio.create_task(start_idle_drain())

    yield

    # 优先通过 DisposableStore 释放（逆序）
    _disposables = getattr(app.state, "_disposables", None)
    if _disposables:
        _disposables.dispose()

    # 关闭：后台 LLM 初始化任务
    llm_task = getattr(app.state, "_llm_init_task", None)
    if llm_task and not llm_task.done():
        llm_task.cancel()
        try:
            await llm_task
        except asyncio.CancelledError:
            pass

    # 阶段 3.3：停止 provider 健康监控后台任务
    from api.providers.health_monitor import stop_health_monitor
    await stop_health_monitor()

    app.state._cleanup_task.cancel()
    try:
        await app.state._cleanup_task
    except asyncio.CancelledError:
        pass

    # 停止指标 flush 任务（执行最终 flush）
    from api.metrics import get_metrics
    await get_metrics().stop_flush_task()

    # 停止 TTL 遗忘机制后台清理任务
    from memory.ttl import stop_purge as stop_ttl_purge
    await stop_ttl_purge()

    # 关闭事件钩子
    hook_manager.stop_all()
    logger.info("[hooks] 事件钩子管理器已停止")

    # 停止自治调度器
    from agent.autonomy.scheduler import stop_autonomy
    await stop_autonomy()
    scout_runner = getattr(app.state, "autonomy_scout_runner", None)
    if scout_runner is not None:
        await scout_runner.shutdown()

    await close_mcp()

    # 停止 WS rate limiter 清理后台任务
    try:
        from api.middleware.rate_limit import get_ws_rate_limiter
        await get_ws_rate_limiter()._registry.stop_cleanup_task()
    except Exception:
        logger.warning("[rate_limit] stop cleanup failed", exc_info=True)

    workflow_manager = getattr(app.state, "workflow_run_manager", None)
    if workflow_manager is not None:
        await workflow_manager.shutdown()
    await balance.close_async_client()
    await app.state.ltm.stop_listening()

    # 停止 oh-my-pi sidecar（如果已启动）
    sidecar_mgr = getattr(app.state, "sidecar_manager", None)
    if sidecar_mgr:
        await sidecar_mgr.stop()
        logger.info("[sidecar] SidecarManager 已停止")

    fact_store = getattr(app.state, "fact_store", None)
    if fact_store is not None:
        fact_store.close()

    # 关闭 Playwright 浏览器（如果已启动）
    try:
        from tools.network.playwright_tools.browser_manager import BrowserManager
        BrowserManager().shutdown()
    except Exception:
        logger.warning("[playwright] browser shutdown failed", exc_info=True)

    # 阶段 5.1：关闭持久化 checkpointer（释放 SQLite 连接）
    from api.checkpointer_factory import close_persistent_checkpointer
    await close_persistent_checkpointer()


def create_app() -> FastAPI:
    app = FastAPI(
        title="MaxmaHere API",
        version=__version__,
        lifespan=lifespan,
    )

    cors_origins = build_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # REST 路由
    app.include_router(sessions.router, prefix="/api")
    app.include_router(deferred_runs_router.router, prefix="/api")
    app.include_router(workflows_router.router, prefix="/api")
    app.include_router(autonomy_router.router, prefix="/api")
    app.include_router(memory.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(balance.router, prefix="/api")

    # WebSocket 路由（无 /api 前缀）
    app.include_router(chat.router)

    # Provider CRUD 路由
    app.include_router(providers.router, prefix="/api")

    # MCP 服务器配置查看与热加载
    app.include_router(mcp_router.router, prefix="/api")

    # MCP 测试连接（路由自带 /api/mcp 前缀）
    app.include_router(mcp_test_router.router)

    # 人设读写 (SOUL.md / USER.md)
    app.include_router(persona_router.router, prefix="/api")

    # 本地路径白名单管理
    app.include_router(path_whitelist_router.router, prefix="/api")

    # MaxmaBlocker 拒止锚管理
    app.include_router(maxma_blocker_router.router, prefix="/api")

    # Anthropic Skills
    app.include_router(skills_router.router, prefix="/api")

    # 系统更新动态
    app.include_router(news_router.router, prefix="/api")

    # 重启后端
    app.include_router(restart_router.router, prefix="/api")

    # 工具环境变量管理
    app.include_router(env_vars_router.router, prefix="/api")

    # 工具使用统计
    app.include_router(tool_stats_router.router, prefix="/api")

    # 文件上传
    app.include_router(upload_router.router, prefix="/api")

    # 运行时指标
    app.include_router(metrics_router.router, prefix="/api")

    # 事件钩子
    app.include_router(event_hooks_router.router, prefix="/api")

    # 审计日志
    app.include_router(audit_log_router.router, prefix="/api")

    # 诊断与错误日志导出
    app.include_router(diagnostics_router.router, prefix="/api")

    # Transcript 读取
    from api.routes import transcripts as transcripts_router_mod
    app.include_router(transcripts_router_mod.router, prefix="/api")

    # Activity Hub —— 活动事件中心（REST + SSE）
    from api.routes import activity as activity_router
    app.include_router(activity_router.router, prefix="/api")

    # 会话手动压缩
    from api.routes import session_compress
    app.include_router(session_compress.router, prefix="/api")

    # 知识库
    from api.routes import kb as kb_router
    app.include_router(kb_router.router, prefix="/api")

    # 表情包
    from api.routes import stickers as stickers_router
    app.include_router(stickers_router.router, prefix="/api")

    # 表情收藏
    from api.routes import sticker_favorites as sticker_favorites_router
    app.include_router(sticker_favorites_router.router, prefix="/api")

    # 自定义表情上传
    from api.routes import sticker_upload as sticker_upload_router
    app.include_router(sticker_upload_router.router, prefix="/api")

    # Auth token 端点 — 桌面应用运行时获取 Token（替代构建时硬编码）
    @app.get("/api/auth/token")
    async def get_auth_token():
        """返回当前认证 Token。桌面应用启动后调用此接口获取 Token。"""
        return {"token": app.state.auth_token}

    # 健康检查
    @app.get("/api/health")
    async def health(full: bool = False):
        return await get_health_report(app, probe_remote=full)

    # 自治调度器状态（前端监控 + 外部健康检查）
    @app.get("/api/autonomy/status")
    async def get_autonomy_status():
        """获取自治调度器运行状态。"""
        from agent.autonomy.scheduler import get_autonomy_status as _get_status
        return _get_status()

    # ── 全局异常处理器 ──────────────────────────────────────────
    # 捕获所有未处理的异常，记录到 ErrorCollector 供一键导出，
    # 同时写入日志（带 exc_info），避免错误丢失。
    import traceback as _traceback
    from fastapi.responses import JSONResponse as _JSONResponse
    from fastapi import Request as _Request
    from api.diagnostics import error_collector as _error_collector

    @app.exception_handler(Exception)
    async def _global_exception_handler(request: _Request, exc: Exception):
        _error_collector.add_exception(
            exc,
            category="uncaught",
            message=f"未捕获异常 [{type(exc).__name__}]: {exc}",
            request_id=getattr(request.state, "request_id", None),
        )
        logger.error(
            "未捕获异常: %s %s -> %s: %s",
            request.method,
            request.url.path,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        return _JSONResponse(
            status_code=500,
            content={"detail": "Internal Server Error"},
        )

    # 中间件执行顺序以“最后 add 的最先执行”为准。
    # 注册顺序（add 顺序）与实际执行顺序（后 add 先执行）：
    #   add 顺序: Auth → RateLimit → RequestLog
    #   执行顺序: RequestLog → RateLimit → Auth → 路由
    # 限流在 Auth 之前，避免被拒绝的鉴权请求也消耗限流配额。
    # 阶段 3.2：新增 RateLimitMiddleware（HTTP 按 IP 限流）
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RateLimitMiddleware)

    # 请求日志放在最外层，确保包括被鉴权拒绝的请求也会被记录。
    app.add_middleware(RequestLogMiddleware)

    # 生产模式：挂载前端静态文件（必须在所有 API 路由之后）
    if os.environ.get("MAXMA_ENV") == "production":
        from app_paths import WEB_DIST_DIR as dist_dir
        if dist_dir.exists():
            from fastapi.responses import FileResponse

            # 挂载静态资源目录
            app.mount("/assets", StaticFiles(directory=dist_dir / "assets"), name="assets")
            if (dist_dir / "fonts").exists():
                app.mount("/fonts", StaticFiles(directory=dist_dir / "fonts"), name="fonts")
            if (dist_dir / "images").exists():
                app.mount("/images", StaticFiles(directory=dist_dir / "images"), name="images")

            # SPA 路由回退：所有非 API、非静态资源路径返回 index.html
            @app.get("/{path:path}")
            async def spa_fallback(path: str):
                index_path = dist_dir / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}

            # 根路径也返回 index.html
            @app.get("/")
            async def root_fallback():
                index_path = dist_dir / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}

            logger.info("[static] 已挂载前端静态文件: %s", dist_dir)
        else:
            logger.warning("[static] web/dist 目录不存在，跳过前端挂载: %s", dist_dir)

    return app
