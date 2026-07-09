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


class TestRetrievalFlags:
    """检索层特性开关测试。"""

    def test_crag_enabled_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "crag_enabled")
        assert s.crag_enabled is False

    def test_rag_grade_threshold_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "rag_grade_threshold")
        assert s.rag_grade_threshold == 0.3


class TestAutonomyFlags:
    """自治层特性开关测试。"""

    def test_autonomy_enabled_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_enabled")
        assert s.autonomy_enabled is False

    def test_autonomy_interval_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_interval_seconds")
        assert s.autonomy_interval_seconds == 3600

    def test_autonomy_self_improve_defaults_off(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_self_improve_enabled")
        assert s.autonomy_self_improve_enabled is False

    def test_autonomy_max_agent_timeout_default(self):
        from config.settings import get_settings
        s = get_settings()
        assert hasattr(s, "autonomy_max_agent_timeout")
        assert s.autonomy_max_agent_timeout == 300
