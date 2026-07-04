"""API 路由 — 审计日志查看与管理。"""

from fastapi import APIRouter, Query

from agent.audit_log import (
    EVENT_MCP_CALL,
    clear_log,
    get_mcp_summary,
    get_stats,
    read_log,
)

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


@router.get("/audit-log/mcp-summary")
def mcp_audit_summary():
    """阶段 4.2：聚合统计每个 server_id+tool_name 的 MCP 调用情况。

    返回 list of dict，每项含 server_id / tool_name / total / ok / error /
    rate_limited / avg_duration_ms / success_rate / last_call_at。
    """
    return {"summary": get_mcp_summary(), "event_type": EVENT_MCP_CALL}
