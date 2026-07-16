"""API contracts for parent-session-scoped deferred sub-agent runs."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware
from api.routes import deferred_runs
try:
    from tools.sub_agent.deferred_result_store import DeferredResultStore
    from tools.sub_agent.run_manager import DeferredRunManager
except ImportError:
    DeferredResultStore = None
    DeferredRunManager = None


class _Sessions:
    def __init__(self, *session_ids: str) -> None:
        self._session_ids = set(session_ids)

    async def get(self, session_id: str):
        return SimpleNamespace(session_id=session_id) if session_id in self._session_ids else None


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(deferred_runs, "_async_subagent_enabled", lambda: True)
    app = FastAPI()
    app.include_router(deferred_runs.router, prefix="/api")
    app.add_middleware(AuthMiddleware)
    app.state.auth_token = "test-token"
    app.state.session_manager = _Sessions("parent-a", "parent-b")
    app.state.deferred_subagent_run_manager = DeferredRunManager(
        DeferredResultStore(tmp_path / "runs.sqlite")
    )
    return TestClient(app)


def _submit(client: TestClient, *, parent_session_id: str = "parent-a", task: str = "research"):
    return client.app.state.deferred_subagent_run_manager.store.submit(
        parent_session_id=parent_session_id,
        parent_turn_id="turn-1",
        task=task,
        input_summary="api_key=secret-input-must-not-cross-api-boundary",
        delegation_snapshot={
            "provider_id": "private-provider",
            "allowed_paths": ["C:/private"],
            "api_key": "snapshot-secret-must-not-cross-api-boundary",
        },
        deadline_at=None,
        retryable=True,
    )


def _headers() -> dict[str, str]:
    return {"X-Maxma-Token": "test-token"}


def test_deferred_run_routes_require_authentication(client):
    run = _submit(client)

    response = client.get(f"/api/sessions/parent-a/deferred-runs/{run.run_id}")

    assert response.status_code == 401


def test_get_deferred_run_exposes_only_public_result_contract(client):
    run = _submit(client)
    store = client.app.state.deferred_subagent_run_manager.store
    lease = store.claim(run.run_id)
    assert lease is not None
    assert store.complete(lease, "safe child answer", result_ref=f"deferred:{run.run_id}")

    response = client.get(
        f"/api/sessions/parent-a/deferred-runs/{run.run_id}", headers=_headers()
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["run_id"] == run.run_id
    assert payload["status"] == "succeeded"
    assert payload["result"] == "safe child answer"
    assert payload["result_ref"] == f"deferred:{run.run_id}"
    assert set(payload) == {
        "run_id", "parent_turn_id", "status", "result_ref", "result",
        "cancel_reason", "deadline_at", "attempts", "created_at", "updated_at",
    }
    serialized = response.text
    assert "snapshot-secret-must-not-cross-api-boundary" not in serialized
    assert "secret-input-must-not-cross-api-boundary" not in serialized
    assert "private-provider" not in serialized
    assert "C:/private" not in serialized


def test_run_cannot_be_read_through_another_parent_session(client):
    run = _submit(client, parent_session_id="parent-b")

    response = client.get(
        f"/api/sessions/parent-a/deferred-runs/{run.run_id}", headers=_headers()
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Deferred run not found"


def test_cancel_is_parent_scoped_and_idempotent(client):
    run = _submit(client)
    url = f"/api/sessions/parent-a/deferred-runs/{run.run_id}/cancel"

    first = client.post(url, headers=_headers())
    second = client.post(url, headers=_headers())

    assert first.status_code == 200
    assert first.json()["status"] == "cancelled"
    assert first.json()["cancel_reason"] == "cancelled_by_user"
    assert second.status_code == 200
    assert second.json()["status"] == "cancelled"


def test_run_audit_is_parent_scoped_and_never_returns_task_content(client, monkeypatch, tmp_path):
    from agent import audit_log

    monkeypatch.setattr(audit_log, "AUDIT_LOG_PATH", tmp_path / "audit.jsonl")
    monkeypatch.setattr(audit_log, "LOGS_DIR", tmp_path)
    run = _submit(client, task="private delegated task")
    audit_log.log_subagent_run_event(
        run.run_id, "submitted", parent_session_id="parent-a", parent_turn_id="turn-1"
    )

    response = client.get(
        f"/api/sessions/parent-a/deferred-runs/{run.run_id}/audit", headers=_headers()
    )

    assert response.status_code == 200
    assert response.json()["events"][0]["detail"] == "submitted"
    assert "private delegated task" not in response.text


def test_disabled_feature_does_not_expose_api(monkeypatch, client):
    monkeypatch.setattr(deferred_runs, "_async_subagent_enabled", lambda: False)
    run = _submit(client)

    response = client.get(
        f"/api/sessions/parent-a/deferred-runs/{run.run_id}", headers=_headers()
    )

    assert response.status_code == 404


def test_server_factory_registers_deferred_run_route(monkeypatch, tmp_path):
    """The endpoint must be reachable from the production app factory too."""
    from api.server import create_app

    monkeypatch.setattr(deferred_runs, "_async_subagent_enabled", lambda: True)
    app = create_app()
    app.state.auth_token = "test-token"
    app.state.session_manager = _Sessions("parent-a")
    app.state.deferred_subagent_run_manager = DeferredRunManager(
        DeferredResultStore(tmp_path / "factory-runs.sqlite")
    )
    run = app.state.deferred_subagent_run_manager.store.submit(
        parent_session_id="parent-a",
        parent_turn_id="turn-1",
        task="research",
        input_summary="research",
        delegation_snapshot={},
        deadline_at=None,
        retryable=True,
    )

    response = TestClient(app).get(
        f"/api/sessions/parent-a/deferred-runs/{run.run_id}", headers=_headers()
    )

    assert response.status_code == 200
    assert response.json()["status"] == "queued"
