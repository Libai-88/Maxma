"""Tests for config/settings.py."""

import pytest

from config.settings import Settings, reload_settings


class TestPortSettings:
    """Tests for service port configuration."""

    def test_default_ports(self, monkeypatch):
        monkeypatch.delenv("MAXMA_API_PORT", raising=False)
        monkeypatch.delenv("MAXMA_WEB_PORT", raising=False)
        settings = reload_settings()
        assert settings.maxma_api_port == 8000
        assert settings.maxma_web_port == 5173

    def test_env_ports(self, monkeypatch):
        monkeypatch.setenv("MAXMA_API_PORT", "9000")
        monkeypatch.setenv("MAXMA_WEB_PORT", "6000")
        settings = reload_settings()
        assert settings.maxma_api_port == 9000
        assert settings.maxma_web_port == 6000

    def test_invalid_env_uses_default(self, monkeypatch):
        monkeypatch.setenv("MAXMA_API_PORT", "not-a-number")
        monkeypatch.setenv("MAXMA_WEB_PORT", "also-not")
        with pytest.raises(ValueError):
            reload_settings()


class TestOrchestrationFlags:
    """编排层特性开关测试。"""

    def test_coordinator_flag_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "coordinator_enabled")
        assert s.coordinator_enabled is False

    def test_verifier_flag_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "verifier_enabled")
        assert s.verifier_enabled is False

    def test_verifier_max_retries_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "verifier_max_retries")
        assert s.verifier_max_retries == 2

    def test_delegation_scope_enforced_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "delegation_scope_enforced")
        assert s.delegation_scope_enforced is False
