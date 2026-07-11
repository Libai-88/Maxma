"""Authenticated API contract tests for per-session permission modes."""
from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware
from api.routes import sessions


@dataclass
class _Session:
    session_id: str
    permission_mode: str = "ask"
    permission_mode_updated_at: float = 123.0

    def set_permission_mode(self, permission_mode: str) -> str:
        self.permission_mode = permission_mode
        self.permission_mode_updated_at += 1
        return self.permission_mode


class _SessionManager:
    def __init__(self, *sessions_: _Session) -> None:
        self._sessions = {session.session_id: session for session in sessions_}

    async def get(self, session_id: str):
        return self._sessions.get(session_id)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(sessions, "_permission_modes_enabled", lambda: False)
    app = FastAPI()
    app.include_router(sessions.router, prefix="/api")
    app.add_middleware(AuthMiddleware)
    app.state.auth_token = "test-token"
    app.state.session_manager = _SessionManager(_Session("session-a"))
    return TestClient(app)


def _headers() -> dict[str, str]:
    return {"X-Maxma-Token": "test-token"}


def test_permission_mode_routes_require_authentication(client):
    response = client.get("/api/sessions/session-a/permission-mode")

    assert response.status_code == 401


def test_disabled_feature_reports_effective_confirmation_first_mode(client):
    session = client.app.state.session_manager._sessions["session-a"]
    session.permission_mode = "auto"

    response = client.get("/api/sessions/session-a/permission-mode", headers=_headers())

    assert response.status_code == 200
    assert response.json() == {
        "session_id": "session-a",
        "permission_modes_enabled": False,
        "permission_mode": "ask",
        "permission_mode_updated_at": 123.0,
        "available_permission_modes": [],
    }


def test_disabled_feature_rejects_write_without_mutating_session(client):
    response = client.put(
        "/api/sessions/session-a/permission-mode",
        headers=_headers(),
        json={"permission_mode": "auto"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Permission modes are unavailable"
    assert client.app.state.session_manager._sessions["session-a"].permission_mode == "ask"


@pytest.mark.parametrize("permission_mode", ["read_only", "ask", "operate", "auto"])
def test_enabled_feature_accepts_each_supported_permission_mode(monkeypatch, client, permission_mode):
    monkeypatch.setattr(sessions, "_permission_modes_enabled", lambda: True)

    response = client.put(
        "/api/sessions/session-a/permission-mode",
        headers=_headers(),
        json={"permission_mode": permission_mode},
    )

    assert response.status_code == 200
    assert response.json() == {
        "session_id": "session-a",
        "permission_modes_enabled": True,
        "permission_mode": permission_mode,
        "permission_mode_updated_at": 124.0,
        "available_permission_modes": ["read_only", "ask", "operate", "auto"],
    }


def test_enabled_feature_rejects_unknown_permission_mode_without_mutation(monkeypatch, client):
    monkeypatch.setattr(sessions, "_permission_modes_enabled", lambda: True)

    response = client.put(
        "/api/sessions/session-a/permission-mode",
        headers=_headers(),
        json={"permission_mode": "unrestricted"},
    )

    assert response.status_code == 422
    assert client.app.state.session_manager._sessions["session-a"].permission_mode == "ask"


def test_permission_mode_routes_are_session_scoped(client):
    response = client.get("/api/sessions/missing/permission-mode", headers=_headers())

    assert response.status_code == 404
    assert response.json()["detail"] == "Session not found"
