"""Tests for api/services/opencode_zen.py — 内置 OpenCode Zen 免费模型供应商。

覆盖：
- is_free_model 免费模型判定规则
- fetch_free_models 官方拉取 + 免费模型过滤
- ensure_opencode_zen_provider 幂等注入（含 api_key 加密、默认配置）
- sync_opencode_zen_models 模型列表同步（排序、落盘、失败降级）
- _order_models 排序规则（deepseek-v4-flash-free 默认首位）
"""

from __future__ import annotations

import asyncio

import pytest

from api.services import opencode_zen as oz


class TestIsFreeModel:
    def test_free_suffix_models(self):
        assert oz.is_free_model("deepseek-v4-flash-free") is True
        assert oz.is_free_model("mimo-v2.5-free") is True
        assert oz.is_free_model("nemotron-3-ultra-free") is True
        assert oz.is_free_model("north-mini-code-free") is True

    def test_hidden_free_models(self):
        assert oz.is_free_model("big-pickle") is True
        assert oz.is_free_model("hy3-free") is True

    def test_paid_models_rejected(self):
        assert oz.is_free_model("gpt-5.5") is False
        assert oz.is_free_model("deepseek-v4-flash") is False
        assert oz.is_free_model("claude-opus-5") is False
        assert oz.is_free_model("") is False


class TestOrderModels:
    def test_deepseek_first(self):
        ordered = oz._order_models(["big-pickle", "mimo-v2.5-free", "deepseek-v4-flash-free"])
        assert ordered[0] == "deepseek-v4-flash-free"
        assert ordered[1] == "mimo-v2.5-free"
        # 其余按字母序
        assert ordered[2] == "big-pickle"

    def test_order_preserves_all(self):
        models = ["nemotron-3-ultra-free", "deepseek-v4-flash-free", "north-mini-code-free"]
        ordered = oz._order_models(models)
        assert sorted(ordered) == sorted(models)
        assert ordered[0] == "deepseek-v4-flash-free"


class TestBuildProviderEntry:
    def test_default_config(self):
        entry = oz.build_provider_entry()
        assert entry["id"] == "opencode-zen"
        assert entry["provider_type"] == "openai"
        assert entry["base_url"] == "https://opencode.ai/zen/v1"
        assert entry["enabled"] is True
        assert entry["context_window"] == 262144
        assert entry["builtin"] is True
        assert "deepseek-v4-flash-free" in entry["models"]
        # api_key 使用加密信封存储
        assert entry["api_key"].startswith("encv1:")


@pytest.fixture
def provider_yaml_path(tmp_path, monkeypatch):
    """将 providers 路由与 opencode_zen 服务共享的 yaml 路径重定向到临时文件。"""
    p = tmp_path / "providers.yaml"
    from api.routes import providers as providers_mod

    monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", p)
    return p


class TestEnsureProvider:
    def test_injects_when_missing(self, provider_yaml_path):
        p = oz.ensure_opencode_zen_provider()
        assert p is not None
        assert p["id"] == "opencode-zen"
        # 已落盘
        from api.yaml_store import load_yaml

        data = load_yaml(provider_yaml_path, default={})
        assert data["providers"][0]["id"] == "opencode-zen"

    def test_idempotent(self, provider_yaml_path):
        oz.ensure_opencode_zen_provider()
        oz.ensure_opencode_zen_provider()
        from api.yaml_store import load_yaml

        data = load_yaml(provider_yaml_path, default={})
        assert len(data["providers"]) == 1

    def test_keeps_existing(self, provider_yaml_path):
        """已存在 opencode-zen 时原样返回（保留用户修改）。"""
        from api.yaml_store import dump_yaml_atomic

        dump_yaml_atomic(provider_yaml_path, {"providers": [{
            "id": "opencode-zen",
            "provider_type": "openai",
            "label": "我的自定义标签",
            "api_key": "encv1:x",
            "base_url": "https://example.com/v1",
            "models": ["custom-free"],
            "enabled": True,
        }]})
        p = oz.ensure_opencode_zen_provider()
        assert p["label"] == "我的自定义标签"
        assert p["base_url"] == "https://example.com/v1"
        assert p["models"] == ["custom-free"]


class TestFetchFreeModels:
    async def test_filters_to_free_only(self, monkeypatch):
        """从官方 /models 响应中只保留免费模型。"""
        async def fake_get(*args, **kwargs):
            class FakeResp:
                status_code = 200

                def json(self):
                    return {"object": "list", "data": [
                        {"id": "deepseek-v4-flash-free"},
                        {"id": "gpt-5.5"},
                        {"id": "claude-opus-5"},
                        {"id": "big-pickle"},
                        {"id": "mimo-v2.5-free"},
                    ]}
            return FakeResp()

        monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
        models = await oz.fetch_free_models()
        assert models == ["deepseek-v4-flash-free", "big-pickle", "mimo-v2.5-free"]

    async def test_http_error_returns_empty(self, monkeypatch):
        async def fake_get(*args, **kwargs):
            class FakeResp:
                status_code = 500

                def json(self):
                    return {}
            return FakeResp()

        monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
        assert await oz.fetch_free_models() == []

    async def test_network_error_returns_empty(self, monkeypatch):
        async def fake_get(*args, **kwargs):
            raise TimeoutError("timeout")

        monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
        assert await oz.fetch_free_models() == []


class TestSyncModels:
    async def test_sync_updates_yaml(self, provider_yaml_path, monkeypatch):
        oz.ensure_opencode_zen_provider()
        remote = ["mimo-v2.5-free", "deepseek-v4-flash-free", "big-pickle"]

        async def fake_fetch():
            return list(remote)

        monkeypatch.setattr(oz, "fetch_free_models", fake_fetch)
        result = await oz.sync_opencode_zen_models()
        assert result["synced"] is True
        # 排序：deepseek 首位
        assert result["models"][0] == "deepseek-v4-flash-free"
        from api.yaml_store import load_yaml

        data = load_yaml(provider_yaml_path, default={})
        target = data["providers"][0]
        assert target["models"][0] == "deepseek-v4-flash-free"

    async def test_sync_failure_keeps_existing(self, provider_yaml_path, monkeypatch):
        oz.ensure_opencode_zen_provider()

        async def fake_fetch():
            return []

        monkeypatch.setattr(oz, "fetch_free_models", fake_fetch)
        result = await oz.sync_opencode_zen_models()
        assert result["synced"] is False
        # 现有 models 保留（兜底免费模型仍可用）
        assert "deepseek-v4-flash-free" in result["models"]
