"""测试 — api/routes/sessions.py 会话 CRUD 辅助函数 + 简单路由。

覆盖纯辅助函数 _permission_modes_enabled / _permission_mode_metadata，
以及不依赖 sidecar 的简单路由（create/list/get/permission-mode/delete）。
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from api.routes import sessions as sessions_mod
from api.routes.sessions import (
    ConstifyRequest,
    PermissionModeRequest,
    _permission_mode_metadata,
    _permission_modes_enabled,
    router,
)


class _FakeSession:
    """模拟 SessionState。"""

    def __init__(self, session_id="s1", is_const=False, const_name="",
                 permission_mode="ask", permission_mode_updated_at=None,
                 active_task=None, message_count=5):
        self.session_id = session_id
        self.is_const = is_const
        self.const_name = const_name
        self.permission_mode = permission_mode
        self.permission_mode_updated_at = permission_mode_updated_at or "2026-01-01T00:00:00Z"
        self._active_task = active_task
        self.message_count = message_count
        self.created_at = "2026-01-01T00:00:00Z"
        self._sidecar_session_id = None
        self._sidecar_mgr = None

    def set_permission_mode(self, mode):
        if mode not in ("read_only", "ask", "operate", "auto"):
            raise ValueError(f"bad mode: {mode}")
        self.permission_mode = mode

    def persistent_metadata(self):
        return {"created_at": self.created_at}


class _FakeSessionManager:
    def __init__(self, sessions=None):
        self._sessions = sessions or {}
        self.created = []

    async def create(self):
        sid = f"s{len(self.created) + 1}"
        s = _FakeSession(session_id=sid)
        self._sessions[sid] = s
        self.created.append(sid)
        return s

    async def list_sessions(self):
        return [
            {"session_id": sid, "created_at": s.created_at}
            for sid, s in self._sessions.items()
        ]

    async def get(self, session_id):
        return self._sessions.get(session_id)

    async def delete(self, session_id):
        return self._sessions.pop(session_id, None) is not None


@pytest.fixture
def app_client(monkeypatch):
    """创建带 mock session_manager 的 app。"""
    # 确保 permission_modes 默认禁用
    monkeypatch.setattr(
        sessions_mod, "_permission_modes_enabled", lambda: False
    )
    app = FastAPI()
    app.state.session_manager = _FakeSessionManager()
    app.state.system_prompt = "system prompt"
    app.state.sidecar_manager = None
    app.state.llm = None
    app.include_router(router)
    return {"app": app, "client": TestClient(app)}


class TestPermissionModesEnabled:
    def test_returns_true_when_setting_enabled(self, monkeypatch):
        class FakeSettings:
            permission_modes_enabled = True
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _permission_modes_enabled() is True

    def test_returns_false_when_setting_disabled(self, monkeypatch):
        class FakeSettings:
            permission_modes_enabled = False
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _permission_modes_enabled() is False

    def test_returns_false_on_exception(self, monkeypatch):
        def boom():
            raise RuntimeError("no settings")
        monkeypatch.setattr("config.settings.get_settings", boom)
        assert _permission_modes_enabled() is False


class TestPermissionModeMetadata:
    def test_enabled_returns_actual_mode(self):
        s = _FakeSession(permission_mode="operate")
        meta = _permission_mode_metadata(s, enabled=True)
        assert meta["session_id"] == "s1"
        assert meta["permission_modes_enabled"] is True
        assert meta["permission_mode"] == "operate"
        assert meta["available_permission_modes"] == [
            "read_only", "ask", "operate", "auto"
        ]

    def test_disabled_reports_ask(self):
        s = _FakeSession(permission_mode="operate")
        meta = _permission_mode_metadata(s, enabled=False)
        assert meta["permission_modes_enabled"] is False
        assert meta["permission_mode"] == "ask"
        assert meta["available_permission_modes"] == []


class TestCreateSession:
    def test_create_returns_id(self, app_client):
        resp = app_client["client"].post("/sessions")
        assert resp.status_code == 200
        body = resp.json()
        assert "session_id" in body
        assert "created_at" in body


class TestListSessions:
    def test_list_empty(self, app_client):
        resp = app_client["client"].get("/sessions")
        assert resp.status_code == 200
        assert resp.json() == {"sessions": []}

    def test_list_after_create(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].get("/sessions")
        body = resp.json()
        assert len(body["sessions"]) == 1


class TestGetSession:
    def test_get_existing(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].get("/sessions/s1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == "s1"
        assert body["is_const"] is False
        assert body["has_active_agent"] is False

    def test_get_not_found_404(self, app_client):
        resp = app_client["client"].get("/sessions/ghost")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


class TestPermissionModeRoutes:
    def test_get_permission_mode(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].get("/sessions/s1/permission-mode")
        assert resp.status_code == 200
        body = resp.json()
        assert body["permission_modes_enabled"] is False
        assert body["permission_mode"] == "ask"

    def test_get_permission_mode_404(self, app_client):
        resp = app_client["client"].get("/sessions/ghost/permission-mode")
        assert resp.status_code == 404

    def test_set_permission_mode_disabled_409(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].put(
            "/sessions/s1/permission-mode",
            json={"permission_mode": "operate"},
        )
        assert resp.status_code == 409

    def test_set_permission_mode_enabled_success(self, app_client, monkeypatch):
        monkeypatch.setattr(sessions_mod, "_permission_modes_enabled", lambda: True)
        app_client["client"].post("/sessions")
        resp = app_client["client"].put(
            "/sessions/s1/permission-mode",
            json={"permission_mode": "auto"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["permission_mode"] == "auto"
        assert body["permission_modes_enabled"] is True

    def test_set_permission_mode_404(self, app_client):
        resp = app_client["client"].put(
            "/sessions/ghost/permission-mode",
            json={"permission_mode": "auto"},
        )
        assert resp.status_code == 404


class TestDeleteSession:
    def test_delete_existing(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].delete("/sessions/s1")
        assert resp.status_code == 200
        assert resp.json() == {"status": "deleted"}

    def test_delete_not_found_404(self, app_client):
        resp = app_client["client"].delete("/sessions/ghost")
        assert resp.status_code == 404


class TestUndoSession:
    def test_undo_n_less_than_1(self, app_client):
        resp = app_client["client"].post("/sessions/s1/undo?n=0")
        assert resp.status_code == 200
        assert resp.json() == {"deleted_count": 0}

    def test_undo_no_sidecar_503(self, app_client):
        app_client["client"].post("/sessions")
        resp = app_client["client"].post("/sessions/s1/undo")
        assert resp.status_code == 503
        assert "sidecar" in resp.json()["detail"].lower()

    def test_undo_session_not_found_404(self, app_client):
        resp = app_client["client"].post("/sessions/ghost/undo")
        assert resp.status_code == 404


class TestUnconstifySession:
    def test_unconstify(self, app_client, monkeypatch):
        called = {"deleted": False}

        def fake_delete(sid):
            called["deleted"] = True

        monkeypatch.setattr(
            "api.const_session_store.delete_const_session", fake_delete
        )
        resp = app_client["client"].delete("/sessions/s1/const")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert called["deleted"] is True
