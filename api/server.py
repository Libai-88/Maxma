"""FastAPI 应用工厂 — 生命周期管理、CORS、路由挂载。"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import time

from api.auth import load_or_create_token
from api.const_session_store import (
    load_all_const_sessions,
)
from api.dependencies import get_system_prompt, get_tools
from api.health import get_health_report
from api.cors_config import build_cors_origins
from api.logging_config import setup_logging
from app_paths import AUTONOMY_SCHEDULES_PATH, WORKFLOW_JOURNAL_PATH
from api.routes import chat, files, sessions, balance
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
from version import __version__

from api.middleware.auth import AuthMiddleware
from api.middleware.rate_limit import RateLimitMiddleware
from api.middleware.request_log import RequestLogMiddleware

logger = logging.getLogger(__name__)


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

    # 1. 初始化共享资源
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
        # tools.workflow removed — workflow unavailable
        app.state.workflow_run_manager = None
        app.state.session_manager.set_workflow_run_manager(app.state.workflow_run_manager)
        app.state.workflow_run_manager.recover()
    app.state.ws_registry = WebSocketRegistry()

    # oh-my-pi sidecar 模式：不需要 checkpointer
    logger.debug("[checkpointer] sidecar-only mode — skip checkpointer init")

    # OMP ModelRegistry 管理所有 provider，Python 端不再需要 LLM 初始化

    # MCP 工具（tools/ directory removed）
    app.state.mcp_tools = []
    app.state.tools = list(app.state.native_tools or [])

    # 加载 const 固定会话
    await _load_const_sessions(app)

    # 2. 启动定时 session 清理任务（每 5 分钟清理超过 TTL 的不活跃会话）
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

    # 2.5 启动指标持久化 flush 任务（定期将内存快照写入 SQLite）
    from api.metrics import get_metrics
    get_metrics().start_flush_task()

    # 3. 初始化认证 Token（SQLite 存储）
    from api.db.auth import load_or_create_token as load_token_db
    app.state.auth_token = load_token_db()
    logger.info("[auth] token: %s...%s", app.state.auth_token[:4], app.state.auth_token[-4:])

    # 4. 初始化事件钩子管理器
    from agent.hooks import get_hook_manager
    hook_manager = get_hook_manager()
    hook_manager.set_loop(asyncio.get_running_loop())
    # 后台事件钩子执行已移至 OMP sidecar，Python 端不再提供 LangGraph 执行回调
    hook_manager.load()
    hook_manager.start_all()
    app.state.hook_manager = hook_manager
    logger.info("[hooks] 事件钩子管理器已启动，%d 个钩子", len(hook_manager.list_hooks()))

    # 4.5 初始化 oh-my-pi sidecar 管理器（懒启动，首次调用时自动拉起 Bun 进程）
    from api.pi_bridge.sidecar_manager import SidecarManager
    app.state.sidecar_manager = SidecarManager()
    logger.info("[sidecar] SidecarManager 已创建")

    # 5. 启动自治调度器（默认关闭，需在 .env 中设置 autonomy_enabled=true）
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
        await asyncio.sleep(5)
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

    app.state._cleanup_task.cancel()
    try:
        await app.state._cleanup_task
    except asyncio.CancelledError:
        pass

    # 停止指标 flush 任务（执行最终 flush）
    from api.metrics import get_metrics
    await get_metrics().stop_flush_task()

    # 关闭事件钩子
    hook_manager.stop_all()
    logger.info("[hooks] 事件钩子管理器已停止")

    # 停止自治调度器
    from agent.autonomy.scheduler import stop_autonomy
    await stop_autonomy()
    scout_runner = getattr(app.state, "autonomy_scout_runner", None)
    if scout_runner is not None:
        await scout_runner.shutdown()

    # MCP shutdown: tools/ directory removed — no-op

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

    # 停止 oh-my-pi sidecar（如果已启动）
    sidecar_mgr = getattr(app.state, "sidecar_manager", None)
    if sidecar_mgr:
        await sidecar_mgr.stop()
        logger.info("[sidecar] SidecarManager 已停止")

    # Playwright browser: tools/ directory removed — no-op

    # oh-my-pi sidecar 模式：不需要关闭 checkpointer


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
    app.include_router(files.router, prefix="/api")
    app.include_router(balance.router, prefix="/api")

    # WebSocket 路由（无 /api 前缀）
    app.include_router(chat.router)

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

    # 中间件执行顺序以"最后 add 的最先执行"为准。
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RateLimitMiddleware)
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
