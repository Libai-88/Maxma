"""Tests for api/routes/deferred_runs.py — enabled-path routes + audit fallback."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import deferred_runs as dr_mod
from api.routes.deferred_runs import (
    _async_subagent_enabled,
    _get_parent_run,
    _public_cancel_reason,
    _public_run,
    _require_parent_session,
    _require_runtime,
    router,
)


class _FakeRun:
    def __init__(self, run_id="r1", parent_turn_id="t1", status="succeeded",
                 result_ref=None, result=None, cancel_reason=None,
                 deadline_at=None, attempts=1, created_at="c", updated_at="u"):
        self.run_id = run_id
        self.parent_turn_id = parent_turn_id
        self.status = status
        self.result_ref = result_ref
        self.result = result
        self.cancel_reason = cancel_reason
        self.deadline_at = deadline_at
        self.attempts = attempts
        self.created_at = created_at
        self.updated_at = updated_at


class _FakeStore:
    def __init__(self, runs):
        self._runs = runs  # dict run_id -> run

    def get(self, run_id, parent_session_id=None):
        return self._runs.get(run_id)

    def list_parent_runs(self, session_id, limit=50):
        return list(self._runs.values())[:limit]


class _FakeManager:
    def __init__(self, store):
        self.store = store
        self.cancelled = []

    async def cancel(self, run_id, reason):
        self.cancelled.append((run_id, reason))
        run = self.store.get(run_id)
        if run is not None:
            run.status = "cancelled"
            run.cancel_reason = reason


class _FakeSessionManager:
    def __init__(self, valid_sessions):
        self._valid = valid_sessions

    async def get(self, session_id):
        return self._valid.get(session_id)


def _make_request(app):
    from starlette.requests import Request
    scope = {"type": "http", "app": app}
    return Request(scope)


@pytest.fixture
def enabled_app(monkeypatch):
    monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
    run = _FakeRun(status="queued")
    store = _FakeStore({"r1": run})
    manager = _FakeManager(store)
    app = FastAPI()
    app.state.deferred_subagent_run_manager = manager
    app.state.session_manager = _FakeSessionManager({"sess1": object()})
    app.include_router(router)
    return TestClient(app), manager, store


class TestRequireRuntimeHelpers:
    def test_require_runtime_disabled_raises_404(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: False)
        app = FastAPI()
        with pytest.raises(Exception) as exc_info:
            _require_runtime(_make_request(app))
        assert exc_info.value.status_code == 404

    def test_require_runtime_no_manager_503(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
        app = FastAPI()
        app.state.deferred_subagent_run_manager = None
        with pytest.raises(Exception) as exc_info:
            _require_runtime(_make_request(app))
        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_require_parent_session_not_found(self):
        app = FastAPI()
        app.state.session_manager = _FakeSessionManager({})
        with pytest.raises(Exception) as exc_info:
            await _require_parent_session(_make_request(app), "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_require_parent_session_no_manager(self):
        app = FastAPI()
        app.state.session_manager = None
        with pytest.raises(Exception) as exc_info:
            await _require_parent_session(_make_request(app), "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_parent_run_not_found(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
        app = FastAPI()
        store = _FakeStore({})
        app.state.deferred_subagent_run_manager = _FakeManager(store)
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(_make_request(app), "sess1", "ghost")
        assert exc_info.value.status_code == 404


class TestEnabledRoutes:
    def test_list_runs(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs")
        assert resp.status_code == 200
        runs = resp.json()["runs"]
        assert len(runs) == 1
        assert runs[0]["run_id"] == "r1"

    def test_list_runs_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/ghost/deferred-runs")
        assert resp.status_code == 404

    def test_list_runs_limit_clamped_high(self, enabled_app):
        client, _, _ = enabled_app
        # limit above 100 clamped to 100
        resp = client.get("/sessions/sess1/deferred-runs?limit=9999")
        assert resp.status_code == 200

    def test_list_runs_limit_clamped_low(self, enabled_app):
        client, _, _ = enabled_app
        # limit below 1 clamped to 1
        resp = client.get("/sessions/sess1/deferred-runs?limit=0")
        assert resp.status_code == 200

    def test_get_run(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/r1")
        assert resp.status_code == 200
        assert resp.json()["run_id"] == "r1"

    def test_get_run_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/ghost")
        assert resp.status_code == 404

    def test_cancel_queued_run(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason"] == "cancelled_by_user"
        assert manager.cancelled == [("r1", "cancelled_by_user")]

    def test_cancel_already_finished_run(self, enabled_app):
        client, manager, store = enabled_app
        store._runs["r1"].status = "succeeded"
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "succeeded"
        assert manager.cancelled == []

    def test_cancel_run_disappears_mid_request(self, enabled_app):
        client, manager, store = enabled_app
        # Simulate cancel causing the run to vanish from store
        async def cancel_and_remove(run_id, reason):
            manager.cancelled.append((run_id, reason))
            store._runs.pop(run_id, None)

        manager.cancel = cancel_and_remove
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 404

    def test_get_audit(self, enabled_app):
        client, _, _ = enabled_app
        # audit_log 模块已随 LangGraph 移除，审计由 OMP sidecar 接管；
        # 端点保留以兼容前端调用，事件列表恒为空。
        resp = client.get("/sessions/sess1/deferred-runs/r1/audit")
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"] == "r1"
        assert body["events"] == []

    def test_get_audit_run_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/ghost/audit")
        assert resp.status_code == 404

    def test_get_run_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/ghost/deferred-runs/r1")
        assert resp.status_code == 404


class TestPublicHelpersExtra:
    def test_public_run_failed(self):
        run = _FakeRun(status="failed")
        assert _public_run(run)["error_code"] == "deferred_run_failed"

    def test_public_run_succeeded_hides_error_code(self):
        run = _FakeRun(status="succeeded")
        assert "error_code" not in _public_run(run)

    def test_public_cancel_reason_parent_closed(self):
        run = _FakeRun(status="cancelled", cancel_reason="parent_session_closed")
        assert _public_cancel_reason(run) == "parent_session_closed"

    def test_async_subagent_enabled_default(self):
        # Without monkeypatch, real settings path; just ensure it returns a bool
        assert isinstance(_async_subagent_enabled(), bool)
