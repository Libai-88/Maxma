"""测试 — api/routes/balance.py DeepSeek 余额查询。

覆盖：
- _find_deepseek_api_key 缺失/存在
- _get_async_client 创建/复用/重建（async, B-005: serialized by _client_lock）
- close_async_client 关闭/幂等
- GET /deepseek-balance 成功/超时/HTTP错误/其他异常
"""

import asyncio

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.routes import balance as balance_mod
from api.routes.balance import router


@pytest.fixture
def app_client(monkeypatch):
    # 重置共享客户端（B-005: lock stays across tests but client is reset）
    monkeypatch.setattr(balance_mod, "_shared_async_client", None)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestFindDeepSeekApiKey:
    def test_missing_key_raises_400(self, monkeypatch):
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        with pytest.raises(HTTPException) as exc:
            balance_mod._find_deepseek_api_key(request=None)
        assert exc.value.status_code == 400
        assert "DeepSeek API key 未配置" in exc.value.detail

    def test_present_key_returned(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test-123")
        assert balance_mod._find_deepseek_api_key(request=None) == "sk-test-123"


class TestGetAsyncClient:
    def test_creates_new_client_when_none(self, monkeypatch):
        monkeypatch.setattr(balance_mod, "_shared_async_client", None)
        c = asyncio.run(balance_mod._get_async_client())
        assert isinstance(c, httpx.AsyncClient)
        assert not c.is_closed
        # 复用同一个实例
        c2 = asyncio.run(balance_mod._get_async_client())
        assert c2 is c
        # 清理
        asyncio.run(c.aclose())

    def test_recreates_when_closed(self, monkeypatch):
        # 预置一个已关闭的客户端
        closed_client = httpx.AsyncClient()
        asyncio.run(closed_client.aclose())
        assert closed_client.is_closed
        monkeypatch.setattr(balance_mod, "_shared_async_client", closed_client)

        new_c = asyncio.run(balance_mod._get_async_client())
        assert new_c is not closed_client
        assert not new_c.is_closed
        asyncio.run(new_c.aclose())


class TestCloseAsyncClient:
    def test_close_none_is_noop(self, monkeypatch):
        monkeypatch.setattr(balance_mod, "_shared_async_client", None)
        # 不应抛异常
        asyncio.run(balance_mod.close_async_client())
        assert balance_mod._shared_async_client is None

    def test_close_open_client(self, monkeypatch):
        c = httpx.AsyncClient()
        monkeypatch.setattr(balance_mod, "_shared_async_client", c)
        asyncio.run(balance_mod.close_async_client())
        assert balance_mod._shared_async_client is None
        assert c.is_closed


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        """模拟 httpx.Response.raise_for_status() — 成功响应时不抛异常。"""
        pass


class _FakeAsyncClient:
    """模拟 httpx.AsyncClient.get。"""

    def __init__(self, *, exc=None, data=None):
        self._exc = exc
        self._data = data
        self.is_closed = False
        self.calls = []

    async def get(self, url, headers=None):
        self.calls.append((url, headers))
        if self._exc is not None:
            raise self._exc
        return _FakeResponse(self._data)


class TestGetDeepseekBalanceRoute:
    def test_no_api_key_returns_400(self, app_client, monkeypatch):
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        resp = app_client.get("/deepseek-balance")
        assert resp.status_code == 400
        assert "DeepSeek API key 未配置" in resp.json()["detail"]

    def test_success_returns_data(self, app_client, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-success")
        fake = _FakeAsyncClient(data={"balance": 100.0})

        async def fake_get():
            return fake

        monkeypatch.setattr(balance_mod, "_get_async_client", fake_get)

        resp = app_client.get("/deepseek-balance")
        assert resp.status_code == 200
        assert resp.json() == {"balance": 100.0}
        # 验证请求 URL 与 Authorization 头
        url, headers = fake.calls[0]
        assert url == balance_mod.DEEPSEEK_BALANCE_URL
        assert headers["Authorization"] == "Bearer sk-success"
        assert headers["Accept"] == "application/json"

    def test_timeout_returns_504(self, app_client, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-timeout")
        fake = _FakeAsyncClient(exc=httpx.TimeoutException("slow"))

        async def fake_get():
            return fake

        monkeypatch.setattr(balance_mod, "_get_async_client", fake_get)

        resp = app_client.get("/deepseek-balance")
        assert resp.status_code == 504
        assert "请求超时" in resp.json()["detail"]

    def test_http_status_error_returns_500(self, app_client, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-status")
        # 构造 HTTPStatusError
        req = httpx.Request("GET", balance_mod.DEEPSEEK_BALANCE_URL)
        resp_obj = httpx.Response(500, request=req)
        exc = httpx.HTTPStatusError("server error", request=req, response=resp_obj)
        fake = _FakeAsyncClient(exc=exc)

        async def fake_get():
            return fake

        monkeypatch.setattr(balance_mod, "_get_async_client", fake_get)

        resp = app_client.get("/deepseek-balance")
        assert resp.status_code == 500
        assert "DeepSeek API 错误" in resp.json()["detail"]

    def test_generic_exception_returns_500(self, app_client, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-boom")
        fake = _FakeAsyncClient(exc=ValueError("boom"))

        async def fake_get():
            return fake

        monkeypatch.setattr(balance_mod, "_get_async_client", fake_get)

        resp = app_client.get("/deepseek-balance")
        assert resp.status_code == 500
        assert "DeepSeek API 错误" in resp.json()["detail"]
