"""Conservative executor for user-created, read-only Scout schedules.

This module intentionally does not contain a generic autonomous-agent DSL.
It can execute only a frozen Scout lease, with a closed read-only tool list,
and never delivers a result to an external destination.  A separate explicit
user action is required for any delivery or write operation.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from agent.autonomy.governance import AutonomyLease, AutonomyScheduleStore

logger = logging.getLogger(__name__)

ScoutExecutor = Callable[[AutonomyLease], Awaitable[None]]


async def run_scout_lease(app: Any, lease: AutonomyLease) -> None:
    """Run exactly one lease through an isolated read-only sidecar session.

    The provider/model are selected from the schedule snapshot rather than
    the mutable default.  Provider configuration that has since disappeared
    or become unhealthy fails the lease safely; it never silently switches to
    another provider.
    """
    if lease.role != "scout":
        raise RuntimeError("unsupported autonomous role")

    sidecar_mgr = getattr(app.state, "sidecar_manager", None)
    if sidecar_mgr is None:
        raise RuntimeError("sidecar manager is unavailable")

    await sidecar_mgr.start()
    client = sidecar_mgr.client
    if client is None:
        raise RuntimeError("sidecar client is unavailable")

    # OMP ModelRegistry 管理所有 provider
    # Scout 使用 lease 中快照的 provider/model 信息
    provider_id = lease.scope.provider_id or "openai"
    model_name = lease.scope.model_name or "gpt-4o"
    model_str = f"{provider_id}/{model_name}"

    # 构建只读系统提示词
    system_prompt = getattr(app.state, "system_prompt", "") or ""
    system_prompt += (
        "\n\n[Read-only Scout mode]\n"
        "This task was explicitly scheduled by the user. You may only use "
        "the supplied read-only tools. Do not modify files, configuration, "
        "skills, providers, schedules, or send anything externally. "
        "Return concise findings for later user review."
    )

    # 创建临时 sidecar 会话
    result = await client.call("create_session", {
        "model": model_str,
        "system_prompt": system_prompt,
        "cwd": ".",
    })
    sidecar_sid = result["session_id"]

    try:
        prompt = "[User-created Scout goal]\n" + lease.goal

        done_event = asyncio.Event()

        def _on_event(params: dict) -> None:
            event = params.get("event", {})
            if event.get("type") == "done":
                done_event.set()

        client.on("event", _on_event, session_id=sidecar_sid)

        await client.call("prompt", {
            "session_id": sidecar_sid,
            "message": prompt,
        })

        await asyncio.wait_for(done_event.wait(), timeout=lease.scope.max_seconds)
    finally:
        try:
            await client.call("destroy_session", {"session_id": sidecar_sid})
        except Exception:
            logger.debug("[scout] destroy_session failed", exc_info=True)


class ScoutScheduleRunner:
    """Bounded polling runner which owns leases until they are conclusively closed."""

    def __init__(
        self,
        store: AutonomyScheduleStore,
        executor: ScoutExecutor,
        *,
        poll_seconds: float = 5.0,
        max_concurrency: int = 1,
    ) -> None:
        if poll_seconds <= 0 or max_concurrency < 1:
            raise ValueError("poll_seconds and max_concurrency must be positive")
        self.store = store
        self._executor = executor
        self._poll_seconds = poll_seconds
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._task: asyncio.Task[None] | None = None
        self._runs: set[asyncio.Task[None]] = set()
        self._stopping = False

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopping = False
            self._task = asyncio.create_task(self._loop())

    async def shutdown(self) -> None:
        self._stopping = True
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
        for task in tuple(self._runs):
            task.cancel()
        if self._runs:
            await asyncio.gather(*self._runs, return_exceptions=True)
        # Any lease that did not finish is paused rather than resumed after a
        # restart.  This provides a visible, user-controlled recovery point.
        self.store.pause_active_leases()

    async def _loop(self) -> None:
        while True:
            for lease in self.store.claim_due():
                task = asyncio.create_task(self._execute(lease))
                self._runs.add(task)
                task.add_done_callback(self._runs.discard)
            await asyncio.sleep(self._poll_seconds)

    async def _execute(self, lease: AutonomyLease) -> None:
        started_at = time.monotonic()
        try:
            async with self._semaphore:
                await self._executor(lease)
        except asyncio.CancelledError:
            if not self._stopping:
                self.store.finish(
                    lease, status="cancelled", seconds_used=time.monotonic() - started_at
                )
            raise
        except Exception:
            logger.warning("Scout schedule %s failed", lease.schedule_id, exc_info=True)
            self.store.finish(lease, status="failed", seconds_used=time.monotonic() - started_at)
        else:
            self.store.finish(lease, status="succeeded", seconds_used=time.monotonic() - started_at)
