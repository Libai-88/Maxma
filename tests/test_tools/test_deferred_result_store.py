"""Contract tests for durable asynchronous sub-agent results."""
from __future__ import annotations

from tools.sub_agent.deferred_result_store import DeferredResultStore


def _submit(store: DeferredResultStore, *, task: str = "summarize"):
    return store.submit(
        parent_session_id="parent",
        parent_turn_id="turn",
        task=task,
        input_summary=task,
        delegation_snapshot={"model_name": "test", "allowed_tools": []},
        deadline_at=10_000.0,
        retryable=True,
    )


def test_submit_is_idempotent_and_persists_snapshot(tmp_path):
    store = DeferredResultStore(tmp_path / "runs.sqlite", clock=lambda: 100.0)

    first = _submit(store)
    second = _submit(store)

    assert first.run_id == second.run_id
    persisted = store.get(first.run_id)
    assert persisted is not None
    assert persisted.status == "queued"
    assert persisted.delegation_snapshot == {"model_name": "test", "allowed_tools": []}


def test_cancellation_fences_a_late_worker_result(tmp_path):
    store = DeferredResultStore(tmp_path / "runs.sqlite", clock=lambda: 100.0)
    run = _submit(store)
    lease = store.claim(run.run_id)

    assert lease is not None
    assert store.cancel(run.run_id, "parent_cancelled") is True
    assert store.complete(lease, "late answer") is False
    persisted = store.get(run.run_id)
    assert persisted is not None
    assert persisted.status == "cancelled"
    assert persisted.cancel_reason == "parent_cancelled"
    assert persisted.result is None


def test_expired_lease_is_recovered_only_for_retryable_runs(tmp_path):
    now = [100.0]
    store = DeferredResultStore(tmp_path / "runs.sqlite", lease_seconds=5, clock=lambda: now[0])
    retryable = _submit(store, task="retryable")
    non_retryable = store.submit(
        parent_session_id="parent",
        parent_turn_id="turn-2",
        task="non-retryable",
        input_summary="non-retryable",
        delegation_snapshot={},
        deadline_at=10_000.0,
        retryable=False,
    )
    assert store.claim(retryable.run_id) is not None
    assert store.claim(non_retryable.run_id) is not None

    now[0] = 106.0
    assert store.recover_expired() == [retryable.run_id]
    assert store.get(retryable.run_id).status == "queued"
    assert store.get(non_retryable.run_id).status == "running"
    assert store.claim(retryable.run_id) is not None


def test_expired_deadline_fails_without_executing(tmp_path):
    store = DeferredResultStore(tmp_path / "runs.sqlite", clock=lambda: 100.0)
    run = store.submit(
        parent_session_id="parent", parent_turn_id="turn", task="expired",
        input_summary="expired", delegation_snapshot={}, deadline_at=99.0, retryable=True,
    )

    assert store.claim(run.run_id) is None
    persisted = store.get(run.run_id)
    assert persisted is not None
    assert persisted.status == "failed"
    assert persisted.error_summary == "deadline_exceeded"
