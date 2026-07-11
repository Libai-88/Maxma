"""Authenticated, opt-in management API for read-only Scout schedules."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from agent.autonomy.governance import AutonomySchedule, GovernanceError

router = APIRouter()


class ScoutScheduleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=1, max_length=4000)
    interval_seconds: int = Field(ge=60, le=31_536_000)
    provider_id: str = Field(min_length=1, max_length=128)
    model_name: str | None = Field(default=None, max_length=256)
    allowed_tools: set[str] | None = Field(default=None, max_length=32)
    max_runs: int = Field(default=1, ge=1, le=10_000)
    max_tokens: int = Field(default=0, ge=0, le=100_000_000)
    max_seconds: int = Field(default=300, ge=1, le=86_400)


def _autonomy_enabled() -> bool:
    try:
        from config.settings import get_settings

        return bool(get_settings().autonomy_enabled)
    except Exception:
        return False


def _require_store(request: Request):
    if not _autonomy_enabled():
        raise HTTPException(status_code=404, detail="Autonomous Scout schedules are unavailable")
    store = getattr(request.app.state, "autonomy_schedule_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Autonomy runtime is unavailable")
    return store


def _schedule_payload(schedule: AutonomySchedule) -> dict[str, object]:
    # The goal belongs to the authenticated local user and is needed to manage
    # their schedule.  It is deliberately never copied into audit events.
    return {
        "schedule_id": schedule.schedule_id,
        "goal": schedule.goal,
        "role": schedule.role,
        "interval_seconds": schedule.interval_seconds,
        "status": schedule.status,
        "provider_id": schedule.scope.provider_id,
        "model_name": schedule.scope.model_name,
        "permission_mode": schedule.scope.permission_mode,
        "allowed_tools": list(schedule.scope.allowed_tools),
        "max_runs": schedule.scope.max_runs,
        "max_tokens": schedule.scope.max_tokens,
        "max_seconds": schedule.scope.max_seconds,
        "runs_started": schedule.runs_started,
        "tokens_used": schedule.tokens_used,
        "seconds_used": schedule.seconds_used,
        "next_run_at": schedule.next_run_at,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def _require_schedule(store, schedule_id: str) -> AutonomySchedule:
    schedule = store.get(schedule_id)
    if schedule is None or schedule.status == "deleted":
        raise HTTPException(status_code=404, detail="Autonomy schedule not found")
    return schedule


@router.get("/autonomy/schedules")
def list_schedules(request: Request):
    store = _require_store(request)
    return {"schedules": [_schedule_payload(item) for item in store.list()]}


@router.post("/autonomy/schedules")
def create_scout_schedule(body: ScoutScheduleCreate, request: Request):
    store = _require_store(request)
    try:
        schedule = store.create_scout(
            goal=body.goal,
            interval_seconds=body.interval_seconds,
            requested_mode="read_only",
            requested_tools=body.allowed_tools,
            provider_id=body.provider_id,
            model_name=body.model_name,
            max_runs=body.max_runs,
            max_tokens=body.max_tokens,
            max_seconds=body.max_seconds,
        )
    except GovernanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return _schedule_payload(schedule)


@router.get("/autonomy/schedules/{schedule_id}")
def get_schedule(schedule_id: str, request: Request):
    store = _require_store(request)
    return _schedule_payload(_require_schedule(store, schedule_id))


@router.post("/autonomy/schedules/{schedule_id}/pause")
def pause_schedule(schedule_id: str, request: Request):
    store = _require_store(request)
    _require_schedule(store, schedule_id)
    try:
        return _schedule_payload(store.pause(schedule_id))
    except GovernanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post("/autonomy/schedules/{schedule_id}/resume")
def resume_schedule(schedule_id: str, request: Request):
    store = _require_store(request)
    _require_schedule(store, schedule_id)
    try:
        return _schedule_payload(store.resume(schedule_id))
    except GovernanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.delete("/autonomy/schedules/{schedule_id}")
def delete_schedule(schedule_id: str, request: Request):
    store = _require_store(request)
    _require_schedule(store, schedule_id)
    try:
        schedule = store.delete(schedule_id)
    except GovernanceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"status": "deleted", "schedule_id": schedule.schedule_id}
