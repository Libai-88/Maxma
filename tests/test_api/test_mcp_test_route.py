"""Tests for POST /api/mcp/test-connection endpoint."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.routes.mcp_test import router


@pytest.fixture
async def client():
    """最小化 FastAPI app + AsyncClient，避免 create_app 的重量级 lifespan。"""
    app = FastAPI()
    app.include_router(router)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class TestTestConnection:
    @pytest.mark.asyncio
    async def test_returns_400_on_empty_command(self, client):
        """空命令返回 400。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "",
            "args": [],
            "env": {},
        })
        assert resp.status_code == 400
        data = resp.json()
        assert "命令" in data["detail"]

    @pytest.mark.asyncio
    async def test_returns_400_on_non_whitelisted_command(self, client):
        """非白名单命令返回 400。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "malicious_command",
            "args": [],
            "env": {},
        })
        assert resp.status_code == 400
        data = resp.json()
        assert "白名单" in data["detail"] or "whitelist" in data["detail"].lower()

    @pytest.mark.asyncio
    async def test_returns_200_on_valid_command(self, client):
        """有效命令(如 node --version)返回 200 + success=True。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "node",
            "args": ["--version"],
            "env": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "success" in data
        assert "resolved_command" in data
        assert "error" in data

    @pytest.mark.asyncio
    async def test_returns_200_on_failed_startup(self, client):
        """命令启动失败(如 python 未知参数)返回 200 + success=False。"""
        resp = await client.post("/api/mcp/test-connection", json={
            "command": "python",
            "args": ["--nonexistent-flag-xyz"],
            "env": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert data["error"] is not None
