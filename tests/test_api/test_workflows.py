"""HTTP contracts for parent-scoped, closed-registry workflows."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware
from api.routes import workflows
try:
    from tools.workflow.journal import WorkflowJournalStore
    from tools.workflow.registry import DEFAULT_WORKFLOW_REGISTRY
    from tools.workflow.run_manager import WorkflowRunManager
except ImportError:
    WorkflowJournalStore = None
    DEFAULT_WORKFLOW_REGISTRY = None
    WorkflowRunManager = None


class _Sessions:
    def __init__(self, *ids: str) -> None:
        self.ids = set(ids)

    async def get(self, session_id: str):
        return SimpleNamespace(session_id=session_id) if session_id in self.ids else None


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(workflows, "_workflow_enabled", lambda: True)
    app = FastAPI()
    app.include_router(workflows.router, prefix="/api")
    app.add_middleware(AuthMiddleware)
    app.state.auth_token = "test-token"
    app.state.session_manager = _Sessions("parent-a", "parent-b")
    app.state.workflow_run_manager = WorkflowRunManager(
        WorkflowJournalStore(tmp_path / "workflow.sqlite"), DEFAULT_WORKFLOW_REGISTRY
    )
    return TestClient(app)


def _headers() -> dict[str, str]:
    return {"X-Maxma-Token": "test-token"}


def _start(client: TestClient, *, session_id: str = "parent-a"):
    return client.post(
        f"/api/sessions/{session_id}/workflows",
        headers=_headers(),
        json={"workflow_id": "session-review", "parent_turn_id": "turn-1"},
    )


def test_workflow_route_is_default_off(monkeypatch, client):
    monkeypatch.setattr(workflows, "_workflow_enabled", lambda: False)

    response = client.get("/api/workflows/definitions", headers=_headers())

    assert response.status_code == 404


def test_workflow_routes_require_authentication(client):
    response = client.get("/api/workflows/definitions")

    assert response.status_code == 401


def test_start_accepts_only_registered_workflow_and_exposes_safe_journal(client):
    response = _start(client)

    assert response.status_code == 200
    payload = response.json()
    assert payload["workflow_id"] == "session-review"
    assert payload["status"] in {"queued", "running", "succeeded"}
    assert [step["step_id"] for step in payload["steps"]] == [
        "capture-session-context", "prepare-review",
    ]
    assert "handler" not in response.text
    assert "lease" not in response.text

    arbitrary = client.post(
        "/api/sessions/parent-a/workflows", headers=_headers(),
        json={"workflow_id": "session-review", "steps": [{"shell": "rm -rf"}]},
    )
    assert arbitrary.status_code == 422

    unknown = client.post(
        "/api/sessions/parent-a/workflows", headers=_headers(), json={"workflow_id": "user-code"}
    )
    assert unknown.status_code == 422


def test_workflow_cannot_be_read_or_cancelled_from_another_parent_session(client):
    created = _start(client, session_id="parent-b").json()
    run_id = created["run_id"]

    read = client.get(f"/api/sessions/parent-a/workflows/{run_id}", headers=_headers())
    cancel = client.post(f"/api/sessions/parent-a/workflows/{run_id}/cancel", headers=_headers())

    assert read.status_code == 404
    assert cancel.status_code == 404
