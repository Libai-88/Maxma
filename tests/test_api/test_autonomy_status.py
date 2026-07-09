"""自治调度器状态 REST 端点测试。"""

import pytest
from unittest.mock import patch

from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """创建测试客户端。

    使用 create_app() 以验证路由确实注册在 api/server.py 中。
    由于不进入 TestClient 上下文管理器，lifespan 不会执行——
    手动设置 auth_token 以通过 AuthMiddleware。
    """
    from api.server import create_app
    app = create_app()
    app.state.auth_token = "test-token"
    return TestClient(app)


class TestAutonomyStatusEndpoint:
    """GET /api/autonomy/status 端点测试。"""

    def test_get_status_returns_200(self, client):
        """GET /api/autonomy/status 返回 200。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get(
                "/api/autonomy/status",
                headers={"X-Maxma-Token": "test-token"},
            )
            assert response.status_code == 200

    def test_status_contains_required_fields(self, client):
        """状态包含 running/last_tick_at/tick_count 字段。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get(
                "/api/autonomy/status",
                headers={"X-Maxma-Token": "test-token"},
            )
            data = response.json()
            assert "running" in data
            assert "last_tick_at" in data
            assert "tick_count" in data

    def test_status_when_stopped(self, client):
        """调度器未启动时 running=False。"""
        with patch("agent.autonomy.scheduler._scheduler_task", None):
            response = client.get(
                "/api/autonomy/status",
                headers={"X-Maxma-Token": "test-token"},
            )
            data = response.json()
            assert data["running"] is False
            assert data["last_tick_at"] is None
