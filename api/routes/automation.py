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


# CRON-PARSE-001：标准 5 字段 cron 表达式解析（零依赖实现，便携版不增依赖）。
# 此前 cron_expr 被完全忽略、一律按"下一分钟边界"触发——cron 任务实际
# 每分钟误触发一次。支持：* / 数字 / 逗号列表 / a-b 范围 / */n 与 a-b/n 步长；
# day-of-month 与 day-of-week 按 Vixie cron 的 OR 语义（任一匹配即触发）。
_CRON_FIELD_RANGES = (0, 59), (0, 23), (1, 31), (1, 12), (0, 6)  # min hour dom month dow
_CRON_FIELD_NAMES = ("minute", "hour", "day-of-month", "month", "day-of-week")
_CRON_MONTH_ALIASES = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                       "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_CRON_DOW_ALIASES = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}


def _parse_cron_field(field: str, lo: int, hi: int, *, names: dict[str, int] | None = None) -> set[int]:
    """解析单个 cron 字段为允许值集合；非法字段抛 ValueError。"""
    if names is None:
        names = {}
    values: set[int] = set()
    for part in field.split(","):
        part = part.strip()
        if not part:
            raise ValueError(f"empty cron field part: {field!r}")
        # 步长 /n
        step = 1
        if "/" in part:
            base, step_str = part.rsplit("/", 1)
            if not step_str.isdigit() or int(step_str) <= 0:
                raise ValueError(f"invalid step in cron field: {part!r}")
            step = int(step_str)
        else:
            base = part
        # 名称别名（jan/mon…）
        base_lower = base.lower()
        if base_lower in names:
            base = str(names[base_lower])
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            start_str, end_str = base.split("-", 1)
            if not start_str.isdigit() or not end_str.isdigit():
                raise ValueError(f"invalid range in cron field: {part!r}")
            start, end = int(start_str), int(end_str)
        else:
            if not base.isdigit():
                raise ValueError(f"invalid cron field value: {part!r}")
            start = end = int(base)
        if start < lo or end > hi or start > end:
            raise ValueError(f"cron value out of range {lo}-{hi}: {part!r}")
        values.update(range(start, end + 1, step))
    return values


def parse_cron_expr(expr: str) -> list[set[int]]:
    """解析完整 5 字段 cron 表达式，返回 5 个允许值集合。"""
    fields = expr.strip().split()
    if len(fields) != 5:
        raise ValueError(
            f"cron 表达式必须为 5 字段（分 时 日 月 周），收到 {len(fields)} 个: {expr!r}"
        )
    parsed = []
    for i, (field, (lo, hi)) in enumerate(zip(fields, _CRON_FIELD_RANGES)):
        names = _CRON_MONTH_ALIASES if i == 3 else (_CRON_DOW_ALIASES if i == 4 else None)
        parsed.append(_parse_cron_field(field, lo, hi, names=names))
    return parsed


def _cron_matches(parsed: list[set[int]], dt: datetime) -> bool:
    """判断 dt 是否匹配 cron 表达式（DOM 与 DOW 为 OR 语义）。"""
    minute, hour, dom, month, dow = parsed
    if dt.minute not in minute or dt.hour not in hour or dt.month not in month:
        return False
    # Vixie cron 语义：day-of-month 与 day-of-week 任一匹配即触发
    return dt.day in dom or dt.weekday() in dow


def _next_cron_run(expr: str, after: datetime) -> datetime | None:
    """计算 after 之后最近一次 cron 触发时间；非法表达式返回 None。"""
    try:
        parsed = parse_cron_expr(expr)
    except ValueError as e:
        logger.warning("[automation] 无效 cron 表达式 %r: %s", expr, e)
        return None
    # 从 after 的下一分钟开始逐分钟扫描，上限 366 天（任意合法表达式
    # 至多一年内必触发；防御无限循环）
    cursor = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    deadline = cursor + timedelta(days=366)
    while cursor <= deadline:
        if _cron_matches(parsed, cursor):
            return cursor
        cursor += timedelta(minutes=1)
    logger.warning("[automation] cron 表达式 %r 在 366 天内无匹配", expr)
    return None


def validate_cron_expr(expr: str) -> bool:
    """前端创建/编辑时校验 cron 表达式（返回是否合法）。"""
    try:
        parse_cron_expr(expr)
        return True
    except ValueError:
        return False


