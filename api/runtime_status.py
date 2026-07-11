"""Shared, safe runtime-status vocabulary for API-facing components.

This module deliberately owns only data contracts and deterministic
normalisation. Retry policy and persistent job handling stay with their
component owners, so introducing the contract changes no scheduling behaviour.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Literal


HealthState = Literal["ok", "degraded", "error"]
JobState = Literal["queued", "running", "succeeded", "failed", "cancelled"]

HEALTH_STATES: frozenset[str] = frozenset({"ok", "degraded", "error"})
JOB_STATES: frozenset[str] = frozenset(
    {"queued", "running", "succeeded", "failed", "cancelled"}
)

_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)(?:api[_ -]?key|authorization|access[_ -]?token|refresh[_ -]?token|"
    r"bearer|token|secret|password|credential)\s*(?:=|:|\s)\s*[^\s,;]+"
)
_SENSITIVE_BEARER = re.compile(r"(?i)(?:authorization\s*:\s*bearer\s+|bearer\s+)\S+")
_SENSITIVE_QUERY = re.compile(
    r"(?i)[?&](?:api[_-]?key|token|secret|password|authorization)=[^\s&#]+"
)


def sanitize_user_detail(value: str | None) -> str | None:
    """Remove credentials and sensitive URL query values from public text."""
    if not value:
        return value
    sanitized = _SENSITIVE_QUERY.sub("?[redacted query]", value)
    sanitized = _SENSITIVE_BEARER.sub("[redacted credential]", sanitized)
    return _SENSITIVE_ASSIGNMENT.sub("[redacted credential]", sanitized)


def reason_code_for(status: HealthState, technical_detail: str | None = None) -> str | None:
    """Map unstable upstream text to a small stable reason-code vocabulary."""
    if status == "ok":
        return None
    detail = (technical_detail or "").lower()
    if any(marker in detail for marker in ("401", "403", "authentication", "permission", "unauthorized", "forbidden")):
        return "authentication_failed"
    if any(marker in detail for marker in ("429", "rate limit", "rate_limit", "too many requests")):
        return "rate_limited"
    if any(
        marker in detail
        for marker in (
            "400",
            "404",
            "413",
            "422",
            "invalid configuration",
            "invalid request",
            "configuration error",
            "base url",
        )
    ):
        return "invalid_configuration"
    if any(marker in detail for marker in ("timeout", "timed out", "deadline")):
        return "request_timed_out"
    if any(marker in detail for marker in ("connection", "network", "dns", "unreachable")):
        return "network_unavailable"
    return "runtime_degraded" if status == "degraded" else "runtime_error"


def user_summary_for(reason_code: str | None) -> str | None:
    """Return a safe summary without exposing upstream implementation details."""
    summaries = {
        "authentication_failed": "Configuration could not be authenticated.",
        "rate_limited": "The upstream service is rate limited.",
        "invalid_configuration": "The provider configuration needs attention.",
        "request_timed_out": "The upstream request timed out.",
        "network_unavailable": "The upstream service is unreachable.",
        "runtime_degraded": "The component is temporarily degraded.",
        "runtime_error": "The component is unavailable.",
    }
    return summaries.get(reason_code)


@dataclass(frozen=True)
class RuntimeStatus:
    """Public status plus non-serialised technical context for component owners."""

    status: HealthState | JobState
    reason_code: str | None = None
    retry_at: float | None = None
    updated_at: float = field(default_factory=time.time)
    summary: str | None = None
    technical_detail: str | None = field(default=None, repr=False)

    @classmethod
    def health(
        cls,
        status: HealthState,
        technical_detail: str | None = None,
        *,
        retry_at: float | None = None,
        updated_at: float | None = None,
    ) -> "RuntimeStatus":
        reason_code = reason_code_for(status, technical_detail)
        return cls(
            status=status,
            reason_code=reason_code,
            retry_at=retry_at,
            updated_at=time.time() if updated_at is None else updated_at,
            summary=user_summary_for(reason_code),
            technical_detail=technical_detail,
        )

    def public_detail(self) -> str | None:
        """Compatibility detail suitable for HTTP responses and browser events."""
        return sanitize_user_detail(self.technical_detail)
