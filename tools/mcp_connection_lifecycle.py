"""Reusable lifecycle controls for MCP transports.

The LangChain MCP adapter owns the concrete transport sessions, so this module
does not implement an OAuth grant flow or a transport protocol itself.  It
provides the narrow lifecycle contracts that a credential store and transport
adapter can opt into: proactive token refresh, bounded reconnect, observable
state, and telemetry-safe identifiers.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal, TypeVar
from urllib.parse import urlsplit, urlunsplit

ConnectionStatus = Literal["ok", "degraded", "error"]
T = TypeVar("T")

_URL_PATTERN = re.compile(r"(?:https?|wss?)://[^\s'\"<>]+", re.IGNORECASE)
_SECRET_PATTERN = re.compile(
    r"(?i)(authorization|access_token|refresh_token|id_token|token|bearer)"
    r"([:=\s]+)(?:bearer\s+)?([^\s,;]+)"
)


@dataclass(frozen=True)
class MCPOAuthCredential:
    """A token expiry snapshot supplied by a credential integration.

    The token itself is intentionally not represented here.  A refresher
    should update its protected credential store and return a new expiry.
    """

    expires_at: float


@dataclass(frozen=True)
class MCPConnectionState:
    """Safe, serializable connection state for one configured MCP server."""

    status: ConnectionStatus
    reason_code: str | None = None
    retry_at: float | None = None
    attempts: int = 0


OAuthRefresher = Callable[[str, MCPOAuthCredential], Awaitable[MCPOAuthCredential]]


def redact_mcp_identifier(value: str, kind: Literal["server", "tool"] = "server") -> str:
    """Return a stable non-reversible label for MCP telemetry.

    Configuration APIs still use the original server ID so users can edit
    their own configuration.  Logs, audit summaries, and error diagnostics
    use this label instead and therefore cannot disclose service names.
    """
    digest = hashlib.blake2s(value.encode("utf-8"), digest_size=6).hexdigest()
    return f"mcp-{kind}-{digest}"


def _redact_url_query(match: re.Match[str]) -> str:
    raw_url = match.group(0)
    try:
        parts = urlsplit(raw_url)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except ValueError:
        return "[MCP_URL]"


def redact_mcp_telemetry(
    value: Any,
    *,
    server_id: str | None = None,
    tool_name: str | None = None,
    max_length: int = 500,
) -> str:
    """Remove MCP identifiers, URL queries, and common credential fragments."""
    try:
        safe = str(value)
    except Exception:
        safe = "<unrepresentable>"

    safe = _URL_PATTERN.sub(_redact_url_query, safe)
    safe = _SECRET_PATTERN.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", safe)
    if tool_name:
        safe = safe.replace(tool_name, redact_mcp_identifier(tool_name, "tool"))
    if server_id:
        safe = safe.replace(server_id, redact_mcp_identifier(server_id, "server"))
    return safe[:max_length]


class MCPConnectionLifecycle:
    """Coordinates retry and OAuth refresh without retaining sensitive tokens."""

    def __init__(
        self,
        *,
        refresh_leeway_seconds: float = 60.0,
        max_reconnect_attempts: int = 3,
        reconnect_base_delay_seconds: float = 0.5,
        reconnect_max_delay_seconds: float = 8.0,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        random_source: Callable[[], float] = random.random,
    ) -> None:
        self.refresh_leeway_seconds = refresh_leeway_seconds
        self.max_reconnect_attempts = max_reconnect_attempts
        self.reconnect_base_delay_seconds = reconnect_base_delay_seconds
        self.reconnect_max_delay_seconds = reconnect_max_delay_seconds
        self._clock = clock
        self._sleep = sleep
        self._random = random_source
        self._refresh_locks: dict[str, asyncio.Lock] = {}
        self._refreshed_expiries: dict[str, float] = {}
        self._states: dict[str, MCPConnectionState] = {}

    def get_state(self, server_id: str) -> MCPConnectionState:
        """Return the current safe state, defaulting to an unattempted healthy state."""
        return self._states.get(server_id, MCPConnectionState(status="ok"))

    def get_states(self) -> dict[str, MCPConnectionState]:
        """Return a snapshot keyed by configured server ID for local UI use."""
        return dict(self._states)

    def clear(self) -> None:
        """Forget lifecycle state during application shutdown or test cleanup."""
        self._states.clear()
        self._refresh_locks.clear()
        self._refreshed_expiries.clear()

    def mark_error(self, server_id: str, reason_code: str) -> None:
        """Record a safe configuration or credential error supplied by an integration."""
        self._set_state(server_id, "error", reason_code=reason_code)

    def _set_state(
        self,
        server_id: str,
        status: ConnectionStatus,
        *,
        reason_code: str | None = None,
        retry_at: float | None = None,
        attempts: int = 0,
    ) -> None:
        self._states[server_id] = MCPConnectionState(
            status=status,
            reason_code=reason_code,
            retry_at=retry_at,
            attempts=attempts,
        )

    def _refresh_lock(self, server_id: str) -> asyncio.Lock:
        lock = self._refresh_locks.get(server_id)
        if lock is None:
            lock = asyncio.Lock()
            self._refresh_locks[server_id] = lock
        return lock

    async def refresh_if_due(
        self,
        server_id: str,
        credential: MCPOAuthCredential,
        refresher: OAuthRefresher | None,
    ) -> bool:
        """Refresh a credential once when it expires within the safety window.

        Returns whether a refresh occurred.  A missing refresher is a clear
        configuration error only when a supplied credential is already due.
        """
        known_expiry = max(credential.expires_at, self._refreshed_expiries.get(server_id, 0.0))
        if known_expiry - self._clock() > self.refresh_leeway_seconds:
            return False

        async with self._refresh_lock(server_id):
            known_expiry = max(credential.expires_at, self._refreshed_expiries.get(server_id, 0.0))
            if known_expiry - self._clock() > self.refresh_leeway_seconds:
                return False
            if refresher is None:
                self._set_state(
                    server_id,
                    "error",
                    reason_code="oauth_refresh_not_configured",
                )
                return False
            try:
                refreshed = await refresher(server_id, credential)
            except asyncio.CancelledError:
                self._set_state(server_id, "degraded", reason_code="oauth_refresh_cancelled")
                raise
            except Exception:
                self._set_state(server_id, "error", reason_code="oauth_refresh_failed")
                return False
            self._refreshed_expiries[server_id] = refreshed.expires_at
            self._set_state(server_id, "ok")
            return True

    def _reconnect_delay(self, attempt: int) -> float:
        """Capped exponential backoff with bounded positive jitter."""
        base = min(
            self.reconnect_max_delay_seconds,
            self.reconnect_base_delay_seconds * (2 ** max(0, attempt - 1)),
        )
        return min(self.reconnect_max_delay_seconds, base * (1.0 + self._random() * 0.25))

    async def reconnect(
        self,
        server_id: str,
        operation: Callable[[], Awaitable[T]],
    ) -> T:
        """Run a reconnectable operation with bounded retry and cancellation safety."""
        last_error: Exception | None = None
        for attempt in range(1, max(1, self.max_reconnect_attempts) + 1):
            try:
                result = await operation()
            except asyncio.CancelledError:
                self._set_state(server_id, "degraded", reason_code="reconnect_cancelled", attempts=attempt)
                raise
            except Exception as exc:
                last_error = exc
                if attempt >= max(1, self.max_reconnect_attempts):
                    self._set_state(server_id, "error", reason_code="reconnect_exhausted", attempts=attempt)
                    raise
                delay = self._reconnect_delay(attempt)
                self._set_state(
                    server_id,
                    "degraded",
                    reason_code="reconnect_scheduled",
                    retry_at=self._clock() + delay,
                    attempts=attempt,
                )
                await self._sleep(delay)
            else:
                self._set_state(server_id, "ok", attempts=attempt - 1)
                return result
        assert last_error is not None  # Defensive: loop either returns or raises.
        raise last_error
