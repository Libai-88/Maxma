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
    deserialize_messages,
    load_all_const_sessions,
)
from api.dependencies import get_llm, get_system_prompt, get_tools
from api.health import get_health_report
from api.logging_config import setup_logging
from api.providers.manager import ProviderManager
from api.providers.store import ProviderConfigStore
from app_paths import PROVIDERS_YAML_PATH
from api.routes import chat, files, memory, sessions, balance, providers
from api.routes import path_whitelist as path_whitelist_router
from api.routes import persona as persona_router
from api.routes import maxma_blocker as maxma_blocker_router
from api.routes import skills as skills_router
from api.routes import news as news_router
from api.routes import mcp as mcp_router
from api.routes import restart as restart_router
from api.routes import env_vars as env_vars_router
from api.routes import tool_stats as tool_stats_router
from api.routes import upload as upload_router
from api.routes import metrics as metrics_router
from api.routes import event_hooks as event_hooks_router
from api.routes import audit_log as audit_log_router
from api.session_manager import SessionManager, SessionState
from api.ws_registry import WebSocketRegistry
from agent.graph import build_agent
from memory.narrative import MEMORY_PATH, LongTermMemoryInterface
from tools import merge_tool_lists
from tools.mcp import init_mcp_tools, close_mcp, set_reload_callback
from version import __version__

from api.middleware.auth import AuthMiddleware
from api.middleware.request_log import RequestLogMiddleware

logger = logging.getLogger(__name__)


