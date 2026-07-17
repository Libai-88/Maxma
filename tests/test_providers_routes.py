"""Tests for api/routes/providers.py — Provider CRUD + test/discover endpoints.

覆盖 9 个端点：
  GET    /providers
  POST   /providers
  GET    /providers/{id}
  PUT    /providers/{id}
  DELETE /providers/{id}
  POST   /providers/test
  POST   /providers/discover-models
  POST   /providers/{id}/test
  POST   /providers/{id}/discover-models

测试通过 monkeypatch 替换模块级 `PROVIDERS_YAML_PATH` 到 tmp_path，
避免污染真实数据目录。
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import providers as providers_mod
from api.routes.providers import router


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture
def yaml_path(tmp_path, monkeypatch):
    """将模块级 PROVIDERS_YAML_PATH 重定向到 tmp_path 下的临时文件。"""
    p = tmp_path / "providers.yaml"
    monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", p)
    return p


@pytest.fixture
def client(yaml_path):
    """挂载 providers router 的 TestClient。依赖 yaml_path fixture 以激活 monkeypatch。"""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _write_yaml(yaml_path, providers):
    """直接写 yaml 文件（绕过 API），用于测试前置数据。"""
    from api.yaml_store import dump_yaml_atomic

    dump_yaml_atomic(yaml_path, {"providers": providers})


# ═══════════════════════════════════════════════════════════════════════
# Step A: GET /providers
# ═══════════════════════════════════════════════════════════════════════


class TestListProviders:
    def test_list_fallback_when_yaml_missing(self, client, yaml_path):
        """yaml 文件不存在时返回硬编码默认列表（向后兼容）。"""
        assert not yaml_path.exists()
        resp = client.get("/providers")
        assert resp.status_code == 200
        providers = resp.json()["providers"]
        ids = [p["id"] for p in providers]
        # 现有测试 test_api/test_providers_routes.py 期望的 6 个核心 provider
        for expected in ("openai", "anthropic", "deepseek", "google", "openrouter", "ollama"):
            assert expected in ids, f"missing default provider: {expected}"
        for p in providers:
            assert "label" in p
            assert "models" in p and isinstance(p["models"], list)
            assert "context_window" in p and p["context_window"] > 0

    def test_list_returns_yaml_data_when_present(self, client, yaml_path):
        """yaml 有数据时返回 yaml 内容，不返回硬编码默认。"""
        _write_yaml(
            yaml_path,
            [
                {
                    "id": "custom",
                    "provider_type": "openai",
                    "label": "Custom",
                    "api_key": "sk-x",
                    "base_url": "https://api.custom.com/v1",
                    "models": ["custom-model"],
                    "enabled": True,
                    "context_window": 8000,
                }
            ],
        )
        resp = client.get("/providers")
        assert resp.status_code == 200
        providers = resp.json()["providers"]
        assert len(providers) == 1
        assert providers[0]["id"] == "custom"
        assert providers[0]["label"] == "Custom"

    def test_list_fallback_when_yaml_empty(self, client, yaml_path):
        """yaml 存在但 providers 为空列表时也 fallback 到硬编码默认（保留现有行为）。

        任务约束：yaml 不存在或 providers 为空均返回硬编码默认列表，保证首次运行
        和清空场景下前端 ChatInput 仍能看到可用 provider。
        """
        _write_yaml(yaml_path, [])
        resp = client.get("/providers")
        assert resp.status_code == 200
        providers = resp.json()["providers"]
        assert len(providers) > 0
        ids = [p["id"] for p in providers]
        assert "openai" in ids  # fallback 生效


# ═══════════════════════════════════════════════════════════════════════
# Step B: POST /providers (create)
# ═══════════════════════════════════════════════════════════════════════


class TestCreateProvider:
    def test_create_provider_success(self, client, yaml_path):
        """创建 provider：返回完整对象，持久化到 yaml。"""
        body = {
            "id": "deepseek",
            "provider_type": "openai",
            "label": "DeepSeek",
            "api_key": "sk-xxx",
            "base_url": "https://api.deepseek.com/v1",
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "enabled": True,
            "context_window": 64000,
        }
        resp = client.post("/providers", json=body)
        assert resp.status_code == 200
        result = resp.json()
        # 返回完整 provider 对象
        assert result["id"] == "deepseek"
        assert result["label"] == "DeepSeek"
        assert result["api_key"] == "sk-xxx"
        assert result["models"] == ["deepseek-chat", "deepseek-reasoner"]
        assert result["enabled"] is True
        # yaml 已持久化
        from api.yaml_store import load_yaml

        persisted = load_yaml(yaml_path, default={})
        assert persisted["providers"][0]["id"] == "deepseek"
        # GET 也能读到
        assert client.get("/providers").json()["providers"][0]["id"] == "deepseek"

    def test_create_provider_defaults(self, client, yaml_path):
        """未传 enabled/provider_type/models 时补默认值。"""
        body = {
            "id": "minimal",
            "label": "Minimal",
            "api_key": "k",
            "base_url": "https://api.minimal.com/v1",
        }
        resp = client.post("/providers", json=body)
        assert resp.status_code == 200
        result = resp.json()
        assert result["enabled"] is True  # 默认 True
        assert result["provider_type"] == "openai"  # 默认 openai
        assert result["models"] == []  # 默认空列表

    def test_create_provider_duplicate_id_409(self, client, yaml_path):
        """id 重复时返回 409。"""
        _write_yaml(
            yaml_path,
            [
                {
                    "id": "dup",
                    "provider_type": "openai",
                    "label": "Dup",
                    "api_key": "k",
                    "base_url": "https://api.dup.com/v1",
                    "models": [],
                    "enabled": True,
                }
            ],
        )
        body = {
            "id": "dup",
            "label": "Dup2",
            "api_key": "k2",
            "base_url": "https://api.dup2.com/v1",
        }
        resp = client.post("/providers", json=body)
        assert resp.status_code == 409
        assert "dup" in resp.json()["detail"]
