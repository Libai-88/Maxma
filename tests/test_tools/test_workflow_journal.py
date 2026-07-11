"""Focused contracts for registered workflow persistence and recovery."""
from __future__ import annotations

import asyncio

import pytest

from tools.workflow.journal import WorkflowJournalStore
from tools.workflow.registry import (
    RegisteredWorkflow,
    RegisteredWorkflowStep,
    WorkflowRegistry,
)
from tools.workflow.run_manager import WorkflowRunManager


async def _success(context):
    return {"step": context.step_id}


def _definition(*, safe_to_resume: bool = True) -> RegisteredWorkflow:
    return RegisteredWorkflow(
        "test-workflow", 1,
        (
            RegisteredWorkflowStep("first", _success, safe_to_resume=safe_to_resume),
            RegisteredWorkflowStep("second", _success),
        ),
    )


def test_journal_submission_is_idempotent_and_accepts_registered_definition_only(tmp_path):
    store = WorkflowJournalStore(tmp_path / "journal.sqlite", clock=lambda: 100.0)
    definition = _definition()

    first = store.submit(parent_session_id="parent", parent_turn_id="turn", definition=definition)
    second = store.submit(parent_session_id="parent", parent_turn_id="turn", definition=definition)

    assert first.run_id == second.run_id
    assert first.status == "queued"
    assert [(step.step_id, step.status, step.safe_to_resume) for step in store.list_steps(first.run_id)] == [
        ("first", "queued", True), ("second", "queued", True),
    ]


def test_checkpoint_is_fenced_and_workflow_transitions_to_success(tmp_path):
    store = WorkflowJournalStore(tmp_path / "journal.sqlite", clock=lambda: 100.0)
    run = store.submit(parent_session_id="parent", parent_turn_id=None, definition=_definition())

    first = store.claim_next_step(run.run_id)
    assert first is not None
    assert store.complete_step(first, {"checkpoint": "one"}) is True
    assert store.complete_step(first, {"checkpoint": "late"}) is False
    assert store.get(run.run_id).status == "queued"

    second = store.claim_next_step(run.run_id)
    assert second is not None
    assert store.complete_step(second, {"checkpoint": "two"}) is True
    assert store.get(run.run_id).status == "succeeded"
    assert [step.checkpoint for step in store.list_steps(run.run_id)] == [
        {"checkpoint": "one"}, {"checkpoint": "two"},
    ]


def test_interrupted_safe_step_is_requeued_but_unsafe_step_never_replays(tmp_path):
    now = [100.0]
    store = WorkflowJournalStore(tmp_path / "journal.sqlite", lease_seconds=5, clock=lambda: now[0])
    safe_run = store.submit(parent_session_id="parent", parent_turn_id="safe", definition=_definition())
    unsafe_run = store.submit(
        parent_session_id="parent", parent_turn_id="unsafe", definition=_definition(safe_to_resume=False)
    )
    assert store.claim_next_step(safe_run.run_id) is not None
    assert store.claim_next_step(unsafe_run.run_id) is not None

    now[0] = 106.0
    assert store.recover_pending() == [safe_run.run_id]
    assert store.get(safe_run.run_id).status == "queued"
    assert store.list_steps(safe_run.run_id)[0].status == "queued"
    assert store.get(unsafe_run.run_id).status == "failed"
    assert store.get(unsafe_run.run_id).failure_code == "restart_unsafe_step"
    assert store.list_steps(unsafe_run.run_id)[0].status == "failed"


@pytest.mark.asyncio
async def test_controlled_restart_requeues_safe_running_step_for_new_manager(tmp_path):
    started = asyncio.Event()

    async def blocked(_context):
        started.set()
        await asyncio.Event().wait()
        return {"never": "returned"}

    async def recovered(_context):
        return {"recovered": True}

    definition = RegisteredWorkflow(
        "restart-workflow", 1, (RegisteredWorkflowStep("safe", blocked),)
    )
    store = WorkflowJournalStore(tmp_path / "journal.sqlite")
    first_manager = WorkflowRunManager(store, WorkflowRegistry((definition,)))
    run = store.submit(parent_session_id="parent", parent_turn_id="turn", definition=definition)
    assert first_manager.submit(run) is True
    await started.wait()
    await first_manager.shutdown()
    assert store.get(run.run_id).status == "queued"

    restarted_definition = RegisteredWorkflow(
        "restart-workflow", 1, (RegisteredWorkflowStep("safe", recovered),)
    )
    second_manager = WorkflowRunManager(store, WorkflowRegistry((restarted_definition,)))
    assert second_manager.recover() == [run.run_id]
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert store.get(run.run_id).status == "succeeded"


@pytest.mark.asyncio
async def test_manager_cancellation_fences_running_registered_step(tmp_path):
    started = asyncio.Event()
    release = asyncio.Event()

    async def wait_for_release(_context):
        started.set()
        await release.wait()
        return {"unexpected": True}

    definition = RegisteredWorkflow(
        "waiting-workflow", 1, (RegisteredWorkflowStep("wait", wait_for_release),)
    )
    store = WorkflowJournalStore(tmp_path / "journal.sqlite")
    manager = WorkflowRunManager(store, WorkflowRegistry((definition,)))
    run = store.submit(parent_session_id="parent", parent_turn_id="turn", definition=definition)

    assert manager.submit(run) is True
    await started.wait()
    assert await manager.cancel(run.run_id) is True
    release.set()
    await asyncio.sleep(0)
    assert store.get(run.run_id).status == "cancelled"
    assert store.list_steps(run.run_id)[0].status == "cancelled"


@pytest.mark.asyncio
async def test_failed_safe_step_can_be_resumed_without_replaying_completed_steps(tmp_path):
    calls = {"first": 0, "second": 0}

    async def first(_context):
        calls["first"] += 1
        return {"first": "done"}

    async def second(_context):
        calls["second"] += 1
        if calls["second"] == 1:
            raise RuntimeError("temporary")
        return {"second": "done"}

    definition = RegisteredWorkflow(
        "resumable-workflow", 1,
        (RegisteredWorkflowStep("first", first), RegisteredWorkflowStep("second", second)),
    )
    store = WorkflowJournalStore(tmp_path / "journal.sqlite")
    manager = WorkflowRunManager(store, WorkflowRegistry((definition,)))
    run = store.submit(parent_session_id="parent", parent_turn_id="turn", definition=definition)
    assert manager.submit(run) is True
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert store.get(run.run_id).status == "failed"
    assert calls == {"first": 1, "second": 1}

    assert manager.resume(run.run_id) is True
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert store.get(run.run_id).status == "succeeded"
    assert calls == {"first": 1, "second": 2}
