"""Focused retry, terminal-failure, and migration contracts for the LTM outbox."""

from __future__ import annotations

import sqlite3

from memory.ltm_outbox import LongTermMemoryOutbox
from memory.narrative import LTMErrorKind, classify_ltm_error


class _Clock:
    def __init__(self, now: float = 1_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


class _StatusError(RuntimeError):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"upstream returned {status_code}")
        self.status_code = status_code


def _outbox(tmp_path, clock: _Clock, **kwargs) -> LongTermMemoryOutbox:
    return LongTermMemoryOutbox(
        tmp_path / "memory.ltm-outbox.sqlite3", clock=clock, **kwargs
    )


def test_classifies_permanent_and_temporary_ltm_errors():
    assert classify_ltm_error(_StatusError(401)) is LTMErrorKind.AUTHENTICATION_FAILED
    assert classify_ltm_error(_StatusError(403)) is LTMErrorKind.PERMISSION_DENIED
    assert classify_ltm_error(_StatusError(400)) is LTMErrorKind.INVALID_REQUEST
    assert classify_ltm_error(_StatusError(429)) is LTMErrorKind.RATE_LIMITED
    assert classify_ltm_error(ConnectionError("offline")) is LTMErrorKind.NETWORK_ERROR
    assert classify_ltm_error(RuntimeError("unexpected")) is LTMErrorKind.UNKNOWN


def test_retry_delay_is_bounded_decorrelated_and_uses_injected_sources(tmp_path):
    clock = _Clock()
    samples = iter((1.0, 0.5, 1.0))
    outbox = _outbox(
        tmp_path,
        clock,
        retry_base_seconds=10,
        retry_max_seconds=60,
        random_source=lambda: next(samples),
    )
    assert outbox.enqueue("session-a", "turn-1", [])

    first = outbox.claim_next()
    assert first is not None
    assert outbox.fail(
        first.session_id,
        first.turn_id,
        first.lease_token,
        "offline",
        failure_code="network_error",
        fencing_token=first.fencing_token,
    )
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    assert state["retry_delay_seconds"] == 10
    assert state["available_at"] == 1_010
    assert state["failure_code"] == "network_error"

    clock.now = 1_010
    second = outbox.claim_next()
    assert second is not None
    assert outbox.fail(
        second.session_id,
        second.turn_id,
        second.lease_token,
        "still offline",
        fencing_token=second.fencing_token,
    )
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    # attempt two samples in [base=10, max(exponential=20, prior*3=30)];
    # a fixed sample proves the decision is reproducible without sleeping.
    assert state["retry_delay_seconds"] == 20
    assert state["available_at"] == 1_030

    clock.now = 1_030
    third = outbox.claim_next()
    assert third is not None
    assert outbox.fail(
        third.session_id,
        third.turn_id,
        third.lease_token,
        "still offline",
        fencing_token=third.fencing_token,
    )
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    assert 10 <= state["retry_delay_seconds"] <= 60
    assert state["retry_delay_seconds"] == 60


def test_permanent_failure_is_a_queryable_dead_letter_and_releases_writer(tmp_path):
    clock = _Clock()
    outbox = _outbox(tmp_path, clock)
    assert outbox.enqueue("session-a", "turn-1", [])
    assert outbox.enqueue("session-a", "turn-2", [])
    first = outbox.claim_next()
    assert first is not None

    assert outbox.abandon(first, "authentication_failed", "invalid credentials")
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    assert state["status"] == "abandoned"
    assert state["failure_code"] == "authentication_failed"
    assert outbox.counts()["abandoned"] == 1
    assert outbox.dead_letters() == [
        {
            "session_id": "session-a",
            "turn_id": "turn-1",
            "attempts": 1,
            "failure_code": "authentication_failed",
            "last_error": "invalid credentials",
            "completed_at": 1_000.0,
            "updated_at": 1_000.0,
        }
    ]

    # Terminal handling releases the target-wide writer lease without making
    # the abandoned identity eligible for another projection.
    second = outbox.claim_next()
    assert second is not None
    assert second.turn_id == "turn-2"
    assert outbox.enqueue("session-a", "turn-1", []) is False


def test_diagnostic_summary_never_includes_payload_or_exception_text(tmp_path):
    clock = _Clock()
    outbox = _outbox(tmp_path, clock, retry_base_seconds=10, random_source=lambda: 0)
    assert outbox.enqueue("session-a", "turn-1", [{"content": "private message"}])
    job = outbox.claim_next()
    assert job is not None
    assert outbox.fail(
        job.session_id,
        job.turn_id,
        job.lease_token,
        "token=secret private message",
        failure_code="rate_limited",
        fencing_token=job.fencing_token,
    )
    assert outbox.diagnostic_summary() == {
        "status": "degraded",
        "reason_code": "rate_limited",
        "retry_at": 1_010.0,
        "updated_at": 1_000.0,
        "summary": "Long-term memory will retry.",
    }


def test_existing_three_state_database_migrates_without_losing_pending_work(tmp_path):
    path = tmp_path / "memory.ltm-outbox.sqlite3"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE ltm_outbox (
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'completed')),
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at REAL NOT NULL,
            lease_token TEXT,
            lease_expires_at REAL,
            last_error TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            completed_at REAL,
            PRIMARY KEY (session_id, turn_id)
        );
        INSERT INTO ltm_outbox VALUES (
            'session-a', 'turn-1', '[]', 'pending', 0, 0, NULL, NULL,
            NULL, 0, 0, NULL
        );
        """
    )
    conn.close()

    outbox = LongTermMemoryOutbox(path, clock=_Clock())
    job = outbox.claim_next()
    assert job is not None
    assert job.turn_id == "turn-1"
    state = outbox.get("session-a", "turn-1")
    assert state is not None
    assert state["retry_delay_seconds"] == 0
    assert state["failure_code"] is None
