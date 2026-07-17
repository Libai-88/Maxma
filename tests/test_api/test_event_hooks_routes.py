"""测试 — api/routes/event_hooks.py Stub 路由。

所有 7 个端点都是 stub，返回 404 + OMP 替代消息。
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import event_hooks


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(event_hooks.router)
    return TestClient(app)


EXPECTED_DETAIL = "Event hooks are unavailable — OMP replaces event hooks"


def test_list_hooks_returns_404():
    with _client() as c:
        resp = c.get("/event-hooks")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_get_hook_returns_404():
    with _client() as c:
        resp = c.get("/event-hooks/h1")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_create_hook_returns_404():
    with _client() as c:
        resp = c.post("/event-hooks")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_update_hook_returns_404():
    with _client() as c:
        resp = c.put("/event-hooks/h1")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_delete_hook_returns_404():
    with _client() as c:
        resp = c.delete("/event-hooks/h1")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_get_history_returns_404():
    with _client() as c:
        resp = c.get("/event-hooks/history")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL


def test_trigger_webhook_returns_404():
    with _client() as c:
        resp = c.post("/event-hooks/h1/trigger")
    assert resp.status_code == 404
    assert resp.json()["detail"] == EXPECTED_DETAIL
