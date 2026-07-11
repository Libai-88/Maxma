"""Contracts for the opt-in, authenticated Scout schedule API."""
from __future__ import annotations

from fastapi import FastAPI
from starlette.testclient import TestClient

from agent.autonomy.governance import AutonomyScheduleStore
from api.middleware.auth import AuthMiddleware
from api.routes import autonomy


def _headers() -> dict[str, str]:
    return {"X-Maxma-Token": "test-token"}


def _payload(**overrides):
    data = {
        "goal": "Inspect recent project health",
        "interval_seconds": 60,
        "provider_id": "local-provider",
        "model_name": "small-model",
        "allowed_tools": ["kb_search", "file_write"],
        "max_runs": 2,
        "max_seconds": 60,
    }
    data.update(overrides)
    return data


def _client(monkeypatch, tmp_path) -> TestClient:
    monkeypatch.setattr(autonomy, "_autonomy_enabled", lambda: True)
    app = FastAPI()
    app.include_router(autonomy.router, prefix="/api")
    app.add_middleware(AuthMiddleware)
    app.state.auth_token = "test-token"
    app.state.autonomy_schedule_store = AutonomyScheduleStore(tmp_path / "schedules.json")
    return TestClient(app)


def test_schedule_api_is_default_off(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(autonomy, "_autonomy_enabled", lambda: False)

    assert client.get("/api/autonomy/schedules", headers=_headers()).status_code == 404


def test_create_is_authenticated_frozen_and_read_only(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    denied = client.post("/api/autonomy/schedules", json=_payload())
    assert denied.status_code == 401

    response = client.post("/api/autonomy/schedules", headers=_headers(), json=_payload())
    assert response.status_code == 200
    schedule = response.json()
    assert schedule["role"] == "scout"
    assert schedule["permission_mode"] == "read_only"
    assert schedule["allowed_tools"] == ["kb_search"]
    assert schedule["provider_id"] == "local-provider"
    assert "lease" not in response.text

    unknown = client.post(
        "/api/autonomy/schedules", headers=_headers(),
        json=_payload(injected_action="shell_exec"),
    )
    assert unknown.status_code == 422


def test_pause_resume_delete_and_budget_are_user_controlled(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)
    created = client.post("/api/autonomy/schedules", headers=_headers(), json=_payload()).json()
    schedule_id = created["schedule_id"]

    assert client.post(f"/api/autonomy/schedules/{schedule_id}/pause", headers=_headers()).json()["status"] == "paused"
    assert client.post(f"/api/autonomy/schedules/{schedule_id}/resume", headers=_headers()).json()["status"] == "active"
    assert client.delete(f"/api/autonomy/schedules/{schedule_id}", headers=_headers()).json()["status"] == "deleted"
    assert client.get(f"/api/autonomy/schedules/{schedule_id}", headers=_headers()).status_code == 404
