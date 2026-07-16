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
from api.cors_config import build_cors_origins
from api.routes import chat, sessions, persona, skills
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

    yield

    if getattr(app.state, "sidecar_manager", None):
        await app.state.sidecar_manager.stop()
        logger.info("[sidecar] SidecarManager stopped")


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

    # REST routes
    app.include_router(sessions.router, prefix="/api")
    app.include_router(chat.router)
    app.include_router(persona.router, prefix="/api")
    app.include_router(skills.router, prefix="/api")

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
