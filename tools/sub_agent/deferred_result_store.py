"""Durable state for asynchronous, read-only sub-agent runs.

The store is deliberately independent of WebSocket/session lifetime.  It uses
leases plus a monotonically increasing fencing token, so a worker that loses a
lease (or is cancelled after a user cancellation) cannot overwrite a newer
terminal state.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})
ACTIVE_STATUSES = frozenset({"queued", "running"})


@dataclass(frozen=True)
class DeferredRun:
    run_id: str
    parent_session_id: str | None
    parent_turn_id: str | None
    task: str
    input_summary: str
    delegation_snapshot: dict[str, Any]
    status: str
    result_ref: str | None
    result: str | None
    error_summary: str | None
    cancel_reason: str | None
    deadline_at: float | None
    retryable: bool
    attempts: int
    fencing_token: int
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class DeferredRunLease:
    run_id: str
    lease_token: str
    fencing_token: int


class DeferredResultStore:
    """SQLite-backed run journal with idempotent submission and result delivery."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        lease_seconds: float = 180.0,
        clock: Callable[[], float] | None = None,
    ) -> None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self.path = Path(db_path)
        self.lease_seconds = lease_seconds
        self._clock = clock or time.time
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), isolation_level=None, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    def _initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS deferred_subagent_runs (
                    run_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    parent_session_id TEXT,
                    parent_turn_id TEXT,
                    task TEXT NOT NULL,
                    input_summary TEXT NOT NULL,
                    delegation_snapshot TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
                    result_ref TEXT,
                    result TEXT,
                    error_summary TEXT,
                    cancel_reason TEXT,
                    deadline_at REAL,
                    retryable INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    lease_token TEXT,
                    lease_expires_at REAL,
                    fencing_token INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    completed_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_deferred_subagent_ready
                    ON deferred_subagent_runs(status, deadline_at, created_at);
                CREATE INDEX IF NOT EXISTS idx_deferred_subagent_parent
                    ON deferred_subagent_runs(parent_session_id, created_at DESC);
                """
            )

    @staticmethod
    def idempotency_key(
        parent_session_id: str | None, parent_turn_id: str | None, task: str
    ) -> str:
        material = "\x1f".join((parent_session_id or "", parent_turn_id or "", task))
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def submit(
        self,
        *,
        parent_session_id: str | None,
        parent_turn_id: str | None,
        task: str,
        input_summary: str,
        delegation_snapshot: dict[str, Any],
        deadline_at: float | None,
        retryable: bool,
        idempotency_key: str | None = None,
    ) -> DeferredRun:
        if not task.strip():
            raise ValueError("task must not be empty")
        now = self._clock()
        key = idempotency_key or self.idempotency_key(parent_session_id, parent_turn_id, task)
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing = conn.execute(
                "SELECT * FROM deferred_subagent_runs WHERE idempotency_key = ?", (key,)
            ).fetchone()
            if existing is not None:
                conn.commit()
                return self._row_to_run(existing)
            run_id = uuid.uuid4().hex
            conn.execute(
                """INSERT INTO deferred_subagent_runs (
                       run_id, idempotency_key, parent_session_id, parent_turn_id, task,
                       input_summary, delegation_snapshot, status, deadline_at, retryable,
                       created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)""",
                (
                    run_id, key, parent_session_id, parent_turn_id, task,
                    input_summary[:500], json.dumps(delegation_snapshot, sort_keys=True),
                    deadline_at, int(retryable), now, now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM deferred_subagent_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            conn.commit()
        return self._row_to_run(row)

    def get(self, run_id: str) -> DeferredRun | None:
        with self._connection() as conn:
            row = conn.execute(
                "SELECT * FROM deferred_subagent_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
        return self._row_to_run(row) if row is not None else None

    def list_parent_runs(self, parent_session_id: str, limit: int = 100) -> list[DeferredRun]:
        if limit < 1:
            return []
        with self._connection() as conn:
            rows = conn.execute(
                """SELECT * FROM deferred_subagent_runs WHERE parent_session_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (parent_session_id, limit),
            ).fetchall()
        return [self._row_to_run(row) for row in rows]

    def active_run_ids_for_parent(self, parent_session_id: str) -> list[str]:
        with self._connection() as conn:
            rows = conn.execute(
                """SELECT run_id FROM deferred_subagent_runs
                   WHERE parent_session_id = ? AND status IN ('queued', 'running')""",
                (parent_session_id,),
            ).fetchall()
        return [str(row["run_id"]) for row in rows]

    def claim(self, run_id: str) -> DeferredRunLease | None:
        """Claim queued work, recovering an expired lease only when retryable."""
        now = self._clock()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT * FROM deferred_subagent_runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            if row is None or row["status"] in TERMINAL_STATUSES:
                conn.commit()
                return None
            if row["deadline_at"] is not None and float(row["deadline_at"]) <= now:
                conn.execute(
                    """UPDATE deferred_subagent_runs SET status = 'failed', error_summary = ?,
                       lease_token = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
                       WHERE run_id = ?""",
                    ("deadline_exceeded", now, now, run_id),
                )
                conn.commit()
                return None
            if row["status"] == "running":
                expired = row["lease_expires_at"] is not None and float(row["lease_expires_at"]) <= now
                if not expired or not bool(row["retryable"]):
                    conn.commit()
                    return None
            lease_token = uuid.uuid4().hex
            fence = int(row["fencing_token"]) + 1
            conn.execute(
                """UPDATE deferred_subagent_runs
                   SET status = 'running', lease_token = ?, lease_expires_at = ?,
                       fencing_token = ?, attempts = attempts + 1, updated_at = ?
                   WHERE run_id = ?""",
                (lease_token, now + self.lease_seconds, fence, now, run_id),
            )
            conn.commit()
        return DeferredRunLease(run_id, lease_token, fence)

    def recover_expired(self) -> list[str]:
        """Return safe-to-retry runs after process restart or worker loss.

        Only retryable (currently tool-free) runs are returned.  Other stale
        runs remain running for explicit operator inspection rather than being
        silently repeated.
        """
        now = self._clock()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """SELECT run_id FROM deferred_subagent_runs
                   WHERE status = 'running' AND retryable = 1 AND lease_expires_at <= ?""",
                (now,),
            ).fetchall()
            if rows:
                conn.execute(
                    """UPDATE deferred_subagent_runs SET status = 'queued', lease_token = NULL,
                       lease_expires_at = NULL, updated_at = ?
                       WHERE status = 'running' AND retryable = 1 AND lease_expires_at <= ?""",
                    (now, now),
                )
            conn.commit()
        return [str(row["run_id"]) for row in rows]

    def complete(self, lease: DeferredRunLease, result: str, *, result_ref: str | None = None) -> bool:
        return self._terminal_update(lease, "succeeded", result=result, result_ref=result_ref)

    def fail(self, lease: DeferredRunLease, error_summary: str) -> bool:
        return self._terminal_update(lease, "failed", error_summary=error_summary)

    def cancel(self, run_id: str, reason: str = "cancelled_by_user") -> bool:
        now = self._clock()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                """UPDATE deferred_subagent_runs
                   SET status = 'cancelled', cancel_reason = ?, lease_token = NULL,
                       lease_expires_at = NULL, fencing_token = fencing_token + 1,
                       updated_at = ?, completed_at = ?
                   WHERE run_id = ? AND status IN ('queued', 'running')""",
                (reason[:500], now, now, run_id),
            )
            conn.commit()
        return cursor.rowcount == 1

    def _terminal_update(
        self,
        lease: DeferredRunLease,
        status: str,
        *,
        result: str | None = None,
        result_ref: str | None = None,
        error_summary: str | None = None,
    ) -> bool:
        now = self._clock()
        with self._connection() as conn:
            cursor = conn.execute(
                """UPDATE deferred_subagent_runs
                   SET status = ?, result = ?, result_ref = ?, error_summary = ?,
                       lease_token = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
                   WHERE run_id = ? AND status = 'running' AND lease_token = ?
                     AND fencing_token = ?""",
                (status, result, result_ref, error_summary[:500] if error_summary else None,
                 now, now, lease.run_id, lease.lease_token, lease.fencing_token),
            )
        return cursor.rowcount == 1

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> DeferredRun:
        return DeferredRun(
            run_id=str(row["run_id"]),
            parent_session_id=row["parent_session_id"],
            parent_turn_id=row["parent_turn_id"],
            task=str(row["task"]),
            input_summary=str(row["input_summary"]),
            delegation_snapshot=json.loads(str(row["delegation_snapshot"])),
            status=str(row["status"]),
            result_ref=row["result_ref"],
            result=row["result"],
            error_summary=row["error_summary"],
            cancel_reason=row["cancel_reason"],
            deadline_at=row["deadline_at"],
            retryable=bool(row["retryable"]),
            attempts=int(row["attempts"]),
            fencing_token=int(row["fencing_token"]),
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )
