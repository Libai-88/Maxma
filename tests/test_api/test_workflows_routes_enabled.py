"""Tests for api/routes/workflows.py — enabled-path routes with fake runtime."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import workflows as wf_mod
from api.routes.workflows import (
    _WorkflowDisabled,
    _get_parent_run,
    _public_cancel_reason,
    _public_run,
    _public_step,
    _require_parent_session,
    _require_runtime,
    router,
)


class _FakeStep:
    def __init__(self, step_id="s1", position=0, status="succeeded",
                 attempts=1, checkpoint={"data": "ok"}):
        self.step_id = step_id
        self.position = position
        self.status = status
        self.attempts = attempts
        self.checkpoint = checkpoint


class _FakeRun:
    def __init__(self, run_id="r1", parent_turn_id="t1", workflow_id="wf-1",
                 workflow_version=1, status="succeeded", current_step_id="s1",
                 failure_code=None, cancel_reason=None, created_at="c",
                 updated_at="u", parent_session_id="sess1"):
        self.run_id = run_id
        self.parent_turn_id = parent_turn_id
        self.workflow_id = workflow_id
        self.workflow_version = workflow_version
        self.status = status
        self.current_step_id = current_step_id
        self.failure_code = failure_code
        self.cancel_reason = cancel_reason
        self.created_at = created_at
        self.updated_at = updated_at
        self.parent_session_id = parent_session_id


class _FakeStore:
    def __init__(self, runs, steps):
        self._runs = runs
        self._steps = steps

    def get(self, run_id):
        return self._runs.get(run_id)

    def list_parent_runs(self, session_id, limit=50):
        return [r for r in self._runs.values()
                if r.parent_session_id == session_id][:limit]

    def list_steps(self, run_id):
        return self._steps.get(run_id, [])

    def submit(self, parent_session_id, parent_turn_id, definition):
        run = _FakeRun(parent_session_id=parent_session_id,
                       parent_turn_id=parent_turn_id, status="queued",
                       workflow_id=getattr(definition, "workflow_id", "wf-1"))
        self._runs[run.run_id] = run
        self._steps[run.run_id] = []
        return run


class _FakeDefinition:
    workflow_id = "my-wf"


class _FakeRegistry:
    def list_ids(self):
        return ["my-wf"]

    def require(self, workflow_id):
        if workflow_id != "my-wf":
            raise KeyError(workflow_id)
        return _FakeDefinition()


class _FakeManager:
    def __init__(self, store):
        self.store = store
        self.registry = _FakeRegistry()
        self.cancelled = []
        self.resumed = []
        self.submitted = []

    def submit(self, run):
        self.submitted.append(run)

    async def cancel(self, run_id):
        self.cancelled.append(run_id)
        run = self.store.get(run_id)
        if run is not None:
            run.status = "cancelled"
            run.cancel_reason = "cancelled_by_user"

    def resume(self, run_id):
        self.resumed.append(run_id)
        run = self.store.get(run_id)
        if run is not None:
            run.status = "running"
        return True


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
    monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
    run = _FakeRun(status="queued")
    store = _FakeStore({"r1": run}, {"r1": [_FakeStep()]})
    manager = _FakeManager(store)
    app = FastAPI()
    app.state.workflow_run_manager = manager
    app.state.session_manager = _FakeSessionManager({"sess1": object()})
    app.include_router(router)
    return TestClient(app), manager, store


class TestRequireRuntimeHelpers:
    def test_workflow_disabled_default_detail(self):
        exc = _WorkflowDisabled()
        assert exc.status_code == 404
        assert exc.detail == "工作流功能未启用"

    def test_require_runtime_disabled_raises(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: False)
        app = FastAPI()
        with pytest.raises(_WorkflowDisabled):
            _require_runtime(_make_request(app))

    def test_require_runtime_no_manager_raises_503(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        app = FastAPI()
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
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        app = FastAPI()
        store = _FakeStore({}, {})
        app.state.workflow_run_manager = _FakeManager(store)
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(_make_request(app), "sess1", "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_parent_run_wrong_session(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        app = FastAPI()
        run = _FakeRun(parent_session_id="other")
        store = _FakeStore({"r1": run}, {})
        app.state.workflow_run_manager = _FakeManager(store)
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(_make_request(app), "sess1", "r1")
        assert exc_info.value.status_code == 404


class TestEnabledRoutes:
    def test_list_definitions(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/workflows/definitions")
        assert resp.status_code == 200
        assert resp.json() == {"workflow_ids": ["my-wf"]}

    def test_start_workflow_success(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post(
            "/sessions/sess1/workflows",
            json={"workflow_id": "my-wf", "parent_turn_id": "t1"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "queued"
        assert body["workflow_id"] == "my-wf"
        assert len(manager.submitted) == 1

    def test_start_workflow_unknown_id_422(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.post(
            "/sessions/sess1/workflows", json={"workflow_id": "nope"}
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == "不支持的工作流"

    def test_start_workflow_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.post(
            "/sessions/ghost/workflows", json={"workflow_id": "my-wf"}
        )
        assert resp.status_code == 404

    def test_list_workflows(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows")
        assert resp.status_code == 200
        runs = resp.json()["runs"]
        assert len(runs) == 1
        assert runs[0]["run_id"] == "r1"

    def test_list_workflows_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/ghost/workflows")
        assert resp.status_code == 404

    def test_get_workflow(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows/r1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"] == "r1"
        assert "steps" in body

    def test_get_workflow_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows/ghost")
        assert resp.status_code == 404

    def test_cancel_queued_workflow(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post("/sessions/sess1/workflows/r1/cancel")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason"] == "cancelled_by_user"
        assert manager.cancelled == ["r1"]

    def test_cancel_already_finished_workflow(self, enabled_app):
        client, manager, store = enabled_app
        # mark run as already finished -> cancel is a no-op
        store._runs["r1"].status = "succeeded"
        resp = client.post("/sessions/sess1/workflows/r1/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "succeeded"
        assert manager.cancelled == []

    def test_resume_failed_workflow(self, enabled_app):
        client, manager, store = enabled_app
        store._runs["r1"].status = "failed"
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"
        assert manager.resumed == ["r1"]

    def test_resume_non_failed_409(self, enabled_app):
        client, _, _ = enabled_app
        # run is "queued", not "failed" -> 409
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 409

    def test_resume_when_manager_returns_false_409(self, enabled_app, monkeypatch):
        client, manager, store = enabled_app
        store._runs["r1"].status = "failed"
        monkeypatch.setattr(manager, "resume", lambda run_id: False)
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 409

    def test_resume_refreshed_none_404(self, enabled_app, monkeypatch):
        client, manager, store = enabled_app
        store._runs["r1"].status = "failed"
        # resume returns True, but store.get returns None afterward
        original_resume = manager.resume

        def resume_then_hide(run_id):
            original_resume(run_id)
            store._runs.clear()
            return True

        monkeypatch.setattr(manager, "resume", resume_then_hide)
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 404


class TestPublicHelpersExtra:
    def test_public_step_running(self):
        s = _FakeStep(status="running")
        assert _public_step(s)["checkpoint"] is None

    def test_public_cancel_reason_non_cancelled(self):
        assert _public_cancel_reason(_FakeRun(status="running")) is None

    def test_public_run_with_steps(self):
        result = _public_run(_FakeRun(), steps=[_FakeStep()])
        assert "steps" in result
        assert len(result["steps"]) == 1