async def _load_const_sessions(app: FastAPI):
    """从 YAML 重建所有 const 固定会话到内存 SessionManager。"""
    sm = app.state.session_manager
    const_list = load_all_const_sessions()
    if not const_list:
        return

    if app.state.llm is None:
        logger.warning("[const] Skipping %d const session(s) — no LLM available", len(const_list))
        return

    from langgraph.checkpoint.memory import MemorySaver

    loaded = 0
    for const_data in const_list:
        sid = const_data.get("session_id")
        if not sid or sid in sm._sessions:
            continue

        metadata = const_data.get("metadata", {})
        const_name = const_data.get("const_name", "")
        messages = const_data.get("messages", [])

        # 重建 checkpointer
        try:
            reconstructed = deserialize_messages(messages)
            checkpointer = MemorySaver()
            if reconstructed:
                agent = build_agent(
                    model=app.state.llm,
                    tools=app.state.tools,
                    system_prompt=app.state.system_prompt,
                    checkpointer=checkpointer,
                )
                await agent.aupdate_state(
                    {"configurable": {"thread_id": sid}},
                    {"messages": reconstructed},
                )
        except Exception as e:
            logger.warning("[const] 重建会话 %s 失败: %s", sid, e)
            continue

        session = SessionState(
            session_id=sid,
            created_at=metadata.get("created_at", time.time()),
            last_active=metadata.get("last_active", time.time()),
            message_count=metadata.get("message_count", 0),
            checkpointer=checkpointer,
            is_const=True,
            const_name=const_name,
        )
        sm._sessions[sid] = session
        loaded += 1

    logger.info("[const] 已加载 %d/%d 个固定会话", loaded, len(const_list))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. 初始化 Provider 管理器（优先从 YAML 加载）
    provider_store = ProviderConfigStore(path=PROVIDERS_YAML_PATH)
    if provider_store.migrate_from_legacy_root_yaml():
        logger.info("[provider] migrated legacy root providers.yaml -> %s", PROVIDERS_YAML_PATH)
    elif provider_store.has_legacy_root_conflict():
        logger.warning(
            "[provider] detected legacy root providers.yaml with different content; "
            "active config is %s and root providers.yaml is ignored",
            PROVIDERS_YAML_PATH,
        )
    if provider_store.is_empty:
        migrated = provider_store.migrate_from_env()
        if migrated:
            logger.info("[provider] migrated %s from .env → providers.yaml", migrated.label)
    provider_manager = ProviderManager(provider_store)
    provider_manager.load_all()
    app.state.provider_manager = provider_manager
    logger.info("[provider] loaded %d provider(s)", provider_manager.count)

    # 2. 其他共享资源（LLM 统一从 ProviderManager 获取）
    try:
        app.state.llm = get_llm(provider_manager)
    except RuntimeError as e:
        logger.warning("[llm] %s", e)
        logger.warning("[llm] No LLM configured — chat will be read-only until a provider is added")
        app.state.llm = None
    app.state.system_prompt = get_system_prompt()
    app.state.native_tools = get_tools()
    app.state.session_manager = SessionManager()
    app.state.ws_registry = WebSocketRegistry()
    app.state.ltm = LongTermMemoryInterface(MEMORY_PATH)
    if app.state.llm is not None:
        app.state.ltm.start_listening(app.state.llm, ws_registry=app.state.ws_registry)
        logger.info("[ltm] 长期记忆监听器已启动")
    else:
        logger.info("[ltm] Skipped (no LLM available)")

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
            removed = sm.cleanup_expired()
            if removed:
                logger.info(
                    "[session] cleanup: removed %d expired session(s), %d remaining",
                    removed, len(sm._sessions),
                )

    app.state._cleanup_task = asyncio.create_task(_periodic_cleanup())

    # 5. 初始化认证 Token
    app.state.auth_token = load_or_create_token()
    logger.info("[auth] token: %s...%s", app.state.auth_token[:4], app.state.auth_token[-4:])

    # 6. 初始化事件钩子管理器
    from agent.hooks import get_hook_manager
    hook_manager = get_hook_manager()
    hook_manager.set_loop(asyncio.get_running_loop())
    hook_manager.load()
    hook_manager.start_all()
    app.state.hook_manager = hook_manager
    logger.info("[hooks] 事件钩子管理器已启动，%d 个钩子", len(hook_manager.list_hooks()))

    yield

    # 关闭：清理资源
    app.state._cleanup_task.cancel()
    try:
        await app.state._cleanup_task
    except asyncio.CancelledError:
        pass

    # 关闭事件钩子
    hook_manager.stop_all()
    logger.info("[hooks] 事件钩子管理器已停止")

    await close_mcp()
    await balance.close_async_client()
    await app.state.ltm.stop_listening()

    # 关闭 Playwright 浏览器（如果已启动）
    try:
        from tools.network.playwright_tools.browser_manager import BrowserManager
        BrowserManager().shutdown()
    except Exception:
        logger.warning("[playwright] browser shutdown failed", exc_info=True)


def create_app() -> FastAPI:
    app = FastAPI(
        title="MaxmaHere API",
        version=__version__,
        lifespan=lifespan,
    )

    # CORS：开发环境仅放行 Vite（5173），生产环境加 localhost:8000 + Tauri 协议
    cors_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    if os.environ.get("MAXMA_ENV") == "production":
        cors_origins += [
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            # Tauri v2 协议
            "tauri://localhost",
            "https://tauri.localhost",
        ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # REST 路由
    app.include_router(sessions.router, prefix="/api")
    app.include_router(memory.router, prefix="/api")
    app.include_router(files.router, prefix="/api")
    app.include_router(balance.router, prefix="/api")

    # WebSocket 路由（无 /api 前缀）
    app.include_router(chat.router)

    # Provider CRUD 路由
    app.include_router(providers.router, prefix="/api")

    # MCP 服务器配置查看与热加载
    app.include_router(mcp_router.router, prefix="/api")

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
    async def health():
        return await get_health_report(app)

    # 中间件执行顺序以“最后 add 的最先执行”为准。
    # 这里先注册 Auth，再注册 RequestLog，因此实际顺序是：
    # RequestLog -> Auth -> 路由。
    # Auth 是否放行由它自身的路径判断控制，而不是由路由注册顺序控制。
    app.add_middleware(AuthMiddleware)

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
