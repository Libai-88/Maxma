"""测试 — api/routes/audit_log.py 审计日志占位路由（全部 404）。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.audit_log import router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


EXPECTED_DETAIL = "Audit log unavailable — OMP replaces audit subsystem"


class TestAuditLogRoutes:
    def test_list_audit_log_returns_404(self, client):
        resp = client.get("/audit-log")
        assert resp.status_code == 404
        assert resp.json()["detail"] == EXPECTED_DETAIL

    def test_list_audit_log_accepts_query_params(self, client):
        # 带各种 query 参数也应返回 404（不报 422）
        resp = client.get(
            "/audit-log",
            params={"limit": 50, "event_type": "tool", "since": "2026-01-01"},
        )
        assert resp.status_code == 404

    def test_list_audit_log_limit_validation_422(self, client):
        # limit=0 违反 ge=1
        resp = client.get("/audit-log", params={"limit": 0})
        assert resp.status_code == 422
        # limit=501 违反 le=500
        resp2 = client.get("/audit-log", params={"limit": 501})
        assert resp2.status_code == 422

    def test_audit_log_stats_returns_404(self, client):
        resp = client.get("/audit-log/stats")
        assert resp.status_code == 404
        assert resp.json()["detail"] == EXPECTED_DETAIL

    def test_clear_audit_log_returns_404(self, client):
        resp = client.post("/audit-log/clear")
        assert resp.status_code == 404
        assert resp.json()["detail"] == EXPECTED_DETAIL

    def test_encrypt_api_keys_returns_404(self, client):
        resp = client.post("/audit-log/encrypt-keys")
        assert resp.status_code == 404
        assert resp.json()["detail"] == EXPECTED_DETAIL

    def test_mcp_audit_summary_returns_404(self, client):
        resp = client.get("/audit-log/mcp-summary")
        assert resp.status_code == 404
        assert resp.json()["detail"] == EXPECTED_DETAIL
