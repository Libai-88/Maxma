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


# ═══════════════════════════════════════════════════════════════════════
# Step C: GET / PUT / DELETE /providers/{id}
# ═══════════════════════════════════════════════════════════════════════


def _seed_provider(yaml_path, provider_id="deepseek", **overrides):
    """写一个 provider 到 yaml，返回该 provider dict。"""
    base = {
        "id": provider_id,
        "provider_type": "openai",
        "label": "DeepSeek",
        "api_key": "sk-seed",
        "base_url": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat"],
        "enabled": True,
        "context_window": 64000,
    }
    base.update(overrides)
    _write_yaml(yaml_path, [base])
    return base


class TestGetProvider:
    def test_get_provider_by_id(self, client, yaml_path):
        """从 yaml 读取指定 id 的 provider。"""
        _seed_provider(yaml_path, "deepseek")
        resp = client.get("/providers/deepseek")
        assert resp.status_code == 200
        result = resp.json()
        assert result["id"] == "deepseek"
        assert result["label"] == "DeepSeek"
        assert result["api_key"] == "sk-seed"

    def test_get_provider_404(self, client, yaml_path):
        """不存在返回 404。"""
        _seed_provider(yaml_path, "deepseek")
        resp = client.get("/providers/ghost")
        assert resp.status_code == 404
        assert "ghost" in resp.json()["detail"]

    def test_get_provider_404_when_yaml_empty(self, client, yaml_path):
        """yaml 为空时 GET /{id} 返回 404（不 fallback 到默认）。"""
        _write_yaml(yaml_path, [])
        resp = client.get("/providers/openai")
        assert resp.status_code == 404


class TestUpdateProvider:
    def test_update_provider_partial(self, client, yaml_path):
        """部分更新：只改提供的字段，保留其他字段。"""
        _seed_provider(yaml_path, "deepseek", api_key="sk-old", label="OldLabel")
        resp = client.put(
            "/providers/deepseek",
            json={"api_key": "sk-new", "enabled": False},
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["api_key"] == "sk-new"  # 已更新
        assert result["enabled"] is False  # 已更新
        assert result["label"] == "OldLabel"  # 保留未提供字段
        assert result["id"] == "deepseek"  # id 不可改
        # 持久化
        from api.yaml_store import load_yaml

        persisted = load_yaml(yaml_path, default={})["providers"][0]
        assert persisted["api_key"] == "sk-new"
        assert persisted["label"] == "OldLabel"

    def test_update_provider_404(self, client, yaml_path):
        """更新不存在的 provider 返回 404。"""
        _seed_provider(yaml_path, "deepseek")
        resp = client.put("/providers/ghost", json={"label": "Ghost"})
        assert resp.status_code == 404

    def test_update_provider_id_ignored(self, client, yaml_path):
        """请求体中带 id 字段不应改变 provider id。"""
        _seed_provider(yaml_path, "deepseek")
        # ProviderUpdateBody 没有 id 字段，会被 Pydantic 忽略（默认 ignore extra）
        resp = client.put(
            "/providers/deepseek",
            json={"label": "New", "id": "hacked"},
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == "deepseek"  # id 未被改变


class TestDeleteProvider:
    def test_delete_provider_success(self, client, yaml_path):
        """删除 provider：返回 {status: ok}，yaml 中移除。"""
        _seed_provider(yaml_path, "deepseek")
        _seed_provider(yaml_path, "openai", label="OpenAI")  # 注意会覆盖
        # 重新写两个
        _write_yaml(
            yaml_path,
            [
                {"id": "deepseek", "provider_type": "openai", "label": "DeepSeek",
                 "api_key": "k1", "base_url": "u1", "models": [], "enabled": True},
                {"id": "openai", "provider_type": "openai", "label": "OpenAI",
                 "api_key": "k2", "base_url": "u2", "models": [], "enabled": True},
            ],
        )
        resp = client.delete("/providers/deepseek")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        # yaml 中已移除 deepseek
        remaining = client.get("/providers").json()["providers"]
        ids = [p["id"] for p in remaining]
        assert "deepseek" not in ids
        assert "openai" in ids

    def test_delete_provider_404(self, client, yaml_path):
        """删除不存在的 provider 返回 404。"""
        _seed_provider(yaml_path, "deepseek")
        resp = client.delete("/providers/ghost")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════
# Step D: POST /providers/test + /providers/discover-models
# ═══════════════════════════════════════════════════════════════════════


def _patch_http(monkeypatch, handler):
    """注入 httpx.MockTransport 到 providers 模块，模拟 /models 响应。

    handler: 接收 httpx.Request，返回 httpx.Response；或抛异常模拟网络错误。
    """
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(providers_mod, "_injectable_transport", transport)
    return transport


class TestTestConnection:
    def test_test_connection_ok(self, client, monkeypatch):
        """200 响应 → status:ok, latency_ms >= 0。"""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"data": [{"id": "m1"}]})

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/test",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert isinstance(body["latency_ms"], int)
        assert body["latency_ms"] >= 0
        assert body["detail"] is None

    def test_test_connection_network_error(self, client, monkeypatch):
        """网络异常 → status:error, latency_ms:null, detail 非空。"""
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/test",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "error"
        assert body["latency_ms"] is None
        assert body["detail"] is not None
        assert "connection refused" in body["detail"]

    def test_test_connection_http_error_status(self, client, monkeypatch):
        """HTTP 4xx/5xx → status:error, detail 含状态码。"""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": "unauthorized"})

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/test",
            json={"api_key": "bad", "base_url": "https://api.example.com/v1"},
        )
        body = resp.json()
        assert body["status"] == "error"
        assert "401" in body["detail"]

    def test_test_connection_appends_models_path(self, client, monkeypatch):
        """请求 URL 应为 {base_url}/models（base_url 末尾斜杠不影响）。"""
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            return httpx.Response(200, json={"data": []})

        _patch_http(monkeypatch, handler)
        client.post(
            "/providers/test",
            json={"api_key": "k", "base_url": "https://api.example.com/v1/"},
        )
        assert captured["url"] == "https://api.example.com/v1/models"


