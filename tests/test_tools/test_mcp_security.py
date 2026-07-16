"""Tests for tools/mcp_security.py — stdio 命令白名单 + transport URL 白名单 + TLS 校验。"""

import pytest

try:
    from tools.mcp_security import (
        validate_stdio_command,
        validate_tls_config,
        validate_transport_url,
    )
except ImportError:
    validate_stdio_command = None
    validate_tls_config = None
    validate_transport_url = None


class TestValidateStdioCommand:
    """Tests for validate_stdio_command()."""

    @pytest.mark.parametrize(
        "command",
        ["npx", "node", "python", "python3", "uvx", "NPX", "Python.exe", "uvx.exe"],
    )
    def test_whitelisted_commands_are_valid(self, command):
        assert validate_stdio_command(command) is None

    @pytest.mark.parametrize(
        "command",
        [
            "cmd.exe",
            "powershell",
            "bash",
            "sh",
        ],
    )
    def test_shell_commands_are_whitelisted(self, command):
        """shell 类命令在白名单中，直接通过。"""
        assert validate_stdio_command(command) is None

    @pytest.mark.parametrize(
        "command",
        [
            "curl",
            "wget",
            "rm",
            "del",
            "malicious_command",
        ],
    )
    def test_non_whitelisted_commands_pass_but_warn(self, command, caplog):
        """非白名单命令不阻断（返回 None），但记录 WARNING 日志。"""
        with caplog.at_level("WARNING", logger="tools.mcp_security"):
            result = validate_stdio_command(command)
        assert result is None  # 不阻断
        assert any("不在推荐白名单中" in rec.message for rec in caplog.records)

    @pytest.mark.parametrize(
        "command",
        [
            "./npx",
            "../node",
            "~/python",
            "C:\\Windows\\System32\\cmd.exe",
            "/usr/bin/python3",
            "node/bin/node",
        ],
    )
    def test_paths_are_rejected(self, command):
        result = validate_stdio_command(command)
        assert result is not None
        assert "路径" in result

    def test_empty_command_is_rejected(self):
        assert validate_stdio_command("") is not None
        assert validate_stdio_command(None) is not None
        assert validate_stdio_command("   ") is not None


# ═══════════════════════════════════════════════════════════════════════
# 阶段 4.3：transport URL 白名单 + TLS 校验
# ═══════════════════════════════════════════════════════════════════════


class TestValidateTransportUrlScheme:
    """validate_transport_url — scheme 与 transport 匹配校验。"""

    @pytest.mark.parametrize(
        "url,transport",
        [
            ("http://localhost:8000/sse", "sse"),
            ("https://localhost:8000/sse", "sse"),
            ("http://127.0.0.1:9000/mcp", "streamable_http"),
            ("https://127.0.0.1:9000/mcp", "streamable_http"),
            ("ws://localhost:8000/ws", "websocket"),
            ("wss://localhost:8000/ws", "websocket"),
        ],
    )
    def test_valid_scheme_and_host_passes(self, url, transport):
        assert validate_transport_url(url, transport) is None

    @pytest.mark.parametrize(
        "url,transport",
        [
            # ws/wss 仅 websocket 允许，sse/http 拒绝
            ("ws://localhost:8000/sse", "sse"),
            ("wss://localhost:8000/sse", "sse"),
            ("ws://localhost:8000/mcp", "streamable_http"),
            # http/https 仅 sse/streamable_http 允许，websocket 拒绝
            ("http://localhost:8000/ws", "websocket"),
            ("https://localhost:8000/ws", "websocket"),
            # 未知 scheme
            ("ftp://localhost:8000", "sse"),
            ("file:///etc/passwd", "sse"),
            ("javascript:alert(1)", "sse"),
        ],
    )
    def test_scheme_transport_mismatch_is_rejected(self, url, transport):
        result = validate_transport_url(url, transport)
        assert result is not None
        assert "协议" in result or "transport" in result.lower()

    def test_unsupported_transport_is_rejected(self):
        result = validate_transport_url("http://localhost:8000", "unknown_transport")
        assert result is not None
        assert "不支持的 transport" in result

    def test_empty_url_is_rejected(self):
        assert validate_transport_url("", "sse") is not None
        assert validate_transport_url(None, "sse") is not None
        assert validate_transport_url("   ", "sse") is not None


