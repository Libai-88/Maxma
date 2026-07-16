"""Authenticated, parent-session-scoped access to deferred sub-agent runs."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request


router = APIRouter()


def _async_subagent_enabled() -> bool:
    """Keep the API inert until the opt-in asynchronous path is enabled."""
    try:
        from config.settings import get_settings

        return bool(getattr(get_settings(), "async_subagent_enabled", False))
    except Exception:
        return False


def _require_runtime(request: Request):
    if not _async_subagent_enabled():
        # Do not expose a partially deployed feature through its REST surface.
        raise HTTPException(status_code=404, detail="Deferred sub-agent runs are unavailable")
    manager = getattr(request.app.state, "deferred_subagent_run_manager", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="Deferred sub-agent runtime is unavailable")
    return manager


async def _require_parent_session(request: Request, session_id: str) -> None:
    manager = getattr(request.app.state, "session_manager", None)
    if manager is None or await manager.get(session_id) is None:
        # A valid bearer token is necessary but not sufficient: a run must also
        # belong to a live parent session selected by the caller.
        raise HTTPException(status_code=404, detail="Session not found")


async def _get_parent_run(request: Request, session_id: str, run_id: str) -> tuple[Any, Any]:
    await _require_parent_session(request, session_id)
    manager = _require_runtime(request)
    run = manager.store.get(run_id, parent_session_id=session_id)
    if run is None:
        # Keep non-membership indistinguishable from an unknown ID to avoid a
        # session being used to probe another session's work.
        raise HTTPException(status_code=404, detail="Deferred run not found")
    return manager, run


def _public_run(run) -> dict[str, object]:
    """Return the intentionally small browser-facing contract.

    Delegation snapshots can contain local paths, tool scopes and provider
    identity.  The task text and internal error detail may contain user data
    or upstream diagnostics.  None are part of this boundary.
    """
    response: dict[str, object] = {
        "run_id": run.run_id,
        "parent_turn_id": run.parent_turn_id,
        "status": run.status,
        "result_ref": run.result_ref if run.status == "succeeded" else None,
        "result": run.result if run.status == "succeeded" else None,
        "cancel_reason": _public_cancel_reason(run),
        "deadline_at": run.deadline_at,
        "attempts": run.attempts,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }
    if run.status == "failed":
        # Error summaries are deliberately not returned.  They may originate
        # from an upstream provider; the stable status is enough for clients.
        response["error_code"] = "deferred_run_failed"
    return response


def _public_cancel_reason(run) -> str | None:
    if run.status != "cancelled":
        return None
    # Only API-owned reason codes cross this boundary.  Store callers may add
    # diagnostic text to a cancellation reason, which is not browser-safe.
    if run.cancel_reason == "cancelled_by_user":
        return "cancelled_by_user"
    if run.cancel_reason == "parent_session_closed":
        return "parent_session_closed"
    return "cancelled"


@router.get("/sessions/{session_id}/deferred-runs")
async def list_deferred_runs(session_id: str, request: Request, limit: int = 50):
    await _require_parent_session(request, session_id)
    manager = _require_runtime(request)
    bounded_limit = max(1, min(limit, 100))
    runs = manager.store.list_parent_runs(session_id, limit=bounded_limit)
    return {"runs": [_public_run(run) for run in runs]}


@router.get("/sessions/{session_id}/deferred-runs/{run_id}")
async def get_deferred_run(session_id: str, run_id: str, request: Request):
    _, run = await _get_parent_run(request, session_id, run_id)
    return _public_run(run)


@router.post("/sessions/{session_id}/deferred-runs/{run_id}/cancel")
async def cancel_deferred_run(session_id: str, run_id: str, request: Request):
    manager, run = await _get_parent_run(request, session_id, run_id)
    if run.status in {"queued", "running"}:
        await manager.cancel(run_id, "cancelled_by_user")
        run = manager.store.get(run_id, parent_session_id=session_id)
        if run is None:  # Defensive: the durable row must not disappear mid-request.
            raise HTTPException(status_code=404, detail="Deferred run not found")
    return _public_run(run)


@router.get("/sessions/{session_id}/deferred-runs/{run_id}/audit")
async def get_deferred_run_audit(session_id: str, run_id: str, request: Request):
    """Read a run's redacted lifecycle, scoped to its live parent session."""
    _, run = await _get_parent_run(request, session_id, run_id)
    # audit_log module removed — OMP replaces audit
    try:
        from agent.audit_log import read_subagent_run_events
        events = read_subagent_run_events(run.run_id)
    except ImportError:
        events = []
    return {"run_id": run.run_id, "events": events}
