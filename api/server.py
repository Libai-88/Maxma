"""FastAPI application factory — thin OMP proxy layer.

WS↔JSON-RPC bridge, auth, static files, config persistence.
All agent logic is handled by OMP sidecar.
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.auth import load_or_create_token
from api.activity_hub import record as record_activity
from api.cors_config import build_cors_origins
from api.middleware import RateLimitMiddleware, RequestLogMiddleware
from api.middleware.auth import AuthMiddleware
from api.routes import chat, sessions, persona, memory, mcp, tools, providers
from api.routes import deferred_runs as deferred_runs_module
from api.routes.deferred_runs import DeferredRunManager
from api.routes import settings as settings_router
from api.routes import activity as activity_router
from api.routes import balance as balance_router
from api.routes import capabilities as cmp_capabilities_router
from api.routes import plugins as plugins_router
from api.routes import collab as collab_router
from api.routes import workflows as workflows_router
from api.routes import rules as rules_router
from api.routes import automation as automation_router
from api.routes import audit_log as audit_log_router
from api.routes.automation import start_scheduler, stop_scheduler
from api.routes import diagnostics as diagnostics_router
from api.routes import files as files_router
from api.routes import maxma_blocker as maxma_blocker_router
from api.routes import mcp_test as mcp_test_router
from api.routes import metrics as metrics_router
from api.routes import news as news_router
from api.routes import restart as restart_router
from api.routes import session_compress as session_compress_router
from api.routes import settings_panels as settings_panels_router
from api.routes import stickers as stickers_router
from api.routes import sticker_favorites as sticker_favorites_router
from api.routes import sticker_upload as sticker_upload_router
from api.routes import transcripts as transcripts_router
from api.routes import upload as upload_router
from api.session_manager import SessionManager
from api.ws_registry import WebSocketRegistry
from api.pi_bridge.sidecar_manager import SidecarManager
from config.settings import get_settings
from version import __version__

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Auth token
    from api.db.auth import load_or_create_token as load_token

    app.state.auth_token = load_token()
    logger.info("[auth] token ready")

    # 2. Session manager
    app.state.session_manager = SessionManager()
    app.state.ws_registry = WebSocketRegistry()

    # 3. Sidecar manager (lazy start)
    app.state.sidecar_manager = SidecarManager()
    logger.info("[sidecar] SidecarManager created")

    # 4. Startup migration: encrypt any plaintext api_keys in providers.yaml.
    # Idempotent — skips already-encrypted (encv1:/enc:) values. B-009 fix.
    try:
        from api.routes.providers import migrate_plaintext_keys_to_encrypted

        encrypted_n = migrate_plaintext_keys_to_encrypted()
        if encrypted_n > 0:
            logger.info(
                "[providers] startup migration: encrypted %d plaintext api_key(s)",
                encrypted_n,
            )
    except Exception:
        logger.exception("[providers] startup migration failed (non-fatal)")

    # 4.1 Builtin default provider: OpenCode Zen free models (out-of-box).
    # Injects opencode-zen with the anonymous key (public) so new users can
    # chat immediately without configuring any API key. Then starts a
    # background task that keeps the official free-model list in sync.
    app.state.opencode_zen_sync_task = None
    try:
        from api.services.opencode_zen import (
            ensure_opencode_zen_provider,
            start_background_sync,
        )

        ensure_opencode_zen_provider()
        app.state.opencode_zen_sync_task = await start_background_sync()
        logger.info("[opencode-zen] builtin default provider ready, background sync started")
    except Exception:
        logger.exception("[opencode-zen] startup injection failed (non-fatal)")

    record_activity(
        "system", "startup",
        message=f"MaxmaHere 后端启动完成 ({__version__})",
    )

    # 5. Deferred run manager — in-memory, populated by sidecar WS events
    app.state.deferred_run_manager = DeferredRunManager()
    session_manager = app.state.session_manager
    session_manager.set_deferred_run_manager(app.state.deferred_run_manager)
    logger.info("[deferred] DeferredRunManager initialized")

    # 6. Health check state: native_tools + mcp_tools
    from api.routes.tools import _BUILTIN_TOOLS as _HEALTH_TOOLS
    app.state.native_tools = _HEALTH_TOOLS
    app.state.mcp_tools = []  # populated dynamically by MCP manager
    logger.info("[health] native_tools=%d", len(app.state.native_tools))

    # 7. Automation scheduler — background task that checks for due automations
    app.state.automation_scheduler = start_scheduler(sidecar_mgr=app.state.sidecar_manager)
    logger.info("[automation] Background scheduler started")

    # 7.1 Metrics history flush — persist in-memory snapshots to SQLite every
    # 60s so /api/metrics/history returns real history (was never started before).
    try:
        from api.metrics import get_metrics

        get_metrics().start_flush_task(interval_seconds=60)
        logger.info("[metrics] Background history flush started")
    except Exception:
        logger.exception("[metrics] Failed to start history flush (non-fatal)")

    yield

    # Cancel the OpenCode Zen background sync task (if started)
    sync_task = getattr(app.state, "opencode_zen_sync_task", None)
    if sync_task is not None:
        sync_task.cancel()
        try:
            await sync_task
        except (asyncio.CancelledError, Exception):
            pass
        logger.info("[opencode-zen] background sync stopped")

    if getattr(app.state, "sidecar_manager", None):
        await app.state.sidecar_manager.stop()
        logger.info("[sidecar] SidecarManager stopped")

    # Stop automation scheduler background task
    await stop_scheduler()

    # Stop metrics history flush task (final persist on shutdown)
    try:
        from api.metrics import get_metrics

        await get_metrics().stop_flush_task()
    except Exception:
        logger.exception("[metrics] Failed to stop history flush (non-fatal)")

    record_activity("system", "shutdown", message="MaxmaHere 后端正在关闭")

    # 关闭 balance.py 共享 httpx.AsyncClient 连接池，避免资源泄漏
    # （_shared_async_client 是模块级单例，lifespan shutdown 不会自动关闭它）。
    try:
        from api.routes.balance import close_async_client

        await close_async_client()
        logger.info("[balance] shared httpx.AsyncClient closed")
    except Exception:
        logger.exception("[balance] failed to close shared httpx.AsyncClient")


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
    # 认证中间件 — 校验 X-Maxma-Token header（HTTP）或 WebSocket subprotocol。
    # 必须在 CORS 之后 add（LIFO 栈：后 add 先执行），使 CORS 预检请求先于 Auth 处理；
    # /api/health 和 /api/auth/token 在白名单中放行，桌面端启动时先取 token 再带 header。
    app.add_middleware(AuthMiddleware)
    # 限流中间件 — 按 IP 令牌桶限流，超限返回 429。在 Auth 之前执行（后 add 先执行），
    # 避免被拒绝的鉴权请求也消耗限流配额。
    app.add_middleware(RateLimitMiddleware)
    # 请求日志 + 指标采集中间件 — 记录每个 HTTP 请求的方法/路径/状态码/耗时到 Metrics 单例
    app.add_middleware(RequestLogMiddleware)

    # REST routes
    app.include_router(sessions.router, prefix="/api")
    app.include_router(chat.router)
    app.include_router(persona.router, prefix="/api")
    # settings_panels 必须在 memory 之前注册：其静态路由
    # PUT /memory/hindsight-config 否则会被 memory 的动态路由
    # PUT /memory/{memory_id} 抢先匹配（FastAPI 按注册顺序匹配）。
    app.include_router(settings_panels_router.router, prefix="/api")
    app.include_router(memory.router, prefix="/api")
    app.include_router(mcp.router, prefix="/api")
    app.include_router(tools.router, prefix="/api")
    app.include_router(providers.router, prefix="/api")
    app.include_router(settings_router.router, prefix="/api")
    app.include_router(stickers_router.router, prefix="/api")
    app.include_router(sticker_favorites_router.router, prefix="/api")
    app.include_router(sticker_upload_router.router, prefix="/api")
    app.include_router(restart_router.router, prefix="/api")
    app.include_router(activity_router.router, prefix="/api")
    app.include_router(balance_router.router, prefix="/api")
    app.include_router(diagnostics_router.router, prefix="/api")
    app.include_router(files_router.router, prefix="/api")
    app.include_router(maxma_blocker_router.router, prefix="/api")
    app.include_router(mcp_test_router.router)
    app.include_router(metrics_router.router, prefix="/api")
    app.include_router(news_router.router, prefix="/api")
    app.include_router(session_compress_router.router, prefix="/api")
    app.include_router(transcripts_router.router, prefix="/api")
    app.include_router(upload_router.router, prefix="/api")
    app.include_router(cmp_capabilities_router.router, prefix="/api")
    app.include_router(plugins_router.router, prefix="/api")
    app.include_router(collab_router.router, prefix="/api")
    app.include_router(workflows_router.router, prefix="/api")
    app.include_router(rules_router.router, prefix="/api")
    app.include_router(automation_router.router, prefix="/api")
    app.include_router(audit_log_router.router, prefix="/api")
    app.include_router(deferred_runs_module.router, prefix="/api")

    # Auth token endpoint — desktop app fetches token at runtime
    @app.get("/api/auth/token")
    async def get_auth_token():
        return {"token": app.state.auth_token}

    # Health check
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": __version__}

    # Production static file serving
    if os.environ.get("MAXMA_ENV") == "production":
        from app_paths import WEB_DIST_DIR as dist_dir

        if dist_dir.exists():
            from fastapi.responses import FileResponse

            app.mount(
                "/assets",
                StaticFiles(directory=dist_dir / "assets"),
                name="assets",
            )
            if (dist_dir / "fonts").exists():
                app.mount(
                    "/fonts",
                    StaticFiles(directory=dist_dir / "fonts"),
                    name="fonts",
                )
            if (dist_dir / "images").exists():
                app.mount(
                    "/images",
                    StaticFiles(directory=dist_dir / "images"),
                    name="images",
                )

            # Vite emits separate entry pages for Quick Chat and the splash
            # screen. Register them before the SPA fallback so they do not
            # receive the main index.html by accident.
            for entry_name in ("quick-chat.html", "splash.html"):
                entry_path = dist_dir / entry_name
                if entry_path.exists():
                    async def serve_entry(entry_path=entry_path):
                        return FileResponse(entry_path)

                    app.add_api_route(
                        f"/{entry_name}",
                        serve_entry,
                        methods=["GET"],
                        include_in_schema=False,
                    )

            @app.get("/{path:path}")
            async def spa_fallback(path: str):
                index_path = dist_dir / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}

            @app.get("/")
            async def root_fallback():
                index_path = dist_dir / "index.html"
                if index_path.exists():
                    return FileResponse(index_path)
                return {"detail": "Not Found"}

            logger.info("[static] Mounted frontend static files: %s", dist_dir)
        else:
            logger.warning(
                "[static] web/dist directory not found, skipping frontend mount: %s",
                dist_dir,
            )

    return app
