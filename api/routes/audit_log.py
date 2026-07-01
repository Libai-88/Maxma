"""API 路由 — 审计日志查看与管理。"""

from fastapi import APIRouter, Query

from agent.audit_log import read_log, get_stats, clear_log

router = APIRouter()


@router.get("/audit-log")
def list_audit_log(
    limit: int = Query(100, ge=1, le=500),
    event_type: str = Query("", description="按事件类型过滤"),
    since: str = Query("", description="时间过滤 (ISO 格式)"),
):
    records = read_log(limit=limit, event_type=event_type, since=since)
    return {"records": records}


@router.get("/audit-log/stats")
def audit_log_stats():
    return {"stats": get_stats()}


@router.post("/audit-log/clear")
def clear_audit_log():
    deleted = clear_log()
    return {"status": "ok", "deleted": deleted}


@router.post("/audit-log/encrypt-keys")
def encrypt_api_keys():
    from app_paths import PROVIDERS_YAML_PATH
    from tools.crypto import encrypt_providers_yaml
    count = encrypt_providers_yaml(PROVIDERS_YAML_PATH)
    return {"status": "ok", "encrypted": count}
