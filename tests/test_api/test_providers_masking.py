"""Provider API 凭据掩码集成测试。

验证 GET /api/providers 返回的凭据字段经过统一掩码层处理，
不再是明文，包含 *** 标记。
"""
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware
from api.providers import ProviderConfig
from api.routes import providers as providers_router


@pytest.fixture
def client():
    """创建带 providers 路由的最小测试 app。"""
    app = FastAPI()
    app.include_router(providers_router.router, prefix="/api")
    app.add_middleware(AuthMiddleware)

    app.state.auth_token = "test-token"
    app.state.provider_manager = MagicMock()
    # get_health_status 返回 None → 走 unknown 分支，无需 mock provider 运行时
    app.state.provider_manager.get_health_status.return_value = None

    return TestClient(app)


def test_list_providers_masks_api_key(client):
    """GET /api/providers 返回的 api_key 被统一掩码层替换为 ***。"""
    config = ProviderConfig(
        id="test-1",
        provider_type="openai",
        label="Test",
        api_key="sk-1234567890abcdef",
        base_url="https://api.test.com/v1",
        models=["test-model"],
        enabled=True,
    )
    client.app.state.provider_manager.list_configs = MagicMock(return_value=[config])

    response = client.get(
        "/api/providers",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "providers" in data
    providers = data["providers"]
    assert len(providers) > 0

    # api_key 应被掩码（不再是明文）
    assert providers[0]["api_key"] != "sk-1234567890abcdef"
    assert "***" in str(providers[0]["api_key"])


def test_get_provider_masks_api_key(client):
    """GET /api/providers/{id} 返回的 api_key 同样被掩码。"""
    config = ProviderConfig(
        id="test-2",
        provider_type="openai",
        label="Test Single",
        api_key="sk-secret-key-987654",
        base_url="https://api.test.com/v1",
        models=["test-model"],
        enabled=True,
    )
    client.app.state.provider_manager.get_config = MagicMock(return_value=config)

    response = client.get(
        "/api/providers/test-2",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    provider = response.json()
    assert provider["api_key"] != "sk-secret-key-987654"
    assert "***" in str(provider["api_key"])


def test_list_providers_empty(client):
    """无 provider 时返回空列表。"""
    client.app.state.provider_manager.list_configs = MagicMock(return_value=[])

    response = client.get(
        "/api/providers",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"providers": []}
