"""API 路由 — 审计日志查看与管理（已移除，由 OMP 替代）。"""

from fastapi import APIRouter, Query

router = APIRouter()

# audit_log module removed — OMP replaces audit subsystem.
# All endpoints return 404 with a descriptive message.


@router.get("/audit-log")
def list_audit_log(
    limit: int = Query(100, ge=1, le=500),
    event_type: str = Query("", description="按事件类型过滤"),
    since: str = Query("", description="时间过滤 (ISO 格式)"),
):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Audit log unavailable — OMP replaces audit subsystem"},
    )


@router.get("/audit-log/stats")
def audit_log_stats():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Audit log unavailable — OMP replaces audit subsystem"},
    )


@router.post("/audit-log/clear")
def clear_audit_log():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Audit log unavailable — OMP replaces audit subsystem"},
    )


@router.post("/audit-log/encrypt-keys")
def encrypt_api_keys():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Audit log unavailable — OMP replaces audit subsystem"},
    )


@router.get("/audit-log/mcp-summary")
def mcp_audit_summary():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=404,
        content={"detail": "Audit log unavailable — OMP replaces audit subsystem"},
    )
