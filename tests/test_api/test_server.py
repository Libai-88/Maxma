"""Tests for api/server.py."""

import pytest

from api.cors_config import build_cors_origins
from config.settings import reload_settings


@pytest.fixture(autouse=True)
def _fresh_settings(monkeypatch):
    """每个用例前刷新 Settings 单例，避免端口缓存导致测试互相污染。"""
    monkeypatch.setenv("MAXMA_API_PORT", "8000")
    monkeypatch.setenv("MAXMA_WEB_PORT", "5173")
    reload_settings()


class TestCorsOrigins:
    """Tests for CORS origin configuration."""

    def test_default_cors_origins(self, monkeypatch):
        monkeypatch.delenv("MAXMA_API_PORT", raising=False)
        monkeypatch.delenv("MAXMA_WEB_PORT", raising=False)
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        reload_settings()

        origins = build_cors_origins()
        assert "http://localhost:5173" in origins
        assert "http://127.0.0.1:5173" in origins

    def test_custom_cors_ports(self, monkeypatch):
        monkeypatch.setenv("MAXMA_API_PORT", "9000")
        monkeypatch.setenv("MAXMA_WEB_PORT", "6000")
        monkeypatch.delenv("MAXMA_ENV", raising=False)
        reload_settings()

        origins = build_cors_origins()
        assert "http://localhost:6000" in origins
        assert "http://127.0.0.1:6000" in origins
        assert "http://localhost:8000" not in origins

    def test_production_includes_api_origin(self, monkeypatch):
        monkeypatch.setenv("MAXMA_API_PORT", "9000")
        monkeypatch.setenv("MAXMA_WEB_PORT", "6000")
        monkeypatch.setenv("MAXMA_ENV", "production")
        reload_settings()

        origins = build_cors_origins()
        assert "http://localhost:6000" in origins
        assert "http://localhost:9000" in origins
        assert "tauri://localhost" in origins
