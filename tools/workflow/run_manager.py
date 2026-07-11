"""In-process executor for closed-registry workflow runs."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable

from tools.workflow.journal import WorkflowJournalStore, WorkflowRun
from tools.workflow.registry import WorkflowExecutionContext, WorkflowRegistry


class WorkflowRunManager:
    """Execute registered workflow steps sequentially and fence late results."""

    def __init__(self, store: WorkflowJournalStore, registry: WorkflowRegistry, *,
                 max_concurrency: int = 2) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        self.store = store
        self.registry = registry
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def submit(self, run: WorkflowRun) -> bool:
        if run.status != "queued" or run.run_id in self._tasks and not self._tasks[run.run_id].done():
            return False
        task = asyncio.create_task(self._execute(run.run_id))
        self._tasks[run.run_id] = task
        task.add_done_callback(lambda done, run_id=run.run_id: self._forget(run_id, done))
        return True

    async def cancel(self, run_id: str, reason: str = "cancelled_by_user") -> bool:
        changed = self.store.cancel(run_id, reason)
        task = self._tasks.get(run_id)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return changed

    async def cancel_parent(self, parent_session_id: str, reason: str = "parent_session_closed") -> int:
        run_ids = self.store.cancel_parent(parent_session_id, reason)
        tasks = [self._tasks[run_id] for run_id in run_ids if run_id in self._tasks]
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return len(run_ids)

    def resume(self, run_id: str) -> bool:
        if not self.store.resume(run_id):
            return False
        run = self.store.get(run_id)
        return run is not None and self.submit(run)

    def recover(self) -> list[str]:
        recovered: list[str] = []
        for run_id in self.store.recover_pending():
            run = self.store.get(run_id)
            if run is not None and self.submit(run):
                recovered.append(run_id)
        return recovered

    async def shutdown(self) -> None:
        # Controlled shutdown preserves explicitly safe in-flight steps for a
        # fresh process. Unsafe work stays failed/inspectable, never replayed.
        for run_id, task in list(self._tasks.items()):
            if not task.done():
                self.store.prepare_for_restart(run_id)
                task.cancel()
        tasks = [task for task in self._tasks.values() if not task.done()]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _execute(self, run_id: str) -> None:
        async with self._semaphore:
            while True:
                run = self.store.get(run_id)
                if run is None or run.status not in {"queued", "running"}:
                    return
                try:
                    definition = self.registry.require(run.workflow_id)
                except KeyError:
                    lease = self.store.claim_next_step(run_id)
                    if lease is not None:
                        self.store.fail_step(lease, "workflow_definition_unavailable")
                    return
                if definition.version != run.workflow_version:
                    lease = self.store.claim_next_step(run_id)
                    if lease is not None:
                        self.store.fail_step(lease, "workflow_definition_version_mismatch")
                    return
                lease = self.store.claim_next_step(run_id)
                if lease is None:
                    return
                step = next((item for item in definition.steps if item.id == lease.step_id), None)
                if step is None:
                    self.store.fail_step(lease, "workflow_step_unavailable")
                    return
                context = WorkflowExecutionContext(
                    run_id=run.run_id,
                    parent_session_id=run.parent_session_id,
                    parent_turn_id=run.parent_turn_id,
                    workflow_id=run.workflow_id,
                    step_id=step.id,
                )
                try:
                    checkpoint = await step.handler(context)
                    if not isinstance(checkpoint, dict):
                        raise TypeError("workflow handler must return a checkpoint object")
                except asyncio.CancelledError:
                    # The cancellation path has already fenced its journal row.
                    raise
                except Exception:
                    self.store.fail_step(lease, "workflow_step_failed")
                    return
                if not self.store.complete_step(lease, checkpoint):
                    return

    def _forget(self, run_id: str, task: asyncio.Task[None]) -> None:
        if self._tasks.get(run_id) is task:
            self._tasks.pop(run_id, None)
