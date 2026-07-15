"""WS Event Mapper — validates and enriches sidecar events for Maxma WS protocol.

The TS sidecar (session-bridge.ts) already maps Pi events to Maxma WS format.
This module only:
1. Validates that events match the known schema
2. Enriches events with additional context (turn_id, etc.)
3. Documents the full event types for the bridge protocol
"""

from collections.abc import Mapping
from typing import Any

# ── Known Event Types ────────────────────────────────────
# These match both the TS sidecar output and the Maxma frontend WS protocol.

EVENT_TYPES = frozenset({
    "thinking_start",
    "token",
    "thinking_end",
    "tool_start",
    "tool_end",
    "tool_error",
    "answer",
    "done",
    "error",
    "context_usage",
})

# ── Event Schema Check ───────────────────────────────────

def validate_event(event: Mapping[str, Any]) -> bool:
    """Check that an event has the minimum required structure.

    Returns False if the event is malformed, True otherwise.
    Does NOT raise exceptions — just logs warnings.
    """
    import logging
    logger = logging.getLogger(__name__)

    if not isinstance(event, Mapping):
        logger.warning("Event is not a dict: %r", type(event))
        return False

    event_type = event.get("type")
    if not isinstance(event_type, str) or event_type not in EVENT_TYPES:
        logger.warning("Unknown or missing event type: %r", event_type)
        return False

    payload = event.get("payload")
    if not isinstance(payload, Mapping):
        logger.warning("Event %r missing payload", event_type)
        return False

    return True


# ── Event Enrichment ─────────────────────────────────────

def enrich_event(event: dict[str, Any], *, turn_id: str | None = None) -> dict[str, Any]:
    """Add optional context to an event before sending to the frontend.

    Args:
        event: The event dict (modified in place and returned).
        turn_id: Current turn ID to attach to 'done' events.

    Returns:
        The enriched event dict (same object, modified in place).
    """
    event_type = event.get("type", "")

    if event_type == "done" and turn_id:
        if "payload" not in event:
            event["payload"] = {}
        if isinstance(event["payload"], dict):
            event["payload"]["turn_id"] = turn_id

    return event


# ── Event Creation Helpers ───────────────────────────────

def make_done_event(turn_id: str | None = None) -> dict[str, Any]:
    """Create a properly formatted 'done' event."""
    payload: dict[str, Any] = {}
    if turn_id:
        payload["turn_id"] = turn_id
    return {"type": "done", "payload": payload}


def make_error_event(
    message: str,
    code: str = "AGENT_ERROR",
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Create a properly formatted 'error' event."""
    payload: dict[str, Any] = {"code": code, "message": message}
    if trace_id:
        payload["trace_id"] = trace_id
    return {"type": "error", "payload": payload}


def make_context_usage_event(usage: dict[str, Any]) -> dict[str, Any]:
    """Create a properly formatted 'context_usage' event."""
    return {"type": "context_usage", "payload": usage}
