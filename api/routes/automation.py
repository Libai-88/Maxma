"""Automation API — 定时任务/自动化调度器。

基于 asyncio 的后台调度器，使用 SQLite 持久化任务配置和执行历史。
调度器每 60 秒检查一次到期任务并记录执行结果。
实际 agent 执行待 sidecar 支持后接入，当前仅跟踪计时和记录运行。
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from api.db.core import transaction

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic Models ──────────────────────────────────────


class ActionPayload(BaseModel):
    type: str = "noop"
    payload: dict[str, Any] = Field(default_factory=dict)


class CreateAutomationRequest(BaseModel):
    name: str
    description: str = ""
    cron_expr: str | None = None
    interval_seconds: int | None = None
    action: ActionPayload = Field(default_factory=ActionPayload)
    enabled: bool = True


class UpdateAutomationRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    cron_expr: str | None = None
    interval_seconds: int | None = None
    action: ActionPayload | None = None
    enabled: bool | None = None


# ── Helpers ──────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_next_run(interval_seconds: int | None, cron_expr: str | None) -> str | None:
    """Compute the next run time based on interval or cron expression.

    For cron_expr, we do a simple approximation: next minute boundary.
    Full cron parsing can be added later with croniter if needed.
    """
    now = datetime.now(timezone.utc)
    if interval_seconds and interval_seconds > 0:
        return (now + timedelta(seconds=interval_seconds)).isoformat()
    if cron_expr:
        # Simple approximation: next minute boundary for cron-based tasks
        next_minute = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        return next_minute.isoformat()
    return None


def _row_to_automation(row) -> dict[str, Any]:
    """Convert a sqlite3.Row to an automation dict with parsed JSON fields."""
    d = dict(row)
    d["enabled"] = bool(d["enabled"])
    try:
        d["action"] = json.loads(d.get("action", "{}"))
    except (json.JSONDecodeError, TypeError):
        d["action"] = {"type": "noop", "payload": {}}
    return d


# ── Database Operations ──────────────────────────────────


def db_get_automation(automation_id: str) -> dict[str, Any] | None:
    with transaction() as db:
        row = db.execute(
            "SELECT * FROM automations WHERE id = ?", (automation_id,)
        ).fetchone()
    if row is None:
        return None
    return _row_to_automation(row)


def db_list_automations() -> list[dict[str, Any]]:
    with transaction() as db:
        rows = db.execute(
            "SELECT * FROM automations ORDER BY created_at DESC"
        ).fetchall()
    return [_row_to_automation(r) for r in rows]


def db_create_automation(data: dict[str, Any]) -> dict[str, Any]:
    with transaction() as db:
        db.execute(
            """INSERT INTO automations
               (id, name, description, cron_expr, interval_seconds, action, enabled, last_run, next_run, run_count, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["id"],
                data["name"],
                data["description"],
                data["cron_expr"],
                data["interval_seconds"],
                json.dumps(data["action"], ensure_ascii=False),
                1 if data["enabled"] else 0,
                data["last_run"],
                data["next_run"],
                data["run_count"],
                data["created_at"],
            ),
        )
    return data


