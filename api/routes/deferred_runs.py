"""Deferred sub-agent runs REST API — 后台子任务状态追踪。

前端 SubAgentCard 通过轮询本端点获取子任务状态。
数据由 sidecar WebSocket 事件推送时写入此管理器。
路由前缀 /sessions/{session_id}/deferred-runs。
"""

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from api.db.core import transaction

logger = logging.getLogger(__name__)

router = APIRouter(tags=["deferred-runs"])


class DeferredRunManager:
    """SQLite 持久化的 deferred run 存储器（DEFERRED-PERSIST-001）。

    此前全部在内存中，后端重启即丢——sidecar 不会重发历史事件，
    前端轮询直接 404，SubAgentCard 状态丢失。现在数据落 maxma.db
    的 deferred_runs 表，重启后状态与历史仍可查询。
    """

    def __init__(self) -> None:
        # 事件循环内串行化（SQLite 行锁兜底跨进程）
        self._lock = asyncio.Lock()

    @staticmethod
    def _decode(raw: str | None) -> dict[str, Any] | None:
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def _get_sync(self, session_id: str, run_id: str) -> dict[str, Any] | None:
        with transaction() as db:
            row = db.execute(
                "SELECT data FROM deferred_runs WHERE session_id = ? AND run_id = ?",
                (session_id, run_id),
            ).fetchone()
        return self._decode(row[0]) if row else None

    def _list_sync(self, session_id: str) -> list[dict[str, Any]]:
        with transaction() as db:
            rows = db.execute(
                "SELECT data FROM deferred_runs WHERE session_id = ?",
                (session_id,),
            ).fetchall()
        runs = [self._decode(r[0]) for r in rows]
        return [r for r in runs if r is not None]

    def _upsert_sync(self, session_id: str, run: dict[str, Any]) -> None:
        with transaction() as db:
            db.execute(
                "INSERT INTO deferred_runs (session_id, run_id, data) VALUES (?, ?, ?) "
                "ON CONFLICT(session_id, run_id) DO UPDATE SET "
                "data = excluded.data, updated_at = julianday('now')",
                (session_id, run.get("run_id", ""), json.dumps(run, ensure_ascii=False)),
            )

    async def add_or_update(self, session_id: str, run: dict[str, Any]) -> dict[str, Any]:
        """添加或更新一个 deferred run（合并保留已有字段）。"""
        run_id = run.get("run_id")
        if not run_id:
            raise ValueError("run_id is required")
        async with self._lock:
            existing = self._get_sync(session_id, run_id) or {}
            # 合并：保留已有字段，用新数据覆盖
            merged = {**existing, **run}
            merged["updated_at"] = int(time.time())
            if "created_at" not in merged:
                merged["created_at"] = merged["updated_at"]
            self._upsert_sync(session_id, merged)
            return dict(merged)

    async def list_runs(self, session_id: str) -> list[dict[str, Any]]:
        """列出某 session 的所有 deferred run。"""
        async with self._lock:
            runs = self._list_sync(session_id)
            return sorted(
                runs,
                key=lambda r: r.get("created_at", 0),
                reverse=True,
            )

    async def get_run(self, session_id: str, run_id: str) -> dict[str, Any] | None:
        """获取单个 deferred run。"""
        async with self._lock:
            run = self._get_sync(session_id, run_id)
            return dict(run) if run else None

    async def cancel_run(self, session_id: str, run_id: str) -> dict[str, Any]:
        """取消一个 deferred run。"""
        async with self._lock:
            run = self._get_sync(session_id, run_id)
            if run is None:
                raise HTTPException(status_code=404, detail="Deferred run not found")
            if run.get("status") in ("succeeded", "failed", "cancelled"):
                raise HTTPException(
                    status_code=409,
                    detail=f"Run already in terminal state: {run.get('status')}",
                )
            run["status"] = "cancelled"
            run["cancel_reason"] = "cancelled_by_user"
            run["updated_at"] = int(time.time())
            self._upsert_sync(session_id, run)
            return dict(run)

    async def cancel_parent(self, session_id: str) -> None:
        """取消某 session 的所有活跃 deferred run（session 删除时调用）。"""
        async with self._lock:
            now = int(time.time())
            for run in self._list_sync(session_id):
                if run.get("status") in ("queued", "running"):
                    run["status"] = "cancelled"
                    run["cancel_reason"] = "parent_session_closed"
                    run["updated_at"] = now
                    self._upsert_sync(session_id, run)


# ── 依赖注入：从 request.app.state 获取管理器 ──


def _get_manager(request: Request) -> DeferredRunManager:
    mgr: DeferredRunManager | None = getattr(
        request.app.state, "deferred_run_manager", None
    )
    if mgr is None:
        raise HTTPException(
            status_code=503, detail="Deferred run manager not available"
        )
    return mgr


# ── REST 端点 ──


@router.get("/sessions/{session_id}/deferred-runs")
async def list_deferred_runs(session_id: str, request: Request):
    """列出 session 的所有 deferred runs。"""
    mgr = _get_manager(request)
    runs = await mgr.list_runs(session_id)
    return {"runs": runs}


@router.get("/sessions/{session_id}/deferred-runs/{run_id}")
async def get_deferred_run(session_id: str, run_id: str, request: Request):
    """获取单个 deferred run。"""
    mgr = _get_manager(request)
    run = await mgr.get_run(session_id, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Deferred run not found")
    return run


@router.post("/sessions/{session_id}/deferred-runs/{run_id}/cancel")
async def cancel_deferred_run(session_id: str, run_id: str, request: Request):
    """取消一个 deferred run。"""
    mgr = _get_manager(request)
    run = await mgr.cancel_run(session_id, run_id)
    return run
