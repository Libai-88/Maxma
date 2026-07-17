"""补充测试 — api/server.py 的 create_app + lifespan + 生产静态文件挂载。

覆盖范围：
- create_app() 返回 FastAPI 实例、title/version、CORS 中间件、/api/health 端点
- 生产模式下静态文件挂载（dist 存在/不存在、fonts/images 条件挂载、spa/root fallback）
- lifespan 生命周期：auth_token / session_manager / ws_registry / sidecar_manager 创建与 stop
"""

import logging
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.server import create_app, lifespan


def _route_paths(app) -> list[str]:
    """从 app.routes 提取所有路径，包括 _IncludedRouter.original_router 内的嵌套路由。"""
    paths = []
    for r in app.routes:
        path = getattr(r, "path", None)
        if path:
            paths.append(path)
        # _IncludedRouter 通过 original_router 暴露嵌套路由
        orig = getattr(r, "original_router", None)
        if orig:
            for ir in getattr(orig, "routes", []):
                ip = getattr(ir, "path", None)
                if ip:
                    paths.append(ip)
    return paths


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_lifespan_deps(monkeypatch):
    """Mock lifespan 依赖避免真实 sidecar/DB 操作。

    lifespan 内部局部 import:
        from api.db.auth import load_or_create_token as load_token
    所以 patch api.db.auth.load_or_create_token 即可。
    """
    monkeypatch.setattr(
        "api.db.auth.load_or_create_token", lambda: "fake-token"
    )

    mock_session_mgr = MagicMock()
    monkeypatch.setattr(
        "api.server.SessionManager", MagicMock(return_value=mock_session_mgr)
    )

    mock_ws_registry = MagicMock()
    monkeypatch.setattr(
        "api.server.WebSocketRegistry",
        MagicMock(return_value=mock_ws_registry),
    )

    mock_sidecar = MagicMock()
    mock_sidecar.stop = AsyncMock()
    monkeypatch.setattr(
        "api.server.SidecarManager", MagicMock(return_value=mock_sidecar)
    )

    return {
        "session_mgr": mock_session_mgr,
        "ws_registry": mock_ws_registry,
        "sidecar": mock_sidecar,
    }


# ===========================================================================
# create_app — basic
# ===========================================================================