def db_update_automation(automation_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Update specific fields of an automation. Returns updated automation or None."""
    allowed = {"name", "description", "cron_expr", "interval_seconds", "action", "enabled", "next_run", "last_run", "run_count"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return db_get_automation(automation_id)

    set_clauses = []
    params = []
    for key, val in updates.items():
        if key == "action":
            val = json.dumps(val, ensure_ascii=False)
        elif key == "enabled":
            val = 1 if val else 0
        set_clauses.append(f"{key} = ?")
        params.append(val)

    params.append(automation_id)
    with transaction() as db:
        cur = db.execute(
            f"UPDATE automations SET {', '.join(set_clauses)} WHERE id = ?",
            params,
        )
        if cur.rowcount == 0:
            return None
    return db_get_automation(automation_id)


def db_delete_automation(automation_id: str) -> bool:
    with transaction() as db:
        cur = db.execute("DELETE FROM automations WHERE id = ?", (automation_id,))
        return cur.rowcount > 0


def db_record_run(automation_id: str, started_at: str, finished_at: str, status: str, result: str | None) -> int:
    """Record a run in history and update the automation's counters."""
    with transaction() as db:
        cur = db.execute(
            """INSERT INTO automation_run_history (automation_id, started_at, finished_at, status, result)
               VALUES (?, ?, ?, ?, ?)""",
            (automation_id, started_at, finished_at, status, result),
        )
        run_id = cur.lastrowid
        # Update automation counters
        db.execute(
            """UPDATE automations SET last_run = ?, run_count = run_count + 1 WHERE id = ?""",
            (finished_at, automation_id),
        )
    return run_id


def db_get_run_history(automation_id: str, limit: int = 20) -> list[dict[str, Any]]:
    with transaction() as db:
        rows = db.execute(
            """SELECT * FROM automation_run_history
               WHERE automation_id = ?
               ORDER BY started_at DESC
               LIMIT ?""",
            (automation_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def db_get_due_automations(now_iso: str) -> list[dict[str, Any]]:
    """Get all enabled automations whose next_run has passed."""
    with transaction() as db:
        rows = db.execute(
            """SELECT * FROM automations
               WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?""",
            (now_iso,),
        ).fetchall()
    return [_row_to_automation(r) for r in rows]


# ── Background Scheduler ─────────────────────────────────

_scheduler_task: asyncio.Task | None = None
_scheduler_sidecar_mgr: Any | None = None
SCHEDULER_INTERVAL_SECONDS = 60


async def _call_headless(sidecar_mgr: Any, message: str) -> dict:
    """Call sidecar's headless_prompt RPC and return the result."""
    if sidecar_mgr is None:
        return {"answer": "", "status": "sidecar_unavailable"}
    try:
        await sidecar_mgr.start()
        client = sidecar_mgr.get_client()
        if inspect.isawaitable(client):
            client = await client
    except Exception:
        return {"answer": "", "status": "sidecar_unavailable"}
    if client is None:
        return {"answer": "", "status": "sidecar_unavailable"}
    try:
        result = await client.call("headless_prompt", {"message": message})
        return result if isinstance(result, dict) else {"answer": str(result), "status": "completed"}
    except Exception as e:
        return {"answer": "", "status": "error", "error": str(e)}


async def _scheduler_loop():
    """Background loop: check for due tasks every 60s and execute via headless sidecar."""
    global _scheduler_sidecar_mgr
    logger.info("[automation] Scheduler started (interval=%ds)", SCHEDULER_INTERVAL_SECONDS)
    while True:
        try:
            await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)
            now_iso = _now_iso()
            due_tasks = db_get_due_automations(now_iso)

            for task in due_tasks:
                started_at = _now_iso()
                action = task.get("action", {})
                message = ""
                if isinstance(action, dict):
                    message = action.get("payload", {}).get("text", "") if isinstance(action.get("payload"), dict) else str(action)
                else:
                    message = str(action)

                if message:
                    result_data = await _call_headless(_scheduler_sidecar_mgr, message)
                    status = result_data.get("status", "completed")
                    answer = result_data.get("answer", "")
                else:
                    result_data = {"message": "无执行内容"}
                    status = "completed"
                    answer = ""

                finished_at = _now_iso()
                result = json.dumps(
                    {"message": answer or "定时执行完成", "action": task["action"]},
                    ensure_ascii=False,
                )

                db_record_run(task["id"], started_at, finished_at, status, result)

                next_run = _compute_next_run(task["interval_seconds"], task["cron_expr"])
                db_update_automation(task["id"], {"next_run": next_run})

                logger.info(
                    "[automation] Executed task '%s' (%s) -> %s, next_run=%s",
                    task["name"], task["id"], status, next_run,
                )

        except asyncio.CancelledError:
            logger.info("[automation] Scheduler cancelled, shutting down")
            break
        except Exception:
            logger.exception("[automation] Scheduler loop error (will retry next tick)")


def start_scheduler(sidecar_mgr: Any | None = None) -> asyncio.Task:
    """Start the background scheduler task. Called during app lifespan startup."""
    global _scheduler_task, _scheduler_sidecar_mgr
    _scheduler_sidecar_mgr = sidecar_mgr
    if _scheduler_task is None or _scheduler_task.done():
        _scheduler_task = asyncio.create_task(_scheduler_loop(), name="automation-scheduler")
    return _scheduler_task


async def stop_scheduler():
    """Cancel the background scheduler task. Called during app lifespan shutdown."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        logger.info("[automation] Scheduler stopped")
    _scheduler_task = None


# ── API Endpoints ────────────────────────────────────────


@router.get("/automations")
async def list_automations(request: Request):
    """列出所有自动化任务。"""
    automations = db_list_automations()
    return {"automations": automations, "total": len(automations)}


@router.post("/automations", status_code=201)
async def create_automation(body: CreateAutomationRequest, request: Request):
    """创建自动化任务。"""
    if not body.cron_expr and not body.interval_seconds:
        raise HTTPException(
            status_code=422,
            detail="Must provide either cron_expr or interval_seconds",
        )

    automation_id = secrets.token_urlsafe(12)
    now = _now_iso()
    next_run = _compute_next_run(body.interval_seconds, body.cron_expr)

    data = {
        "id": automation_id,
        "name": body.name,
        "description": body.description,
        "cron_expr": body.cron_expr,
        "interval_seconds": body.interval_seconds,
        "action": body.action.model_dump(),
        "enabled": body.enabled,
        "last_run": None,
        "next_run": next_run if body.enabled else None,
        "run_count": 0,
        "created_at": now,
    }

    created = db_create_automation(data)
    logger.info("[automation] Created task '%s' (%s)", body.name, automation_id)
    return created


@router.put("/automations/{automation_id}")
async def update_automation(automation_id: str, body: UpdateAutomationRequest, request: Request):
    """更新自动化任务。"""
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    fields: dict[str, Any] = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.description is not None:
        fields["description"] = body.description
    if body.cron_expr is not None:
        fields["cron_expr"] = body.cron_expr
    if body.interval_seconds is not None:
        fields["interval_seconds"] = body.interval_seconds
    if body.action is not None:
        fields["action"] = body.action.model_dump()
    if body.enabled is not None:
        fields["enabled"] = body.enabled

    # Recompute next_run if schedule or enabled state changed
    schedule_changed = body.cron_expr is not None or body.interval_seconds is not None
    enabled_changed = body.enabled is not None
    if schedule_changed or enabled_changed:
        new_enabled = body.enabled if body.enabled is not None else existing["enabled"]
        new_interval = body.interval_seconds if body.interval_seconds is not None else existing["interval_seconds"]
        new_cron = body.cron_expr if body.cron_expr is not None else existing["cron_expr"]
        if new_enabled:
            fields["next_run"] = _compute_next_run(new_interval, new_cron)
        else:
            fields["next_run"] = None

    updated = db_update_automation(automation_id, fields)
    return updated


@router.delete("/automations/{automation_id}")
async def delete_automation(automation_id: str, request: Request):
    """删除自动化任务。"""
    deleted = db_delete_automation(automation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Automation not found")
    logger.info("[automation] Deleted task %s", automation_id)
    return {"ok": True}


@router.patch("/automations/{automation_id}/toggle")
async def toggle_automation(automation_id: str, request: Request):
    """启用/禁用自动化任务。"""
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    new_enabled = not existing["enabled"]
    fields: dict[str, Any] = {"enabled": new_enabled}

    if new_enabled:
        fields["next_run"] = _compute_next_run(existing["interval_seconds"], existing["cron_expr"])
    else:
        fields["next_run"] = None

    updated = db_update_automation(automation_id, fields)
    logger.info("[automation] Toggled task '%s' to enabled=%s", existing["name"], new_enabled)
    return updated


@router.post("/automations/{automation_id}/run")
async def trigger_run(automation_id: str, request: Request):
    """立即触发一次执行（手动运行 — 通过 sidecar 无头执行）。"""
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    started_at = _now_iso()
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    action = existing.get("action", {})
    message = ""
    if isinstance(action, dict):
        message = action.get("payload", {}).get("text", "") if isinstance(action.get("payload"), dict) else str(action)
    else:
        message = str(action)

    if message and sidecar_mgr:
        result_data = await _call_headless(sidecar_mgr, message)
        status = result_data.get("status", "completed")
        answer = result_data.get("answer", "")
    else:
        result_data = {}
        status = "completed"
        answer = "（无执行内容）"

    finished_at = _now_iso()
    result = json.dumps(
        {"message": answer, "action": existing["action"]},
        ensure_ascii=False,
    )

    run_id = db_record_run(automation_id, started_at, finished_at, status, result)

    next_run = _compute_next_run(existing["interval_seconds"], existing["cron_expr"])
    db_update_automation(automation_id, {"next_run": next_run})

    logger.info("[automation] Manual run triggered for '%s' (%s) -> %s", existing["name"], automation_id, status)
    return {
        "ok": True,
        "run_id": run_id,
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
    }


@router.get("/automations/{automation_id}/history")
async def get_run_history(automation_id: str, request: Request):
    """获取任务的执行历史（最近 20 条）。"""
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    history = db_get_run_history(automation_id, limit=20)
    return {"automation_id": automation_id, "history": history, "total": len(history)}
