"""Durable long-term-memory outbox tests."""

from __future__ import annotations

import json
import os
import threading
import time

import pytest

from memory.ltm_outbox import (
    LongTermMemoryOutbox,
    OutboxRetentionPolicy,
    ProjectionFenceLost,
)
from memory.memory_manager import MemoryManager, projection_mutation_scope


def _outbox(tmp_path, **kwargs) -> LongTermMemoryOutbox:
    return LongTermMemoryOutbox(tmp_path / "memory.ltm-outbox.sqlite3", **kwargs)


def test_enqueue_claim_complete_is_durable_and_deduplicated(tmp_path):
    outbox = _outbox(tmp_path)
    messages = [{"role": "user", "content": "记住我的偏好"}]

    assert outbox.enqueue("session-a", "turn-1", messages) is True
    job = outbox.claim_next()
    assert job is not None
    assert job.payload == messages
    assert outbox.complete(job) is True

    # The unique (session_id, turn_id) key survives a new process instance.
    restarted = _outbox(tmp_path)
    assert restarted.enqueue("session-a", "turn-1", messages) is False
    assert restarted.get("session-a", "turn-1")["status"] == "completed"


def test_expired_lease_recovers_after_worker_crash(tmp_path):
    first = _outbox(tmp_path, lease_seconds=0.02)
    first.enqueue("session-a", "turn-1", [{"role": "user", "content": "恢复"}])
    abandoned = first.claim_next()
    assert abandoned is not None

    time.sleep(0.03)
    recovered = _outbox(tmp_path, lease_seconds=1).claim_next()
    assert recovered is not None
    assert recovered.session_id == "session-a"
    assert recovered.turn_id == "turn-1"
    assert recovered.attempts == 2


