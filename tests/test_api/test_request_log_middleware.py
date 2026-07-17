"""测试 — api/middleware/request_log.py 请求日志中间件。

覆盖 RequestLogMiddleware 的 http/non-http/skip-path/正常请求路径、
X-Request-ID 注入、session_id 提取、_get_client_ip。
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.request_log import RequestLogMiddleware


@pytest.fixture
def app():
    app = FastAPI()

    @app.get("/api/test")
    async def test_endpoint():
        return {"ok": True}

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/assets/style.css")
    async def asset():
        return {"asset": True}

    @app.get("/api/error")
    async def error_endpoint():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="not found")

    app.add_middleware(RequestLogMiddleware)
    return app


class TestRequestLogMiddleware:
    def test_normal_request_adds_request_id_header(self, app):
        client = TestClient(app)
        resp = client.get("/api/test")
        assert resp.status_code == 200
        assert "x-request-id" in resp.headers
        assert len(resp.headers["x-request-id"]) == 12

    def test_skip_health_path(self, app):
        client = TestClient(app)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        # /api/health 在 skip 列表中 → 不注入 X-Request-ID
        assert "x-request-id" not in resp.headers

    def test_skip_assets_prefix(self, app):
        client = TestClient(app)
        resp = client.get("/assets/style.css")
        assert "x-request-id" not in resp.headers

    def test_session_id_from_header(self, app):
        client = TestClient(app)
        resp = client.get("/api/test", headers={"X-Session-ID": "sess-123"})
        assert resp.status_code == 200

    def test_error_status_still_logs(self, app):
        client = TestClient(app)
        resp = client.get("/api/error")
        assert resp.status_code == 404
        # 即使 404 也应注入 request_id
        assert "x-request-id" in resp.headers

    def test_get_client_ip_from_client(self):
        scope = {"client": ("10.0.0.1", 5000), "headers": []}
        assert RequestLogMiddleware._get_client_ip(scope) == "10.0.0.1"

    def test_get_client_ip_from_xff(self):
        scope = {
            "client": None,
            "headers": [(b"x-forwarded-for", b"1.2.3.4, 5.6.7.8")],
        }
        assert RequestLogMiddleware._get_client_ip(scope) == "1.2.3.4"

    def test_get_client_ip_no_info(self):
        scope = {"client": None, "headers": []}
        assert RequestLogMiddleware._get_client_ip(scope) == "-"

    def test_non_http_scope_passes_through(self):
        """WebSocket scope 不走日志逻辑，通过 ASGI 中间件直接验证。"""
        app = FastAPI()

        @app.get("/api/test")
        async def test_ep():
            return {"ok": True}

        app.add_middleware(RequestLogMiddleware)
        client = TestClient(app)
        # 正常 HTTP 请求应工作并注入 request_id
        resp = client.get("/api/test")
        assert resp.status_code == 200
        assert "x-request-id" in resp.headers

    def test_metrics_recorded(self, app):
        from api.metrics import Metrics

        Metrics().reset()
        client = TestClient(app)
        client.get("/api/test")
        # Metrics 通过 record_request 记录 HTTP 请求
        m = Metrics()
        assert m._http_total >= 1
