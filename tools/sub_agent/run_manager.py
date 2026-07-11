"""In-process dispatcher for :mod:`deferred_result_store` durable runs."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from tools.sub_agent.deferred_result_store import DeferredResultStore, DeferredRun


RunExecutor = Callable[[DeferredRun], Awaitable[str]]
RecoveredExecutorFactory = Callable[[DeferredRun], RunExecutor]


class DeferredRunManager:
    """Claim, execute and settle durable runs without leaking task exceptions."""

    def __init__(self, store: DeferredResultStore, *, max_concurrency: int = 2) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        self.store = store
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def submit(self, run: DeferredRun, executor: RunExecutor) -> bool:
        """Schedule *run* once. Returns false if it is already locally scheduled."""
        if run.status != "queued":
            return False
        if run.run_id in self._tasks and not self._tasks[run.run_id].done():
            return False
        # Claim after a concurrency slot is available.  Claiming before this
        # point would let a queued in-process task lose its lease while waiting
        # behind another long-running child.
        task = asyncio.create_task(self._claim_and_execute(run.run_id, executor))
        self._tasks[run.run_id] = task
        task.add_done_callback(lambda done, run_id=run.run_id: self._forget(run_id, done))
        return True

    async def cancel(self, run_id: str, reason: str = "cancelled_by_user") -> bool:
        changed = self.store.cancel(run_id, reason)
        if changed:
            run = self.store.get(run_id)
            if run is not None:
                _audit(run, "cancelled", status="blocked")
        task = self._tasks.get(run_id)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return changed

    async def cancel_parent(self, parent_session_id: str, reason: str = "parent_session_closed") -> int:
        """Cancel all active child runs when their parent session is removed."""
        run_ids = self.store.active_run_ids_for_parent(parent_session_id)
        outcomes = await asyncio.gather(
            *(self.cancel(run_id, reason) for run_id in run_ids),
            return_exceptions=False,
        )
        return sum(bool(outcome) for outcome in outcomes)

    async def shutdown(self) -> None:
        tasks = [task for task in self._tasks.values() if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def recover(self, executor_factory: RecoveredExecutorFactory) -> list[str]:
        """Schedule expired, explicitly retryable runs after a process restart."""
        recovered: list[str] = []
        for run_id in self.store.recover_expired():
            run = self.store.get(run_id)
            if run is None:
                continue
            if self.submit(run, executor_factory(run)):
                recovered.append(run_id)
        return recovered

    async def _claim_and_execute(self, run_id: str, executor: RunExecutor) -> None:
        async with self._semaphore:
            lease = self.store.claim(run_id)
            if lease is None:
                expired = self.store.get(run_id)
                if expired is not None and expired.status == "failed":
                    _audit(expired, "deadline_exceeded", status="error")
                return
            run = self.store.get(run_id)
            if run is None:
                return
            _audit(run, "execution_started")
            try:
                result = await executor(run)
            except asyncio.CancelledError:
                # cancel() has already fenced the row.  Never misclassify this
                # as a failed/retryable execution.
                raise
            except Exception as exc:
                self.store.fail(lease, _safe_error_summary(exc))
                _audit(run, "failed", status="error")
                return
            if self.store.complete(lease, result, result_ref=f"deferred:{run_id}"):
                _audit(run, "completed")

    def _forget(self, run_id: str, task: asyncio.Task[None]) -> None:
        if self._tasks.get(run_id) is task:
            self._tasks.pop(run_id, None)


def _safe_error_summary(exc: Exception) -> str:
    """Persist a bounded classification, not a provider traceback or prompt."""
    if isinstance(exc, TimeoutError):
        return "deadline_exceeded"
    return type(exc).__name__.lower()[:120]


def _audit(run: DeferredRun, lifecycle: str, *, status: str = "ok") -> None:
    """Keep auditing best-effort so local execution never depends on logging."""
    try:
        from agent.audit_log import log_subagent_run_event

        log_subagent_run_event(
            run.run_id,
            lifecycle,
            parent_session_id=run.parent_session_id,
            parent_turn_id=run.parent_turn_id,
            status=status,
        )
    except Exception:
        pass