def _compute_next_run(interval_seconds: int | None, cron_expr: str | None) -> str | None:
    """Compute the next run time based on interval or cron expression.

    CRON-PARSE-001：cron_expr 此前被忽略（一律下一分钟边界 → 每分钟误触发），
    现按标准 5 字段解析；非法表达式返回 None（任务不会被调度，日志有警告）。
    """
    now = datetime.now(timezone.utc)
    if interval_seconds and interval_seconds > 0:
        return (now + timedelta(seconds=interval_seconds)).isoformat()
    if cron_expr:
        nxt = _next_cron_run(cron_expr, now)
        return nxt.isoformat() if nxt else None
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


# ── 原子认领（AUTOMATION-CLAIM-001）─────────────────────
# 此前调度器先 SELECT 到期任务、执行完才推进 next_run：
#   1) 单次 headless 执行超过 60s 时，下个 tick 会把同一任务再选中 →
#      并发重复执行（重复 LLM 调用/动作）；
#   2) "记历史"与"推进 next_run"是两个独立事务，中途崩溃重启后立即重复触发；
#   3) 手动触发与调度 tick 无互斥，可同时执行。
# 现在执行前先在单个事务内以 claim_token 抢占，执行完在同一事务内
# 记历史 + 清认领 + 推进 next_run；崩溃残留的认领超过阈值后自动回收。

# 崩溃残留认领的回收阈值：超过该时长（秒）的 claim_token 视为僵尸，
# 允许重新认领。取 30 分钟——远大于最长 headless 调用（10 分钟），
# 正常执行中的任务不会被回收，崩溃/杀进程残留的任务能自愈恢复调度。
CLAIM_STALE_SECONDS = 1800


def _iso_delta_seconds(now_iso: str, seconds: int) -> str:
    return (datetime.fromisoformat(now_iso) - timedelta(seconds=seconds)).isoformat()


def db_claim_due_automations(now_iso: str) -> list[dict[str, Any]]:
    """原子认领所有到期且未被认领的自动化任务。

    单事务内：UPDATE 抢占 claim_token → 读回被本 token 认领的行。
    并发 tick / 手动触发之间的 UPDATE 由 SQLite 行锁串行化，
    WHERE 条件保证同一任务只会被一个执行者认领。
    """
    stale_before = _iso_delta_seconds(now_iso, CLAIM_STALE_SECONDS)
    with transaction() as db:
        db.execute(
            """UPDATE automations SET claim_token = ?
               WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?
                 AND (claim_token IS NULL OR claim_token < ?)""",
            (now_iso, now_iso, stale_before),
        )
        rows = db.execute(
            "SELECT * FROM automations WHERE claim_token = ?", (now_iso,)
        ).fetchall()
    return [_row_to_automation(r) for r in rows]


def db_claim_automation(automation_id: str, now_iso: str) -> bool:
    """认领指定自动化（手动触发）。已被认领且未过回收阈值时返回 False。"""
    stale_before = _iso_delta_seconds(now_iso, CLAIM_STALE_SECONDS)
    with transaction() as db:
        cur = db.execute(
            """UPDATE automations SET claim_token = ?
               WHERE id = ? AND (claim_token IS NULL OR claim_token < ?)""",
            (now_iso, automation_id, stale_before),
        )
        return cur.rowcount > 0


def db_release_claim(automation_id: str) -> None:
    """释放认领（执行失败/异常时），保留 next_run 原值供下个 tick 重试。"""
    with transaction() as db:
        db.execute(
            "UPDATE automations SET claim_token = NULL WHERE id = ?",
            (automation_id,),
        )


