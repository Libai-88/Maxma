"""测试 — api/routes/deferred_runs.py 延迟子代理运行路由。

覆盖纯辅助函数 _public_run / _public_cancel_reason /
_async_subagent_enabled，以及 feature-flag 禁用时的路由行为。
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import deferred_runs as dr_mod
from api.routes.deferred_runs import (
    _async_subagent_enabled,
    _public_cancel_reason,
    _public_run,
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


class TestAsyncSubagentEnabled:
    def test_returns_false_on_exception(self, monkeypatch):
        def boom():
            raise RuntimeError("no settings")
        monkeypatch.setattr("config.settings.get_settings", boom)
        assert _async_subagent_enabled() is False

    def test_returns_false_when_flag_off(self, monkeypatch):
        class FakeSettings:
            async_subagent_enabled = False
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _async_subagent_enabled() is False

    def test_returns_true_when_flag_on(self, monkeypatch):
        class FakeSettings:
            async_subagent_enabled = True
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _async_subagent_enabled() is True


class TestPublicCancelReason:
    def test_non_cancelled_returns_none(self):
        assert _public_cancel_reason(_FakeRun(status="succeeded")) is None

    def test_cancelled_by_user(self):
        run = _FakeRun(status="cancelled", cancel_reason="cancelled_by_user")
        assert _public_cancel_reason(run) == "cancelled_by_user"

    def test_parent_session_closed(self):
        run = _FakeRun(status="cancelled", cancel_reason="parent_session_closed")
        assert _public_cancel_reason(run) == "parent_session_closed"

    def test_unknown_reason(self):
        run = _FakeRun(status="cancelled", cancel_reason="timeout_detail")
        assert _public_cancel_reason(run) == "cancelled"


class TestPublicRun:
    def test_succeeded_includes_result(self):
        run = _FakeRun(status="succeeded", result_ref="ref1", result="done")
        result = _public_run(run)
        assert result["result_ref"] == "ref1"
        assert result["result"] == "done"
        assert "error_code" not in result

    def test_non_succeeded_hides_result(self):
        run = _FakeRun(status="running")
        result = _public_run(run)
        assert result["result_ref"] is None
        assert result["result"] is None

    def test_failed_includes_error_code(self):
        run = _FakeRun(status="failed")
        result = _public_run(run)
        assert result["error_code"] == "deferred_run_failed"

    def test_cancelled_has_cancel_reason(self):
        run = _FakeRun(status="cancelled", cancel_reason="cancelled_by_user")
        result = _public_run(run)
        assert result["cancel_reason"] == "cancelled_by_user"


@pytest.fixture
def app_client(monkeypatch):
    monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: False)
    app = FastAPI()
    app.state.session_manager = None
    app.state.deferred_subagent_run_manager = None
    app.include_router(router)
    return TestClient(app)


class TestRoutesDisabled:
    def test_list_returns_404_when_disabled(self, app_client):
        resp = app_client.get("/sessions/s1/deferred-runs")
        assert resp.status_code == 404

    def test_get_returns_404_when_disabled(self, app_client):
        resp = app_client.get("/sessions/s1/deferred-runs/r1")
        assert resp.status_code == 404

    def test_cancel_returns_404_when_disabled(self, app_client):
        resp = app_client.post("/sessions/s1/deferred-runs/r1/cancel")
        assert resp.status_code == 404

    def test_audit_returns_404_when_disabled(self, app_client):
        resp = app_client.get("/sessions/s1/deferred-runs/r1/audit")
        assert resp.status_code == 404
