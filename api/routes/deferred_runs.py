"""Deferred sub-agent runs REST API — 后台子任务状态追踪。

前端 SubAgentCard 通过轮询本端点获取子任务状态。
数据由 sidecar WebSocket 事件推送时写入此管理器。
路由前缀 /sessions/{session_id}/deferred-runs。
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(tags=["deferred-runs"])


class DeferredRunManager:
    """进程内 deferred run 存储器。

    以 session_id → {run_id → run_data} 两层 dict 组织。
    全部在内存中，重启丢失；sidecar 重连后通过 WebSocket 事件重新填充。
    """

    def __init__(self) -> None:
        self._runs: dict[str, dict[str, dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def add_or_update(self, session_id: str, run: dict[str, Any]) -> dict[str, Any]:
        """添加或更新一个 deferred run。"""
        run_id = run.get("run_id")
        if not run_id:
            raise ValueError("run_id is required")
        async with self._lock:
            session_runs = self._runs.setdefault(session_id, {})
            existing = session_runs.get(run_id, {})
            # 合并：保留已有字段，用新数据覆盖
            merged = {**existing, **run}
            merged["updated_at"] = int(time.time())
            if "created_at" not in merged:
                merged["created_at"] = merged["updated_at"]
            session_runs[run_id] = merged
            return dict(merged)

    async def list_runs(self, session_id: str) -> list[dict[str, Any]]:
        """列出某 session 的所有 deferred run。"""
        async with self._lock:
            session_runs = self._runs.get(session_id, {})
            return sorted(
                [dict(r) for r in session_runs.values()],
                key=lambda r: r.get("created_at", 0),
                reverse=True,
            )

    async def get_run(self, session_id: str, run_id: str) -> dict[str, Any] | None:
        """获取单个 deferred run。"""
        async with self._lock:
            run = self._runs.get(session_id, {}).get(run_id)
            return dict(run) if run else None

    async def cancel_run(self, session_id: str, run_id: str) -> dict[str, Any]:
        """取消一个 deferred run。"""
        async with self._lock:
            session_runs = self._runs.get(session_id)
            if not session_runs or run_id not in session_runs:
                raise HTTPException(status_code=404, detail="Deferred run not found")
            run = session_runs[run_id]
            if run.get("status") in ("succeeded", "failed", "cancelled"):
                raise HTTPException(
                    status_code=409,
                    detail=f"Run already in terminal state: {run.get('status')}",
                )
            run["status"] = "cancelled"
            run["cancel_reason"] = "cancelled_by_user"
            run["updated_at"] = int(time.time())
            return dict(run)

    async def cancel_parent(self, session_id: str) -> None:
        """取消某 session 的所有活跃 deferred run（session 删除时调用）。"""
        async with self._lock:
            session_runs = self._runs.get(session_id, {})
            now = int(time.time())
            for run in session_runs.values():
                if run.get("status") in ("queued", "running"):
                    run["status"] = "cancelled"
                    run["cancel_reason"] = "parent_session_closed"
                    run["updated_at"] = now


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
