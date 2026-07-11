"""Focused contracts for MCP OAuth lifecycle, reconnect, and telemetry safety."""

import asyncio

import pytest

from tools.mcp_connection_lifecycle import (
    MCPOAuthCredential,
    MCPConnectionLifecycle,
    redact_mcp_identifier,
    redact_mcp_telemetry,
)


class TestOAuthRefresh:
    @pytest.mark.asyncio
    async def test_due_credential_refreshes_once_for_concurrent_callers(self):
        calls = 0

        async def refresh(server_id, credential):
            nonlocal calls
            assert server_id == "private-service"
            assert credential.expires_at == 159
            calls += 1
            await asyncio.sleep(0)
            return MCPOAuthCredential(expires_at=500)

        lifecycle = MCPConnectionLifecycle(clock=lambda: 100)
        credential = MCPOAuthCredential(expires_at=159)
        refreshed = await asyncio.gather(
            lifecycle.refresh_if_due("private-service", credential, refresh),
            lifecycle.refresh_if_due("private-service", credential, refresh),
        )

        assert refreshed == [True, False]
        assert calls == 1
        assert lifecycle.get_state("private-service").status == "ok"

    @pytest.mark.asyncio
    async def test_far_from_expiry_does_not_refresh(self):
        async def unexpected_refresh(*_args):
            raise AssertionError("refresh should not run")

        lifecycle = MCPConnectionLifecycle(clock=lambda: 100)
        assert not await lifecycle.refresh_if_due(
            "service", MCPOAuthCredential(expires_at=161), unexpected_refresh
        )

    @pytest.mark.asyncio
    async def test_due_credential_without_refresher_is_configuration_diagnostic(self):
        lifecycle = MCPConnectionLifecycle(clock=lambda: 100)
        refreshed = await lifecycle.refresh_if_due(
            "service", MCPOAuthCredential(expires_at=150), None
        )

        assert refreshed is False
        state = lifecycle.get_state("service")
        assert state.status == "error"
        assert state.reason_code == "oauth_refresh_not_configured"

    @pytest.mark.asyncio
    async def test_registered_unrefreshable_credential_blocks_mcp_server_load(self, monkeypatch):
        from tools import mcp

        async def credential_provider(_server_id):
            return MCPOAuthCredential(expires_at=100)

        lifecycle = MCPConnectionLifecycle(clock=lambda: 100)
        monkeypatch.setattr(mcp, "_connection_lifecycle", lifecycle)
        monkeypatch.setattr(mcp, "_oauth_credential_provider", credential_provider)
        monkeypatch.setattr(mcp, "_oauth_refresher", None)

        assert not await mcp._refresh_oauth_if_configured("service")
        assert lifecycle.get_state("service").reason_code == "oauth_refresh_not_configured"


class TestReconnect:
    @pytest.mark.asyncio
    async def test_reconnect_uses_bounded_backoff_then_recovers(self):
        calls = 0
        delays = []

        async def sleep(delay):
            delays.append(delay)

        async def connect():
            nonlocal calls
            calls += 1
            if calls < 3:
                raise ConnectionError("temporary disconnect")
            return "connected"

        lifecycle = MCPConnectionLifecycle(
            max_reconnect_attempts=3,
            reconnect_base_delay_seconds=0.5,
            reconnect_max_delay_seconds=1,
            random_source=lambda: 0,
            clock=lambda: 10,
            sleep=sleep,
        )
        assert await lifecycle.reconnect("service", connect) == "connected"
        assert calls == 3
        assert delays == [0.5, 1]
        state = lifecycle.get_state("service")
        assert state.status == "ok"
        assert state.attempts == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize("transport", ["stdio", "streamable_http", "websocket"])
    async def test_reconnect_contract_applies_to_each_transport(self, transport):
        attempts = 0

        async def connect():
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ConnectionError(f"{transport} disconnected")
            return transport

        lifecycle = MCPConnectionLifecycle(
            max_reconnect_attempts=2,
            random_source=lambda: 0,
            sleep=lambda _delay: asyncio.sleep(0),
        )
        assert await lifecycle.reconnect(f"{transport}-service", connect) == transport
        assert attempts == 2

    @pytest.mark.asyncio
    async def test_reconnect_exhaustion_is_capped(self):
        calls = 0

        async def connect():
            nonlocal calls
            calls += 1
            raise ConnectionError("unavailable")

        lifecycle = MCPConnectionLifecycle(
            max_reconnect_attempts=2,
            random_source=lambda: 0,
            sleep=lambda _delay: asyncio.sleep(0),
        )
        with pytest.raises(ConnectionError):
            await lifecycle.reconnect("service", connect)
        assert calls == 2
        state = lifecycle.get_state("service")
        assert state.status == "error"
        assert state.reason_code == "reconnect_exhausted"

    @pytest.mark.asyncio
    async def test_cancellation_stops_reconnect_without_sleeping(self):
        slept = False

        async def sleep(_delay):
            nonlocal slept
            slept = True

        async def connect():
            raise asyncio.CancelledError()

        lifecycle = MCPConnectionLifecycle(sleep=sleep)
        with pytest.raises(asyncio.CancelledError):
            await lifecycle.reconnect("service", connect)
        assert slept is False
        assert lifecycle.get_state("service").reason_code == "reconnect_cancelled"


class TestTelemetryRedaction:
    def test_telemetry_uses_stable_anonymous_identifiers(self):
        assert redact_mcp_identifier("github-private", "server") == redact_mcp_identifier(
            "github-private", "server"
        )
        assert "github-private" not in redact_mcp_identifier("github-private", "server")

    def test_telemetry_removes_tokens_url_queries_and_mcp_names(self):
        server_id = "github-private"
        tool_name = "github-private_search_secrets"
        raw = (
            f"{server_id}/{tool_name} failed at "
            "https://example.test/mcp?access_token=super-secret&trace=private "
            "Authorization: Bearer another-secret"
        )

        safe = redact_mcp_telemetry(raw, server_id=server_id, tool_name=tool_name)
        assert server_id not in safe
        assert tool_name not in safe
        assert "super-secret" not in safe
        assert "another-secret" not in safe
        assert "?access_token" not in safe
        assert "mcp-server-" in safe
        assert "mcp-tool-" in safe
