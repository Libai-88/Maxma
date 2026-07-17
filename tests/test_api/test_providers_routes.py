"""Tests for api/routes/providers.py — GET /providers."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.providers import router


def test_list_providers_returns_all():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert "providers" in body
    providers = body["providers"]
    ids = [p["id"] for p in providers]
    # 至少包含核心 provider
    assert "openai" in ids
    assert "anthropic" in ids
    assert "deepseek" in ids
    assert "google" in ids
    assert "openrouter" in ids
    assert "ollama" in ids
    # 每个 provider 必要字段
    for p in providers:
        assert "label" in p
        assert "models" in p
        assert isinstance(p["models"], list)
        assert "context_window" in p
        assert p["context_window"] > 0


def test_list_providers_count_consistent():
    """多次调用应稳定返回相同结构。"""
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    r1 = client.get("/providers").json()["providers"]
    r2 = client.get("/providers").json()["providers"]
    assert len(r1) == len(r2)
