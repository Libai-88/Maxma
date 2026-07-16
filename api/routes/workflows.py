"""Authenticated, parent-session-scoped registered workflow API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field



router = APIRouter()


class WorkflowStartRequest(BaseModel):
    """Intentionally narrow request: clients select only a registered ID."""

    model_config = ConfigDict(extra="forbid")
    workflow_id: str = Field(pattern=r"^[a-z][a-z0-9-]{0,63}$")
    parent_turn_id: str | None = Field(default=None, max_length=128)


def _workflow_enabled() -> bool:
    try:
        from config.settings import get_settings

        settings = get_settings()
        return bool(
            getattr(settings, "workflow_enabled", False)
            and getattr(settings, "async_subagent_enabled", False)
            and getattr(settings, "permission_modes_enabled", False)
        )
    except Exception:
        return False


class _WorkflowDisabled(HTTPException):
    def __init__(self):
        super().__init__(status_code=404, detail="Workflows are unavailable")


def _require_runtime(request: Request):
    if not _workflow_enabled():
        raise _WorkflowDisabled()
    manager = getattr(request.app.state, "workflow_run_manager", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="Workflow runtime is unavailable")
    return manager


async def _require_parent_session(request: Request, session_id: str) -> None:
    session_manager = getattr(request.app.state, "session_manager", None)
    if session_manager is None or await session_manager.get(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")


async def _get_parent_run(request: Request, session_id: str, run_id: str):
    await _require_parent_session(request, session_id)
    manager = _require_runtime(request)
    run = manager.store.get(run_id)
    if run is None or run.parent_session_id != session_id:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return manager, run


def _public_step(step: Any) -> dict[str, object]:
    # Checkpoints are structured, bounded, and only emitted after successful
    # writes; handler internals, exception data, and lease data never cross API.
    return {
        "step_id": step.step_id,
        "position": step.position,
        "status": step.status,
        "attempts": step.attempts,
        "checkpoint": step.checkpoint if step.status == "succeeded" else None,
    }


def _public_run(run: Any, steps: list[Any] | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "run_id": run.run_id,
        "parent_turn_id": run.parent_turn_id,
        "workflow_id": run.workflow_id,
        "workflow_version": run.workflow_version,
        "status": run.status,
        "current_step_id": run.current_step_id,
        "failure_code": run.failure_code,
        "cancel_reason": _public_cancel_reason(run),
        "created_at": run.created_at,
        "updated_at": run.updated_at,
    }
    if steps is not None:
        payload["steps"] = [_public_step(step) for step in steps]
    return payload


def _public_cancel_reason(run: Any) -> str | None:
    if run.status != "cancelled":
        return None
    return run.cancel_reason if run.cancel_reason in {
        "cancelled_by_user", "parent_session_closed"
    } else "cancelled"


@router.get("/workflows/definitions")
async def list_workflow_definitions(request: Request):
    if not _workflow_enabled():
        return {"workflow_ids": []}
    manager = _require_runtime(request)
    return {"workflow_ids": list(manager.registry.list_ids())}


@router.post("/sessions/{session_id}/workflows")
async def start_workflow(session_id: str, body: WorkflowStartRequest, request: Request):
    if not _workflow_enabled():
        raise HTTPException(status_code=404, detail="Workflows are unavailable")
    await _require_parent_session(request, session_id)
    manager = _require_runtime(request)
    try:
        definition = manager.registry.require(body.workflow_id)
    except KeyError:
        # Do not disclose future/internal definitions through arbitrary IDs.
        raise HTTPException(status_code=422, detail="Unsupported workflow") from None
    run = manager.store.submit(
        parent_session_id=session_id,
        parent_turn_id=body.parent_turn_id,
        definition=definition,
    )
    manager.submit(run)
    return _public_run(run, manager.store.list_steps(run.run_id))


@router.get("/sessions/{session_id}/workflows")
async def list_workflows(session_id: str, request: Request, limit: int = 50):
    if not _workflow_enabled():
        return {"runs": []}
    await _require_parent_session(request, session_id)
    manager = _require_runtime(request)
    runs = manager.store.list_parent_runs(session_id, limit=limit)
    return {"runs": [_public_run(run) for run in runs]}


@router.get("/sessions/{session_id}/workflows/{run_id}")
async def get_workflow(session_id: str, run_id: str, request: Request):
    manager, run = await _get_parent_run(request, session_id, run_id)
    return _public_run(run, manager.store.list_steps(run.run_id))


@router.post("/sessions/{session_id}/workflows/{run_id}/cancel")
async def cancel_workflow(session_id: str, run_id: str, request: Request):
    manager, run = await _get_parent_run(request, session_id, run_id)
    if run.status in {"queued", "running"}:
        await manager.cancel(run_id)
        run = manager.store.get(run_id)
    return _public_run(run, manager.store.list_steps(run_id))


@router.post("/sessions/{session_id}/workflows/{run_id}/resume")
async def resume_workflow(session_id: str, run_id: str, request: Request):
    manager, run = await _get_parent_run(request, session_id, run_id)
    if run.status != "failed" or not manager.resume(run_id):
        raise HTTPException(status_code=409, detail="Workflow cannot be resumed safely")
    refreshed = manager.store.get(run_id)
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return _public_run(refreshed, manager.store.list_steps(run_id))
