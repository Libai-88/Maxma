"""Durable, fenced journal for closed-registry workflow runs."""
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

from tools.workflow.registry import RegisteredWorkflow


TERMINAL_RUN_STATUSES = frozenset({"succeeded", "failed", "cancelled"})
ACTIVE_RUN_STATUSES = frozenset({"queued", "running"})


@dataclass(frozen=True)
class WorkflowRun:
    run_id: str
    parent_session_id: str
    parent_turn_id: str | None
    workflow_id: str
    workflow_version: int
    status: str
    current_step_id: str | None
    failure_code: str | None
    cancel_reason: str | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WorkflowStep:
    run_id: str
    step_id: str
    position: int
    status: str
    safe_to_resume: bool
    attempts: int
    checkpoint: dict[str, Any] | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WorkflowStepLease:
    run_id: str
    step_id: str
    lease_token: str
    fencing_token: int


class WorkflowJournalStore:
    """SQLite journal with one owner lease per registered workflow step."""

    def __init__(self, db_path: str | Path, *, lease_seconds: float = 60.0,
                 clock: Callable[[], float] | None = None) -> None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        self.path = Path(db_path)
        self.lease_seconds = lease_seconds
        self._clock = clock or time.time
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.path), isolation_level=None, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    run_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    parent_session_id TEXT NOT NULL,
                    parent_turn_id TEXT,
                    workflow_id TEXT NOT NULL,
                    workflow_version INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
                    current_step_id TEXT,
                    failure_code TEXT,
                    cancel_reason TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    completed_at REAL
                );
                CREATE TABLE IF NOT EXISTS workflow_step_journal (
                    run_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
                    safe_to_resume INTEGER NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    checkpoint_json TEXT,
                    lease_token TEXT,
                    lease_expires_at REAL,
                    fencing_token INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    completed_at REAL,
                    PRIMARY KEY(run_id, step_id),
                    FOREIGN KEY(run_id) REFERENCES workflow_runs(run_id)
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_runs_parent
                    ON workflow_runs(parent_session_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_workflow_steps_ready
                    ON workflow_step_journal(run_id, position, status);
                """
            )

    @staticmethod
    def idempotency_key(parent_session_id: str, parent_turn_id: str | None,
                        workflow_id: str) -> str:
        material = "\x1f".join((parent_session_id, parent_turn_id or "", workflow_id))
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def submit(self, *, parent_session_id: str, parent_turn_id: str | None,
               definition: RegisteredWorkflow) -> WorkflowRun:
        now = self._clock()
        key = self.idempotency_key(parent_session_id, parent_turn_id, definition.id)
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM workflow_runs WHERE idempotency_key = ?", (key,)
            ).fetchone()
            if existing is not None:
                connection.commit()
                return self._row_to_run(existing)
            run_id = uuid.uuid4().hex
            connection.execute(
                """INSERT INTO workflow_runs (
                    run_id, idempotency_key, parent_session_id, parent_turn_id,
                    workflow_id, workflow_version, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)""",
                (run_id, key, parent_session_id, parent_turn_id, definition.id,
                 definition.version, now, now),
            )
            connection.executemany(
                """INSERT INTO workflow_step_journal (
                    run_id, step_id, position, status, safe_to_resume, created_at, updated_at
                ) VALUES (?, ?, ?, 'queued', ?, ?, ?)""",
                [(run_id, step.id, position, int(step.safe_to_resume), now, now)
                 for position, step in enumerate(definition.steps)],
            )
            row = connection.execute("SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)).fetchone()
            connection.commit()
        return self._row_to_run(row)

    def get(self, run_id: str) -> WorkflowRun | None:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)).fetchone()
        return self._row_to_run(row) if row is not None else None

    def list_parent_runs(self, parent_session_id: str, *, limit: int = 50) -> list[WorkflowRun]:
        if limit < 1:
            return []
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM workflow_runs WHERE parent_session_id = ?
                   ORDER BY created_at DESC LIMIT ?""", (parent_session_id, min(limit, 100))
            ).fetchall()
        return [self._row_to_run(row) for row in rows]

    def list_steps(self, run_id: str) -> list[WorkflowStep]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM workflow_step_journal WHERE run_id = ? ORDER BY position", (run_id,)
            ).fetchall()
        return [self._row_to_step(row) for row in rows]

    def claim_next_step(self, run_id: str) -> WorkflowStepLease | None:
        """Lease exactly the next queued step; previous checkpoints stay immutable."""
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            run = connection.execute("SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)).fetchone()
            if run is None or run["status"] in TERMINAL_RUN_STATUSES:
                connection.commit()
                return None
            step = connection.execute(
                """SELECT * FROM workflow_step_journal WHERE run_id = ? AND status = 'queued'
                   ORDER BY position LIMIT 1""", (run_id,)
            ).fetchone()
            if step is None:
                connection.commit()
                return None
            token = uuid.uuid4().hex
            fence = int(step["fencing_token"]) + 1
            connection.execute(
                """UPDATE workflow_step_journal SET status = 'running', attempts = attempts + 1,
                    lease_token = ?, lease_expires_at = ?, fencing_token = ?, updated_at = ?
                   WHERE run_id = ? AND step_id = ? AND status = 'queued'""",
                (token, now + self.lease_seconds, fence, now, run_id, step["step_id"]),
            )
            connection.execute(
                """UPDATE workflow_runs SET status = 'running', current_step_id = ?,
                    failure_code = NULL, updated_at = ? WHERE run_id = ?""",
                (step["step_id"], now, run_id),
            )
            connection.commit()
        return WorkflowStepLease(run_id, str(step["step_id"]), token, fence)

    def complete_step(self, lease: WorkflowStepLease, checkpoint: dict[str, Any]) -> bool:
        """Commit a JSON checkpoint once, then expose the next step as queued."""
        serialized = json.dumps(checkpoint, sort_keys=True, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > 16 * 1024:
            raise ValueError("workflow checkpoint exceeds the size limit")
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """UPDATE workflow_step_journal SET status = 'succeeded', checkpoint_json = ?,
                    lease_token = NULL, lease_expires_at = NULL, updated_at = ?, completed_at = ?
                   WHERE run_id = ? AND step_id = ? AND status = 'running'
                     AND lease_token = ? AND fencing_token = ?""",
                (serialized, now, now, lease.run_id, lease.step_id, lease.lease_token, lease.fencing_token),
            )
            if cursor.rowcount != 1:
                connection.commit()
                return False
            remaining = connection.execute(
                """SELECT COUNT(*) AS count FROM workflow_step_journal
                   WHERE run_id = ? AND status != 'succeeded'""", (lease.run_id,)
            ).fetchone()["count"]
            if remaining == 0:
                connection.execute(
                    """UPDATE workflow_runs SET status = 'succeeded', current_step_id = NULL,
                       updated_at = ?, completed_at = ? WHERE run_id = ?""",
                    (now, now, lease.run_id),
                )
            else:
                connection.execute(
                    "UPDATE workflow_runs SET status = 'queued', current_step_id = NULL, updated_at = ? WHERE run_id = ?",
                    (now, lease.run_id),
                )
            connection.commit()
        return True

    def fail_step(self, lease: WorkflowStepLease, failure_code: str = "workflow_step_failed") -> bool:
        now = self._clock()
        code = failure_code[:120]
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """UPDATE workflow_step_journal SET status = 'failed', lease_token = NULL,
                    lease_expires_at = NULL, updated_at = ?, completed_at = ?
                   WHERE run_id = ? AND step_id = ? AND status = 'running'
                     AND lease_token = ? AND fencing_token = ?""",
                (now, now, lease.run_id, lease.step_id, lease.lease_token, lease.fencing_token),
            )
            if cursor.rowcount == 1:
                connection.execute(
                    """UPDATE workflow_runs SET status = 'failed', failure_code = ?, current_step_id = NULL,
                       updated_at = ?, completed_at = ? WHERE run_id = ?""",
                    (code, now, now, lease.run_id),
                )
            connection.commit()
        return cursor.rowcount == 1

    def cancel(self, run_id: str, reason: str = "cancelled_by_user") -> bool:
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """UPDATE workflow_runs SET status = 'cancelled', cancel_reason = ?, current_step_id = NULL,
                    updated_at = ?, completed_at = ? WHERE run_id = ? AND status IN ('queued','running')""",
                (reason[:120], now, now, run_id),
            )
            if cursor.rowcount == 1:
                connection.execute(
                    """UPDATE workflow_step_journal SET status = 'cancelled', lease_token = NULL,
                        lease_expires_at = NULL, fencing_token = fencing_token + 1, updated_at = ?, completed_at = ?
                       WHERE run_id = ? AND status IN ('queued','running')""", (now, now, run_id)
                )
            connection.commit()
        return cursor.rowcount == 1

    def cancel_parent(self, parent_session_id: str, reason: str = "parent_session_closed") -> list[str]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT run_id FROM workflow_runs WHERE parent_session_id = ? AND status IN ('queued','running')",
                (parent_session_id,),
            ).fetchall()
        run_ids = [str(row["run_id"]) for row in rows]
        return [run_id for run_id in run_ids if self.cancel(run_id, reason)]

    def resume(self, run_id: str) -> bool:
        """Retry only a failed step that was registered as restart-safe."""
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            run = connection.execute("SELECT * FROM workflow_runs WHERE run_id = ?", (run_id,)).fetchone()
            step = connection.execute(
                """SELECT * FROM workflow_step_journal WHERE run_id = ? AND status = 'failed'
                   ORDER BY position LIMIT 1""", (run_id,)
            ).fetchone()
            if run is None or run["status"] != "failed" or step is None or not bool(step["safe_to_resume"]):
                connection.commit()
                return False
            connection.execute(
                """UPDATE workflow_step_journal SET status = 'queued', lease_token = NULL,
                    lease_expires_at = NULL, fencing_token = fencing_token + 1, updated_at = ?, completed_at = NULL
                   WHERE run_id = ? AND step_id = ?""", (now, run_id, step["step_id"])
            )
            connection.execute(
                """UPDATE workflow_runs SET status = 'queued', failure_code = NULL, cancel_reason = NULL,
                    current_step_id = NULL, updated_at = ?, completed_at = NULL WHERE run_id = ?""", (now, run_id)
            )
            connection.commit()
        return True

    def recover_pending(self) -> list[str]:
        """Return durable queued work and recover expired safe work.

        A controlled shutdown intentionally returns a safe in-flight step to
        ``queued`` before its process exits.  A new manager must schedule that
        row immediately rather than waiting for a lease timeout.  After an
        unclean exit, only an expired safe lease is requeued; unsafe work is
        made terminal and therefore cannot be replayed.
        """
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            queued_rows = connection.execute(
                "SELECT run_id FROM workflow_runs WHERE status = 'queued'"
            ).fetchall()
            rows = connection.execute(
                """SELECT run_id, step_id, safe_to_resume FROM workflow_step_journal
                   WHERE status = 'running' AND lease_expires_at <= ?""", (now,)
            ).fetchall()
            recovered: list[str] = []
            for row in rows:
                run_id = str(row["run_id"])
                if bool(row["safe_to_resume"]):
                    connection.execute(
                        """UPDATE workflow_step_journal SET status = 'queued', lease_token = NULL,
                            lease_expires_at = NULL, fencing_token = fencing_token + 1, updated_at = ?
                           WHERE run_id = ? AND step_id = ? AND status = 'running'""",
                        (now, run_id, row["step_id"]),
                    )
                    connection.execute(
                        """UPDATE workflow_runs SET status = 'queued', current_step_id = NULL,
                            updated_at = ? WHERE run_id = ? AND status = 'running'""", (now, run_id)
                    )
                    recovered.append(run_id)
                else:
                    connection.execute(
                        """UPDATE workflow_step_journal SET status = 'failed', lease_token = NULL,
                            lease_expires_at = NULL, updated_at = ?, completed_at = ?
                           WHERE run_id = ? AND step_id = ? AND status = 'running'""",
                        (now, now, run_id, row["step_id"]),
                    )
                    connection.execute(
                        """UPDATE workflow_runs SET status = 'failed', failure_code = 'restart_unsafe_step',
                            current_step_id = NULL, updated_at = ?, completed_at = ? WHERE run_id = ?""",
                        (now, now, run_id),
                    )
            connection.commit()
        return list(dict.fromkeys([str(row["run_id"]) for row in queued_rows] + recovered))

    def prepare_for_restart(self, run_id: str) -> bool:
        """Release a live safe step during controlled shutdown for immediate recovery."""
        now = self._clock()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            step = connection.execute(
                """SELECT * FROM workflow_step_journal WHERE run_id = ? AND status = 'running'
                   ORDER BY position LIMIT 1""", (run_id,)
            ).fetchone()
            if step is None or not bool(step["safe_to_resume"]):
                connection.commit()
                return False
            connection.execute(
                """UPDATE workflow_step_journal SET status = 'queued', lease_token = NULL,
                    lease_expires_at = NULL, fencing_token = fencing_token + 1, updated_at = ?
                   WHERE run_id = ? AND step_id = ?""", (now, run_id, step["step_id"])
            )
            connection.execute(
                """UPDATE workflow_runs SET status = 'queued', current_step_id = NULL,
                    updated_at = ? WHERE run_id = ? AND status = 'running'""", (now, run_id)
            )
            connection.commit()
        return True

    @staticmethod
    def _row_to_run(row: sqlite3.Row) -> WorkflowRun:
        return WorkflowRun(
            run_id=str(row["run_id"]), parent_session_id=str(row["parent_session_id"]),
            parent_turn_id=row["parent_turn_id"], workflow_id=str(row["workflow_id"]),
            workflow_version=int(row["workflow_version"]), status=str(row["status"]),
            current_step_id=row["current_step_id"], failure_code=row["failure_code"],
            cancel_reason=row["cancel_reason"], created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    @staticmethod
    def _row_to_step(row: sqlite3.Row) -> WorkflowStep:
        checkpoint = row["checkpoint_json"]
        return WorkflowStep(
            run_id=str(row["run_id"]), step_id=str(row["step_id"]), position=int(row["position"]),
            status=str(row["status"]), safe_to_resume=bool(row["safe_to_resume"]),
            attempts=int(row["attempts"]), checkpoint=json.loads(checkpoint) if checkpoint else None,
            created_at=float(row["created_at"]), updated_at=float(row["updated_at"]),
        )
