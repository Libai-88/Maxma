"""Stub — autonomy subsystem removed, replaced by OMP."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/autonomy/schedules")
async def list_schedules():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )


@router.post("/autonomy/schedules")
async def create_scout_schedule():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )


@router.get("/autonomy/schedules/{schedule_id}")
async def get_schedule():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )


@router.post("/autonomy/schedules/{schedule_id}/pause")
async def pause_schedule():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )


@router.post("/autonomy/schedules/{schedule_id}/resume")
async def resume_schedule():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )


@router.delete("/autonomy/schedules/{schedule_id}")
async def delete_schedule():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"},
    )
