"""Stub — event hooks subsystem removed, replaced by OMP."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/event-hooks")
async def list_hooks():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.get("/event-hooks/{hook_id}")
async def get_hook():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.post("/event-hooks")
async def create_hook():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.put("/event-hooks/{hook_id}")
async def update_hook():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.delete("/event-hooks/{hook_id}")
async def delete_hook():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.get("/event-hooks/history")
async def get_history():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )


@router.post("/event-hooks/{hook_id}/trigger")
async def trigger_webhook():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Event hooks are unavailable — OMP replaces event hooks"},
    )
