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


class TestStreamRepairFlags:
    """流式修复开关默认关闭；启用路径由 test_stream_repair 覆盖。"""

    def test_stream_repair_enabled_defaults_off(self):
        from config.settings import get_settings

        settings = get_settings()
        assert hasattr(settings, "stream_repair_enabled")
        assert settings.stream_repair_enabled is False


class TestProviderDiagnosticsFlag:
    def test_provider_diagnostics_enabled_defaults_off(self):
        from config.settings import get_settings

        settings = get_settings()
        assert hasattr(settings, "provider_diagnostics_enabled")
        assert settings.provider_diagnostics_enabled is False


class TestMCPConnectionLifecycleFlag:
    """MCP lifecycle remains an opt-in rollout until transport hooks mature."""

    def test_mcp_connection_lifecycle_defaults_off(self, monkeypatch):
        monkeypatch.delenv("MCP_CONNECTION_LIFECYCLE_ENABLED", raising=False)

        settings = Settings(_env_file=None)

        assert settings.mcp_connection_lifecycle_enabled is False

    def test_mcp_connection_lifecycle_reads_explicit_environment_value(self, monkeypatch):
        monkeypatch.setenv("MCP_CONNECTION_LIFECYCLE_ENABLED", "true")

        settings = Settings(_env_file=None)

        assert settings.mcp_connection_lifecycle_enabled is True


class TestAsyncSubagentFlag:
    """Async delegation remains opt-in until the result store is available."""

    def test_async_subagent_enabled_defaults_off(self, monkeypatch):
        monkeypatch.delenv("ASYNC_SUBAGENT_ENABLED", raising=False)

        settings = Settings(_env_file=None)

        assert settings.async_subagent_enabled is False

    def test_async_subagent_enabled_reads_explicit_environment_value(self, monkeypatch):
        monkeypatch.setenv("ASYNC_SUBAGENT_ENABLED", "true")

        settings = Settings(_env_file=None)

        assert settings.async_subagent_enabled is True


class TestPlanOneRolloutFlags:
    def test_plan_one_rollout_flags_default_off(self, monkeypatch):
        for name in (
            "CACHE_PRESERVING_COMPACTION_ENABLED",
            "MEMORY_TICKER_ENABLED",
            "FACT_STORE_RETRIEVAL_ENABLED",
            "COMPACT_TOOL_RESULTS_ENABLED",
            "SUBAGENT_STREAM_ON_DEMAND_ENABLED",
        ):
            monkeypatch.delenv(name, raising=False)

        settings = Settings(_env_file=None)

        # ltm_retry_policy_enabled 现在是安全修复，默认开启
        assert settings.ltm_retry_policy_enabled is True
        assert settings.cache_preserving_compaction_enabled is False
        assert settings.memory_ticker_enabled is False
        assert settings.fact_store_retrieval_enabled is False
        assert settings.compact_tool_results_enabled is False
        assert settings.subagent_stream_on_demand_enabled is False


class TestPermissionModeSettings:
    """Permission modes remain explicitly opt-in and AUTO starts unprivileged."""

    def test_permission_modes_enabled_defaults_off(self, monkeypatch):
        monkeypatch.delenv("PERMISSION_MODES_ENABLED", raising=False)

        settings = Settings(_env_file=None)

        assert settings.permission_modes_enabled is False

    def test_permission_auto_allowed_tools_defaults_to_empty_list(self, monkeypatch):
        monkeypatch.delenv("PERMISSION_AUTO_ALLOWED_TOOLS", raising=False)

        settings = Settings(_env_file=None)

        assert settings.permission_auto_allowed_tools == []

    def test_permission_settings_read_explicit_environment_values(self, monkeypatch):
        monkeypatch.setenv("PERMISSION_MODES_ENABLED", "true")
        monkeypatch.setenv("PERMISSION_AUTO_ALLOWED_TOOLS", '["file_write"]')

        settings = Settings(_env_file=None)

        assert settings.permission_modes_enabled is True
        assert settings.permission_auto_allowed_tools == ["file_write"]