def test_concurrent_workers_cannot_claim_same_task(tmp_path):
    outbox = _outbox(tmp_path)
    outbox.enqueue("session-a", "turn-1", [{"role": "user", "content": "并发"}])
    barrier = threading.Barrier(2)
    claimed = []

    def claim() -> None:
        worker = _outbox(tmp_path)
        barrier.wait()
        claimed.append(worker.claim_next())

    workers = [threading.Thread(target=claim), threading.Thread(target=claim)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()

    assert sum(job is not None for job in claimed) == 1


def test_failure_uses_backoff_and_explicit_retry_can_wake_task(tmp_path):
    outbox = _outbox(tmp_path, retry_base_seconds=0.05, retry_max_seconds=1)
    messages = [{"role": "user", "content": "重试"}]
    outbox.enqueue("session-a", "turn-1", messages)
    job = outbox.claim_next()
    assert job is not None
    assert outbox.fail(
        job.session_id, job.turn_id, job.lease_token, "temporary failure"
    )
    state = outbox.get("session-a", "turn-1")
    assert state["status"] == "pending"
    assert state["last_error"] == "temporary failure"
    assert outbox.claim_next() is None

    time.sleep(0.06)
    retried = outbox.claim_next()
    assert retried is not None
    assert retried.attempts == 2

    assert outbox.fail(
        retried.session_id, retried.turn_id, retried.lease_token, "again"
    )
    # A client retry is allowed to wake an otherwise backed-off pending task.
    assert outbox.enqueue("session-a", "turn-1", messages) is False
    assert outbox.claim_next() is not None


def test_cancellation_requeues_immediately_with_default_backoff(tmp_path):
    outbox = _outbox(tmp_path)
    assert outbox.enqueue("session-a", "turn-1", [])
    job = outbox.claim_next()
    assert job is not None

    assert outbox.release_cancelled(job) is True
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    assert state["status"] == "pending"
    assert state["last_error"] == "projection cancelled"
    assert outbox.claim_next() is not None


def test_stale_cancellation_cannot_release_new_claimant(tmp_path):
    first_worker = _outbox(tmp_path, lease_seconds=0.02)
    assert first_worker.enqueue("session-a", "turn-1", [])
    old_job = first_worker.claim_next()
    assert old_job is not None

    time.sleep(0.03)
    second_worker = _outbox(tmp_path, lease_seconds=30)
    new_job = second_worker.claim_next()
    assert new_job is not None

    assert first_worker.release_cancelled(old_job) is False
    state = second_worker.get("session-a", "turn-1")
    assert state is not None
    assert state["status"] == "claimed"
    assert state["lease_token"] == new_job.lease_token


def test_cleanup_archives_only_completed_rows_and_bounds_audit_trail(tmp_path):
    policy = OutboxRetentionPolicy(
        completed_keep_recent=1,
        completed_max_records=2,
        completed_max_age_seconds=10_000,
        archive_max_records=1,
        archive_max_age_seconds=10_000,
    )
    outbox = _outbox(tmp_path, retention=policy)
    for index in range(4):
        outbox.enqueue(
            "session-a", f"turn-{index}", [{"role": "user", "content": str(index)}]
        )
        job = outbox.claim_next()
        assert job is not None
        assert outbox.complete(job)

    counts = outbox.counts()
    assert counts["completed"] == 2
    assert counts["archive"] == 1
    # Archive summaries remain idempotency tombstones while retained.
    archived_turn = next(
        f"turn-{index}"
        for index in range(4)
        if outbox.is_archived("session-a", f"turn-{index}")
    )
    assert (
        outbox.enqueue("session-a", archived_turn, [{"role": "user", "content": "old"}])
        is False
    )

    outbox.enqueue("session-a", "unfinished", [{"role": "user", "content": "不能清理"}])
    outbox.cleanup(now=time.time() + 1_000_000)
    assert outbox.get("session-a", "unfinished")["status"] == "pending"


def test_cleanup_never_removes_a_claimed_projection(tmp_path):
    outbox = _outbox(tmp_path)
    assert outbox.enqueue("session-a", "actively-projecting", [])
    active = outbox.claim_next()
    assert active is not None
    outbox.cleanup(now=time.time() + 1_000_000)
    assert outbox.get("session-a", "actively-projecting")["status"] == "claimed"


def test_expired_archive_tombstone_allows_deliberate_reentry(tmp_path):
    policy = OutboxRetentionPolicy(
        completed_keep_recent=0,
        completed_max_records=0,
        completed_max_age_seconds=0,
        archive_max_records=10,
        archive_max_age_seconds=1,
    )
    outbox = _outbox(tmp_path, retention=policy)
    assert outbox.enqueue("session-a", "turn-1", [])
    job = outbox.claim_next()
    assert job is not None
    assert outbox.complete(job)
    assert outbox.is_archived("session-a", "turn-1")

    outbox.cleanup(now=time.time() + 2)
    assert not outbox.is_archived("session-a", "turn-1")
    # Archive retention is explicitly a bounded de-duplication window.
    assert outbox.enqueue("session-a", "turn-1", []) is True


def test_legacy_json_ledger_is_imported_once(tmp_path):
    ledger = tmp_path / "memory.yaml.ltm-turns.json"
    ledger.write_text(
        json.dumps({"version": 1, "completed": [json.dumps(["session-a", "turn-1"])]}),
        encoding="utf-8",
    )
    outbox = _outbox(tmp_path)

    assert outbox.import_legacy_ledger(ledger) == 1
    assert outbox.get("session-a", "turn-1")["status"] == "completed"
    assert outbox.import_legacy_ledger(ledger) == 0


def test_connections_close_so_windows_can_remove_database_and_wal_files(tmp_path):
    outbox = _outbox(tmp_path)
    assert outbox.enqueue("session-a", "turn-1", [])
    assert outbox.get("session-a", "turn-1") is not None

    # Windows refuses removal while even a read connection remains open.  Every
    # public operation must close its SQLite/WAL connection before returning.
    for path in (
        outbox.path,
        outbox.path.with_name(outbox.path.name + "-wal"),
        outbox.path.with_name(outbox.path.name + "-shm"),
    ):
        if path.exists():
            os.remove(path)
    assert not outbox.path.exists()


def test_lease_heartbeat_prevents_reclaim_during_long_projection(tmp_path):
    outbox = _outbox(tmp_path, lease_seconds=0.2)
    assert outbox.enqueue("session-a", "turn-1", [])
    job = outbox.claim_next()
    assert job is not None

    # Simulate a slow projection which renews before each short lease expires.
    for _ in range(3):
        time.sleep(0.04)
        assert outbox.renew(job)
        assert _outbox(tmp_path, lease_seconds=0.2).claim_next() is None
    assert outbox.complete(job)


def test_target_writer_lease_serializes_different_ready_rows(tmp_path):
    outbox = _outbox(tmp_path)
    assert outbox.enqueue("session-a", "turn-1", [])
    assert outbox.enqueue("session-a", "turn-2", [])
    first = outbox.claim_next()
    assert first is not None

    # A second worker must not start another LLM/YAML projection for this
    # target until the first writer releases its target-wide lease.
    assert _outbox(tmp_path).claim_next() is None
    assert outbox.fail(first.session_id, first.turn_id, first.lease_token, "retry")


def test_legacy_projection_lease_blocks_identified_work_and_releases(tmp_path):
    outbox = _outbox(tmp_path)
    assert outbox.enqueue("session-a", "turn-1", [])

    legacy_lease = outbox.acquire_projection_writer()
    assert legacy_lease is not None
    # A legacy caller without a stable turn ID owns the same target-wide lease
    # as identified work, so no second LLM/YAML projection can start.
    assert _outbox(tmp_path).claim_next() is None
    assert outbox.release_projection_writer(legacy_lease) is True

    identified = _outbox(tmp_path).claim_next()
    assert identified is not None
    assert outbox.acquire_projection_writer() is None
    assert _outbox(tmp_path).complete(identified) is True

    released_legacy_lease = outbox.acquire_projection_writer()
    assert released_legacy_lease is not None
    assert outbox.release_projection_writer(released_legacy_lease) is True


def test_reclaimed_job_fences_old_worker_from_yaml_and_completion(tmp_path):
    """A lease loser may finish its LLM call, but can never commit its result."""
    first_worker = _outbox(tmp_path, lease_seconds=0.02)
    assert first_worker.enqueue("session-a", "turn-1", [])
    first = first_worker.claim_next()
    assert first is not None

    time.sleep(0.03)
    second_worker = _outbox(tmp_path, lease_seconds=30)
    second = second_worker.claim_next()
    assert second is not None
    assert second.fencing_token > first.fencing_token

    manager = MemoryManager(str(tmp_path / "memory.yaml"))
    with pytest.raises(ProjectionFenceLost):
        with projection_mutation_scope(lambda: first_worker.projection_fence(first)):
            manager.add(
                "旧 worker 的写入必须被拒绝",
                "测试",
                projection_operation_id="old-fence",
                projection_identity=("session-a", "turn-1"),
            )
    assert manager.show() == []
    assert first_worker.complete(first) is False
    assert second_worker.get("session-a", "turn-1")["status"] == "claimed"

    with projection_mutation_scope(lambda: second_worker.projection_fence(second)):
        manager.add(
            "新 worker 的写入保留",
            "测试",
            projection_operation_id="new-fence",
            projection_identity=("session-a", "turn-1"),
        )
    assert second_worker.complete(second) is True
    assert manager.show()[0]["description"] == "新 worker 的写入保留"


def test_reclaimed_legacy_writer_fences_old_yaml_mutation(tmp_path):
    """Legacy writers use the same target fence as identified outbox jobs."""
    first_worker = _outbox(tmp_path, lease_seconds=0.02)
    first = first_worker.acquire_projection_writer()
    assert first is not None
    time.sleep(0.03)
    second_worker = _outbox(tmp_path, lease_seconds=30)
    second = second_worker.acquire_projection_writer()
    assert second is not None
    assert second.fencing_token > first.fencing_token

    manager = MemoryManager(str(tmp_path / "memory.yaml"))
    with pytest.raises(ProjectionFenceLost):
        with projection_mutation_scope(lambda: first_worker.projection_fence(first)):
            manager.add("旧 writer", "测试")
    assert first_worker.release_projection_writer(first) is False
    assert manager.show() == []

    with projection_mutation_scope(lambda: second_worker.projection_fence(second)):
        manager.add("新 writer", "测试")
    assert second_worker.release_projection_writer(second) is True
    assert manager.show()[0]["description"] == "新 writer"


def test_projection_fence_compaction_keeps_retained_identity(tmp_path):
    mm = MemoryManager(str(tmp_path / "memory.yaml"))
    kept = ("session-a", "turn-1")
    expired = ("session-a", "turn-0")
    mm.add(
        "保留的操作", "身份", projection_operation_id="kept", projection_identity=kept
    )
    mm.add(
        "可压缩的操作",
        "身份",
        projection_operation_id="expired",
        projection_identity=expired,
    )

    assert mm.prune_projection_operations({kept}) == 1
    assert mm.get_projection_operation("kept") is not None
    assert mm.get_projection_operation("expired") is None
