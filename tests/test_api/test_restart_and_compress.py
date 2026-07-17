"""测试 — api/routes/restart.py 重启端点 + session_compress.py 压缩端点。

restart.py: POST /restart 调用 sys.exit，mock exit 验证流程。
session_compress.py: POST /sessions/{id}/compress 和 /fresh-compact。
"""

import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import restart as restart_mod
from api.routes.restart import router as restart_router
from api.routes.session_compress import router as compress_router


class TestRestart:
    @pytest.fixture
    def app_client(self, monkeypatch):
        # mock sys.exit 防止真退出
        def fake_exit(code=0):
            raise SystemExit(code)
        monkeypatch.setattr(restart_mod.sys, "exit", fake_exit)
        # mock subprocess.Popen 防止真起进程
        monkeypatch.setattr(restart_mod.subprocess, "Popen", lambda *a, **k: None)
        app = FastAPI()
        app.include_router(restart_router)
        return TestClient(app)

    def test_restart_dev_mode_exits(self, app_client, monkeypatch):
        # frozen=False（开发模式）→ Popen + sys.exit(0)
        monkeypatch.delattr(restart_mod.sys, "frozen", raising=False)
        with pytest.raises(SystemExit):
            app_client.post("/restart")

    def test_restart_frozen_mode_exits(self, app_client, monkeypatch):
        # frozen=True → 直接 sys.exit(0)
        monkeypatch.setattr(restart_mod.sys, "frozen", True, raising=False)
        with pytest.raises(SystemExit):
            app_client.post("/restart")


class _FakeSession:
    def __init__(self, session_id="s1"):
        self.session_id = session_id


class _FakeSessionManager:
    def __init__(self, session=None):
        self._session = session

    async def get(self, session_id):
        return self._session


class TestSessionCompress:
    @pytest.fixture
    def app_with_session(self):
        app = FastAPI()
        app.state.session_manager = _FakeSessionManager(_FakeSession())
        app.include_router(compress_router)
        return TestClient(app)

    @pytest.fixture
    def app_without_session(self):
        app = FastAPI()
        app.state.session_manager = _FakeSessionManager(session=None)
        app.include_router(compress_router)
        return TestClient(app)

    def test_compress_success(self, app_with_session):
        resp = app_with_session.post("/sessions/s1/compress")
        assert resp.status_code == 200
        body = resp.json()
        assert body["compressed"] is True
        assert body["method"] == "automatic"

    def test_compress_404(self, app_without_session):
        resp = app_without_session.post("/sessions/ghost/compress")
        assert resp.status_code == 404

    def test_fresh_compact_success(self, app_with_session):
        resp = app_with_session.post("/sessions/s1/fresh-compact")
        assert resp.status_code == 200
        body = resp.json()
        assert body["compressed"] is True

    def test_fresh_compact_404(self, app_without_session):
        resp = app_without_session.post("/sessions/ghost/fresh-compact")
        assert resp.status_code == 404