class TestValidateTransportUrlHost:
    """validate_transport_url — host 白名单与 SSRF 防护。"""

    @pytest.mark.parametrize(
        "host,url_host",
        [
            ("localhost", "localhost"),
            ("127.0.0.1", "127.0.0.1"),
            ("0.0.0.0", "0.0.0.0"),
            ("::1", "[::1]"),  # IPv6 需 brackets
        ],
    )
    def test_default_allowed_hosts_passes(self, host, url_host):
        url = f"http://{url_host}:8000/sse"
        assert validate_transport_url(url, "sse") is None

    @pytest.mark.parametrize(
        "host",
        [
            "169.254.169.254",  # AWS metadata
            "metadata.google.internal",  # GCP metadata
            "metadata.azure.com",  # Azure metadata
            "sub.169.254.169.254",  # 子域绕过尝试
        ],
    )
    def test_metadata_service_hosts_are_blocked(self, host):
        url = f"http://{host}/sse"
        result = validate_transport_url(url, "sse")
        assert result is not None
        assert "禁止" in result or "白名单" in result

    @pytest.mark.parametrize(
        "host",
        [
            "example.com",
            "8.8.8.8",
            "10.0.0.1",
            "192.168.1.1",
            "internal.corp.local",
        ],
    )
    def test_external_hosts_are_blocked(self, host):
        url = f"http://{host}:8000/sse"
        result = validate_transport_url(url, "sse")
        assert result is not None
        assert "白名单" in result

    def test_missing_host_is_rejected(self):
        # scheme 有但 host 为空
        result = validate_transport_url("http:///sse", "sse")
        assert result is not None
        assert "host" in result.lower() or "host" in result


class TestValidateTransportUrlPort:
    """validate_transport_url — 端口白名单（默认不限制）。"""

    def test_default_no_port_restriction(self):
        # 默认 mcp_allowed_url_ports=None，任意端口允许（只要 host 在白名单）
        assert validate_transport_url("http://localhost:1/sse", "sse") is None
        assert validate_transport_url("http://localhost:65535/sse", "sse") is None

    def test_port_whitelist_enforced(self, monkeypatch):
        from tools import mcp_security

        class _FakeSettings:
            mcp_allowed_url_hosts = ["localhost", "127.0.0.1"]
            mcp_allowed_url_ports = [8000, 9000]
            mcp_force_tls = False

        def _fake_get_settings():
            return _FakeSettings()

        monkeypatch.setattr(
            "tools.mcp_security._get_allowed_ports",
            lambda: {8000, 9000},
        )

        # 允许的端口
        assert validate_transport_url("http://localhost:8000/sse", "sse") is None
        assert validate_transport_url("http://localhost:9000/sse", "sse") is None
        # 不允许的端口
        result = validate_transport_url("http://localhost:8888/sse", "sse")
        assert result is not None
        assert "端口" in result

    def test_default_port_for_scheme_is_allowed(self, monkeypatch):
        """未显式指定端口（使用 scheme 默认端口）应通过。"""
        monkeypatch.setattr(
            "tools.mcp_security._get_allowed_ports",
            lambda: {8000, 9000},
        )
        # 无端口（默认 80）— port is None，应通过
        assert validate_transport_url("http://localhost/sse", "sse") is None


class TestValidateTlsConfig:
    """validate_tls_config — 生产模式 TLS 强制校验。"""

    def test_dev_mode_allows_http(self):
        """开发模式（mcp_force_tls=False）下 http/ws 通过。"""
        # 默认 mcp_force_tls=False
        assert validate_tls_config("http://localhost:8000/sse", True) is None
        assert validate_tls_config("ws://localhost:8000/ws", True) is None

    def test_dev_mode_allows_tls_verify_false(self):
        """开发模式允许 tls_verify=False（仅本地调试用）。"""
        assert validate_tls_config("https://localhost:8000/sse", False) is None

    def test_force_tls_rejects_http(self, monkeypatch):
        """生产模式强制 HTTPS。"""
        monkeypatch.setattr("tools.mcp_security._is_force_tls", lambda: True)

        result = validate_tls_config("http://localhost:8000/sse", True)
        assert result is not None
        assert "https" in result

    def test_force_tls_rejects_ws(self, monkeypatch):
        """生产模式强制 WSS。"""
        monkeypatch.setattr("tools.mcp_security._is_force_tls", lambda: True)

        result = validate_tls_config("ws://localhost:8000/ws", True)
        assert result is not None
        assert "wss" in result

    def test_force_tls_allows_https(self, monkeypatch):
        """生产模式 HTTPS 通过。"""
        monkeypatch.setattr("tools.mcp_security._is_force_tls", lambda: True)
        assert validate_tls_config("https://localhost:8000/sse", True) is None

    def test_force_tls_allows_wss(self, monkeypatch):
        """生产模式 WSS 通过。"""
        monkeypatch.setattr("tools.mcp_security._is_force_tls", lambda: True)
        assert validate_tls_config("wss://localhost:8000/ws", True) is None

    def test_force_tls_warns_on_verify_false(self, monkeypatch, caplog):
        """生产模式 tls_verify=False 不报错但记录警告。"""
        monkeypatch.setattr("tools.mcp_security._is_force_tls", lambda: True)

        with caplog.at_level("WARNING", logger="tools.mcp_security"):
            result = validate_tls_config("https://localhost:8000/sse", False)
        assert result is None  # 不报错
        assert any("tls_verify=False" in rec.message for rec in caplog.records)

    def test_empty_url_returns_none(self):
        """空 URL 不报错（由 validate_transport_url 负责非空校验）。"""
        assert validate_tls_config(None, True) is None
        assert validate_tls_config("", True) is None
