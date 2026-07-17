"""测试 — api/routes/metrics.py 指标查询路由。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.metrics import Metrics
from api.routes.metrics import router


@pytest.fixture
def client():
    Metrics().reset()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestMetricsRoutes:
    def test_get_metrics_snapshot(self, client):
        # 记录一些数据
        m = Metrics()
        m.record_request("GET", "/x", 200, 10.0)
        m.record_tool_call("tool_a", latency_ms=5.0)

        resp = client.get("/metrics")
        assert resp.status_code == 200
        body = resp.json()
        assert "uptime_seconds" in body
        assert body["http"]["total_requests"] == 1
        assert body["tools"]["total_calls"] == 1

    def test_get_metrics_snapshot_empty(self, client):
        resp = client.get("/metrics")
        assert resp.status_code == 200
        body = resp.json()
        assert body["http"]["total_requests"] == 0

    def test_get_metrics_history(self, client, tmp_path, monkeypatch):
        # 注入隔离的 DB 以便 get_history 可用
        from api.db.metrics import MetricsDbStore

        store = MetricsDbStore(tmp_path / "m.db")
        Metrics()._db = store
        m = Metrics()
        m.record_request("GET", "/h", 200, 1.0)
        m.persist_snapshot()

        resp = client.get("/metrics/history", params={"window": 3600})
        assert resp.status_code == 200
        body = resp.json()
        assert body["window_seconds"] == 3600
        assert isinstance(body["snapshots"], list)
        assert len(body["snapshots"]) >= 1
        # 清理 DB 引用
        Metrics()._db = None
        Metrics().reset()

    def test_get_metrics_history_invalid_window_422(self, client):
        # window=0 违反 ge=1
        resp = client.get("/metrics/history", params={"window": 0})
        assert resp.status_code == 422
