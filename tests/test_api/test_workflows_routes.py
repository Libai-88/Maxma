"""测试 — api/routes/workflows.py 工作流路由。

覆盖纯辅助函数 _public_run / _public_step / _public_cancel_reason /
_workflow_enabled / _WorkflowDisabled，以及 feature-flag 禁用时的路由行为。
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import workflows as wf_mod
from api.routes.workflows import (
    _public_cancel_reason,
    _public_run,
    _public_step,
    _workflow_enabled,
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
                 updated_at="u"):
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


class TestWorkflowEnabled:
    def test_returns_false_on_exception(self, monkeypatch):
        def boom():
            raise RuntimeError("no settings")
        monkeypatch.setattr("config.settings.get_settings", boom)
        assert _workflow_enabled() is False

    def test_returns_false_when_flag_off(self, monkeypatch):
        class FakeSettings:
            workflow_enabled = False
            async_subagent_enabled = True
            permission_modes_enabled = True
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _workflow_enabled() is False

    def test_returns_true_when_all_flags_on(self, monkeypatch):
        class FakeSettings:
            workflow_enabled = True
            async_subagent_enabled = True
            permission_modes_enabled = True
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _workflow_enabled() is True


class TestPublicStep:
    def test_succeeded_includes_checkpoint(self):
        step = _FakeStep(status="succeeded", checkpoint={"x": 1})
        result = _public_step(step)
        assert result["checkpoint"] == {"x": 1}
        assert result["step_id"] == "s1"

    def test_non_succeeded_hides_checkpoint(self):
        step = _FakeStep(status="running", checkpoint={"x": 1})
        result = _public_step(step)
        assert result["checkpoint"] is None


class TestPublicCancelReason:
    def test_non_cancelled_returns_none(self):
        run = _FakeRun(status="succeeded")
        assert _public_cancel_reason(run) is None

    def test_cancelled_by_user(self):
        run = _FakeRun(status="cancelled", cancel_reason="cancelled_by_user")
        assert _public_cancel_reason(run) == "cancelled_by_user"

    def test_parent_session_closed(self):
        run = _FakeRun(status="cancelled", cancel_reason="parent_session_closed")
        assert _public_cancel_reason(run) == "parent_session_closed"

    def test_unknown_reason_returns_generic(self):
        run = _FakeRun(status="cancelled", cancel_reason="some_internal_detail")
        assert _public_cancel_reason(run) == "cancelled"


class TestPublicRun:
    def test_without_steps(self):
        run = _FakeRun()
        result = _public_run(run)
        assert result["run_id"] == "r1"
        assert result["workflow_id"] == "wf-1"
        assert result["status"] == "succeeded"
        assert "steps" not in result

    def test_with_steps(self):
        run = _FakeRun()
        result = _public_run(run, steps=[_FakeStep()])
        assert "steps" in result
        assert len(result["steps"]) == 1

    def test_cancelled_run_has_cancel_reason(self):
        run = _FakeRun(status="cancelled", cancel_reason="cancelled_by_user")
        result = _public_run(run)
        assert result["cancel_reason"] == "cancelled_by_user"


@pytest.fixture
def app_client(monkeypatch):
    monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: False)
    app = FastAPI()
    app.state.session_manager = None
    app.state.workflow_run_manager = None
    app.include_router(router)
    return TestClient(app)


class TestRoutesDisabled:
    def test_list_definitions_returns_empty(self, app_client):
        resp = app_client.get("/workflows/definitions")
        assert resp.status_code == 200
        assert resp.json() == {"workflow_ids": []}

    def test_start_workflow_404_when_disabled(self, app_client):
        resp = app_client.post(
            "/sessions/s1/workflows",
            json={"workflow_id": "my-wf"},
        )
        assert resp.status_code == 404

    def test_list_workflows_returns_empty(self, app_client):
        resp = app_client.get("/sessions/s1/workflows")
        assert resp.status_code == 200
        assert resp.json() == {"runs": []}

    def test_start_workflow_invalid_id_pattern_422(self, app_client):
        # workflow_id must match ^[a-z][a-z0-9-]{0,63}$
        resp = app_client.post(
            "/sessions/s1/workflows",
            json={"workflow_id": "INVALID"},
        )
        assert resp.status_code == 422

    def test_start_workflow_extra_field_forbidden_422(self, app_client):
        resp = app_client.post(
            "/sessions/s1/workflows",
            json={"workflow_id": "valid-wf", "extra": "nope"},
        )
        assert resp.status_code == 422