def db_finish_automation(
    automation_id: str,
    *,
    started_at: str,
    finished_at: str,
    status: str,
    result: str | None,
    next_run: str | None,
) -> int:
    """单事务完成一次运行：记历史 + 更新计数 + 推进 next_run + 释放认领。

    替代此前 db_record_run + db_update_automation 的两事务组合——
    中途崩溃不会再出现"历史已记但 next_run 未推进"的重复触发窗口。
    """
    with transaction() as db:
        cur = db.execute(
            """INSERT INTO automation_run_history (automation_id, started_at, finished_at, status, result)
               VALUES (?, ?, ?, ?, ?)""",
            (automation_id, started_at, finished_at, status, result),
        )
        run_id = cur.lastrowid
        db.execute(
            """UPDATE automations
               SET last_run = ?, run_count = run_count + 1, next_run = ?, claim_token = NULL
               WHERE id = ?""",
            (finished_at, next_run, automation_id),
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
        # HEADLESS-CALL-TIMEOUT-001：显式 120s RPC 超时（sidecar 侧 headless
        # 另有 300s 硬超时兜底）——此前无超时参数走 rpc_client 默认值，且
        # 调度循环串行执行，一个挂死的任务会阻塞整个调度器。
        result = await asyncio.wait_for(
            client.call("headless_prompt", {"message": message}),
            timeout=120,
        )
        return result if isinstance(result, dict) else {"answer": str(result), "status": "completed"}
    except asyncio.TimeoutError:
        return {"answer": "", "status": "timeout", "error": "headless_prompt 超时"}
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
            # AUTOMATION-CLAIM-001：原子认领到期任务，防并发重复执行
            due_tasks = db_claim_due_automations(now_iso)

            for task in due_tasks:
                started_at = _now_iso()
                action = task.get("action", {})
                message = ""
                if isinstance(action, dict):
                    message = action.get("payload", {}).get("text", "") if isinstance(action.get("payload"), dict) else str(action)
                else:
                    message = str(action)

                try:
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

                    next_run = _compute_next_run(task["interval_seconds"], task["cron_expr"])
                    db_finish_automation(
                        task["id"],
                        started_at=started_at,
                        finished_at=finished_at,
                        status=status,
                        result=result,
                        next_run=next_run,
                    )

                    logger.info(
                        "[automation] Executed task '%s' (%s) -> %s, next_run=%s",
                        task["name"], task["id"], status, next_run,
                    )
                except Exception as exc:
                    # 执行异常：释放认领并保留原 next_run，下个 tick 自动重试
                    logger.exception("[automation] Failed to execute task '%s' (%s): %s", task["name"], task["id"], exc)
                    db_release_claim(task["id"])

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
    # CRON-PARSE-001：创建时校验 cron 表达式，非法立即 422（此前非法表达式
    # 会被静默接受并按"每分钟触发"执行）
    if body.cron_expr and not validate_cron_expr(body.cron_expr):
        raise HTTPException(
            status_code=422,
            detail="cron 表达式无效（需要 5 字段：分 时 日 月 周，如 '0 9 * * 1-5'）",
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
        # CRON-PARSE-001：更新时同样校验 cron 表达式
        if body.cron_expr and not validate_cron_expr(body.cron_expr):
            raise HTTPException(
                status_code=422,
                detail="cron 表达式无效（需要 5 字段：分 时 日 月 周，如 '0 9 * * 1-5'）",
            )
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
    """立即触发一次执行（手动运行 — 通过 sidecar 无头执行）。

    AUTOMATION-CLAIM-001：执行前原子认领，与调度 tick 互斥——
    任务已在运行（调度器或另一次手动触发）时返回 409。
    """
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    now_iso = _now_iso()
    if not db_claim_automation(automation_id, now_iso):
        raise HTTPException(status_code=409, detail="该自动化任务正在运行中，请稍后再试")

    started_at = now_iso
    try:
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

        next_run = _compute_next_run(existing["interval_seconds"], existing["cron_expr"])
        run_id = db_finish_automation(
            automation_id,
            started_at=started_at,
            finished_at=finished_at,
            status=status,
            result=result,
            next_run=next_run,
        )

        logger.info("[automation] Manual run triggered for '%s' (%s) -> %s", existing["name"], automation_id, status)
        return {
            "ok": True,
            "run_id": run_id,
            "status": status,
            "started_at": started_at,
            "finished_at": finished_at,
        }
    except Exception as exc:
        # 执行异常：释放认领，让后续调度/手动触发可以重试
        db_release_claim(automation_id)
        raise exc


@router.get("/automations/{automation_id}/history")
async def get_run_history(automation_id: str, request: Request):
    """获取任务的执行历史（最近 20 条）。"""
    existing = db_get_automation(automation_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Automation not found")

    history = db_get_run_history(automation_id, limit=20)
    return {"automation_id": automation_id, "history": history, "total": len(history)}