class TestCreateAppBasic:
    def test_returns_fastapi_instance(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        assert isinstance(app, FastAPI)

    def test_title_set(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        assert app.title == "MaxmaHere API"

    def test_version_set(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        from version import __version__

        app = create_app()
        assert app.version == __version__

    def test_cors_middleware_added(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        middleware_names = [m.cls.__name__ for m in app.user_middleware]
        assert "CORSMiddleware" in middleware_names

    def test_health_endpoint(self, monkeypatch):
        """/api/health 不依赖 lifespan，可无 with 块测试。"""
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        client = TestClient(app)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        from version import __version__

        assert data["version"] == __version__

    def test_includes_sessions_router(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        routes = _route_paths(app)
        # sessions.router 的路由路径为 /sessions/... (不含 /api 前缀)
        assert any("sessions" in r for r in routes)

    def test_includes_chat_websocket(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        routes = _route_paths(app)
        # chat.router 的 WebSocket 路径为 /ws/chat/{session_id}
        assert any("/ws/chat" in r for r in routes)

    def test_non_production_no_catch_all_route(self, monkeypatch):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        routes = _route_paths(app)
        # 非生产模式不应注册 /{path:path} catch-all
        assert "/{path}" not in routes
        assert "/{path:path}" not in routes


# ===========================================================================
# create_app — production static files
# ===========================================================================


class TestCreateAppProductionStatic:
    def test_production_mounts_assets_when_dist_exists(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "fonts").mkdir()
        (tmp_path / "images").mkdir()
        (tmp_path / "index.html").write_text("<html></html>")

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        routes = _route_paths(app)
        assert "/assets" in routes
        assert "/fonts" in routes
        assert "/images" in routes

    def test_production_skips_fonts_when_not_exists(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text("<html></html>")
        # 不创建 fonts/ 目录

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        routes = _route_paths(app)
        assert "/assets" in routes
        assert "/fonts" not in routes

    def test_production_skips_images_when_not_exists(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text("<html></html>")
        # 不创建 images/ 目录

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        routes = _route_paths(app)
        assert "/assets" in routes
        assert "/images" not in routes

    def test_production_warns_when_dist_missing(
        self, monkeypatch, tmp_path, caplog
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        nonexistent = tmp_path / "nonexistent"
        monkeypatch.setattr("app_paths.WEB_DIST_DIR", nonexistent)

        with caplog.at_level(logging.WARNING):
            app = create_app()

        routes = _route_paths(app)
        assert "/assets" not in routes
        assert any("[static]" in r.message for r in caplog.records)

    def test_production_spa_fallback_serves_index(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text(
            "<html><body>SPA</body></html>"
        )

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        client = TestClient(app)
        resp = client.get("/some/random/path")
        assert resp.status_code == 200
        assert "SPA" in resp.text

    def test_production_root_fallback_serves_index(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text(
            "<html><body>ROOT</body></html>"
        )

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        client = TestClient(app)
        resp = client.get("/")
        assert resp.status_code == 200
        assert "ROOT" in resp.text

    def test_production_spa_fallback_returns_not_found_when_no_index(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        # 不创建 index.html

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        client = TestClient(app)
        resp = client.get("/some/path")
        # spa_fallback 返回 dict {"detail": "Not Found"}，状态码 200
        assert resp.status_code == 200
        assert resp.json() == {"detail": "Not Found"}

    def test_production_root_fallback_returns_not_found_when_no_index(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        # 不创建 index.html

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        client = TestClient(app)
        resp = client.get("/")
        assert resp.status_code == 200
        assert resp.json() == {"detail": "Not Found"}

    def test_production_health_still_works_with_catch_all(
        self, monkeypatch, tmp_path
    ):
        """生产模式下 /api/health 应优先于 /{path:path} catch-all。"""
        monkeypatch.setenv("MAXMA_ENV", "production")
        (tmp_path / "assets").mkdir()
        (tmp_path / "index.html").write_text("<html></html>")

        monkeypatch.setattr("app_paths.WEB_DIST_DIR", tmp_path)

        app = create_app()
        client = TestClient(app)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


# ===========================================================================
# lifespan
# ===========================================================================


class TestLifespan:
    def test_lifespan_sets_auth_token(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app):
            assert app.state.auth_token == "fake-token"

    def test_lifespan_creates_session_manager(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app):
            assert (
                app.state.session_manager
                is patched_lifespan_deps["session_mgr"]
            )

    def test_lifespan_creates_ws_registry(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app):
            assert (
                app.state.ws_registry
                is patched_lifespan_deps["ws_registry"]
            )

    def test_lifespan_creates_sidecar_manager(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app):
            assert (
                app.state.sidecar_manager
                is patched_lifespan_deps["sidecar"]
            )

    def test_lifespan_stops_sidecar_on_shutdown(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app):
            pass  # 退出 with 触发 shutdown

        patched_lifespan_deps["sidecar"].stop.assert_awaited_once()

    async def test_lifespan_skip_stop_when_sidecar_cleared(
        self, monkeypatch
    ):
        """当 sidecar_manager 在 yield 期间被清除时，shutdown 不抛异常。"""
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        monkeypatch.setattr(
            "api.db.auth.load_or_create_token", lambda: "fake-token"
        )
        monkeypatch.setattr(
            "api.server.SessionManager", MagicMock(return_value=MagicMock())
        )
        monkeypatch.setattr(
            "api.server.WebSocketRegistry",
            MagicMock(return_value=MagicMock()),
        )
        mock_sidecar = MagicMock()
        mock_sidecar.stop = AsyncMock()
        monkeypatch.setattr(
            "api.server.SidecarManager",
            MagicMock(return_value=mock_sidecar),
        )

        app = FastAPI()
        # 直接使用 lifespan 作为 async context manager
        async with lifespan(app):
            # 模拟 sidecar_manager 在运行期间被清除
            app.state.sidecar_manager = None

        # stop 不应被调用（因为 sidecar_manager 为 None）
        mock_sidecar.stop.assert_not_awaited()

    def test_auth_token_endpoint(
        self, monkeypatch, patched_lifespan_deps
    ):
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        app = create_app()
        with TestClient(app) as client:
            resp = client.get("/api/auth/token")
            assert resp.status_code == 200
            assert resp.json() == {"token": "fake-token"}
