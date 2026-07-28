"""Tests for api/routes/providers.py — GET /providers."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import providers as providers_mod
from api.routes.providers import router


def _patch_yaml_empty(tmp_path: Path, monkeypatch):
    """让 providers 路由使用一个不存在的临时 yaml 路径，触发硬编码 fallback。"""
    monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", tmp_path / "nonexistent.yaml")


def test_list_providers_returns_all(tmp_path, monkeypatch):
    _patch_yaml_empty(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert "providers" in body
    # yaml 不存在时默认 provider fallback 已移除，返回空列表
    # 见 providers.py list_providers 注释
    assert body["providers"] == []


def test_list_providers_count_consistent(tmp_path, monkeypatch):
    """多次调用应稳定返回相同结构。"""
    _patch_yaml_empty(tmp_path, monkeypatch)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    r1 = client.get("/providers").json()["providers"]
    r2 = client.get("/providers").json()["providers"]
    assert len(r1) == len(r2)