class TestDiscoverModels:
    def test_discover_models_ok(self, client, monkeypatch):
        """200 响应 → 返回 model id 列表。"""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]},
            )

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/discover-models",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"models": ["gpt-4o", "gpt-4o-mini"]}

    def test_discover_models_error_returns_empty(self, client, monkeypatch):
        """异常 → 返回 {models: []}（不报错）。"""
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("timed out")

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/discover-models",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"models": []}

    def test_discover_models_no_data_field(self, client, monkeypatch):
        """响应无 data 字段 → 返回空列表。"""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"object": "list"})

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/discover-models",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.json() == {"models": []}

    def test_discover_models_http_error_returns_empty(self, client, monkeypatch):
        """HTTP 4xx → 返回空列表（不报错）。"""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "server"})

        _patch_http(monkeypatch, handler)
        resp = client.post(
            "/providers/discover-models",
            json={"api_key": "sk-x", "base_url": "https://api.example.com/v1"},
        )
        assert resp.json() == {"models": []}


# ═══════════════════════════════════════════════════════════════════════
# Step E: POST /providers/{id}/test + /providers/{id}/discover-models
# ═══════════════════════════════════════════════════════════════════════


def _seed_full_provider(yaml_path, provider_id="deepseek"):
    """写一个带 api_key 和 base_url 的 provider，供 test/discover 端点使用。"""
    _write_yaml(
        yaml_path,
        [
            {
                "id": provider_id,
                "provider_type": "openai",
                "label": "DeepSeek",
                "api_key": "sk-from-yaml",
                "base_url": "https://api.deepseek.com/v1",
                "models": ["deepseek-chat"],
                "enabled": True,
                "context_window": 64000,
            }
        ],
    )


class TestTestExistingProvider:
    def test_test_existing_provider_uses_yaml_config(self, client, yaml_path, monkeypatch):
        """从 yaml 读取 provider 配置，用其 api_key/base_url 测试连接。"""
        _seed_full_provider(yaml_path, "deepseek")
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["auth"] = request.headers.get("authorization")
            return httpx.Response(200, json={"data": [{"id": "m1"}]})

        _patch_http(monkeypatch, handler)
        resp = client.post("/providers/deepseek/test")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        # 使用了 yaml 中的 base_url
        assert captured["url"] == "https://api.deepseek.com/v1/models"
        # 使用了 yaml 中的 api_key
        assert captured["auth"] == "Bearer sk-from-yaml"

    def test_test_existing_provider_404(self, client, yaml_path):
        """provider 不存在 → 404。"""
        _seed_full_provider(yaml_path, "deepseek")
        resp = client.post("/providers/ghost/test")
        assert resp.status_code == 404
        assert "ghost" in resp.json()["detail"]

    def test_test_existing_provider_network_error(self, client, yaml_path, monkeypatch):
        """网络异常 → status:error。"""
        _seed_full_provider(yaml_path, "deepseek")

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused")

        _patch_http(monkeypatch, handler)
        resp = client.post("/providers/deepseek/test")
        body = resp.json()
        assert body["status"] == "error"
        assert body["latency_ms"] is None


class TestDiscoverModelsForExisting:
    def test_discover_models_for_existing_provider(self, client, yaml_path, monkeypatch):
        """从 yaml 读取配置，发现模型列表。"""
        _seed_full_provider(yaml_path, "deepseek")

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]},
            )

        _patch_http(monkeypatch, handler)
        resp = client.post("/providers/deepseek/discover-models")
        assert resp.status_code == 200
        assert resp.json() == {"models": ["deepseek-chat", "deepseek-reasoner"]}

    def test_discover_models_for_existing_404(self, client, yaml_path):
        """provider 不存在 → 404。"""
        _seed_full_provider(yaml_path, "deepseek")
        resp = client.post("/providers/ghost/discover-models")
        assert resp.status_code == 404

    def test_discover_models_for_existing_error_returns_empty(self, client, yaml_path, monkeypatch):
        """网络异常 → 返回空列表（不报错）。"""
        _seed_full_provider(yaml_path, "deepseek")

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("timed out")

        _patch_http(monkeypatch, handler)
        resp = client.post("/providers/deepseek/discover-models")
        assert resp.status_code == 200
        assert resp.json() == {"models": []}
