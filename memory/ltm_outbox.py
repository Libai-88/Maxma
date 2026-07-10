"""Durable transactional outbox for long-term memory projections.

The memory YAML file is an external projection from SQLite's perspective.  The
outbox therefore gives durable *at-least-once* delivery, leases work so two
workers cannot process the same row concurrently, and retains a bounded audit
trail.  It cannot make an arbitrary LLM/YAML side effect part of SQLite's
transaction; callers must treat projection code as idempotent where possible.
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
from typing import Any


@dataclass(frozen=True)
class OutboxRetentionPolicy:
    """Bound completed rows and their de-duplication tombstones.

    Pending and claimed rows are never compacted.  Archive rows are retained
    only for the configured bounded horizon: once an archive tombstone expires,
    a matching old identity is intentionally eligible to enter again.  This is
    a documented de-duplication window, not permanent exactly-once history.
    """

    completed_keep_recent: int = 500
    completed_max_records: int = 2_000
    completed_max_age_seconds: float = 30 * 24 * 60 * 60
    archive_max_records: int = 5_000
    archive_max_age_seconds: float = 180 * 24 * 60 * 60

    def __post_init__(self) -> None:
        if self.completed_keep_recent < 0:
            raise ValueError("completed_keep_recent must be non-negative")
        if self.completed_max_records < self.completed_keep_recent:
            raise ValueError("completed_max_records must retain keep_recent records")
        if self.completed_max_age_seconds < 0 or self.archive_max_age_seconds < 0:
            raise ValueError("retention ages must be non-negative")
        if self.archive_max_records < 0:
            raise ValueError("archive_max_records must be non-negative")


@dataclass(frozen=True)
class OutboxJob:
    session_id: str
    turn_id: str
    payload: list[dict[str, Any]]
    lease_token: str
    fencing_token: int
    attempts: int


@dataclass(frozen=True)
class ProjectionWriterLease:
    """Opaque lease for legacy projections, including a monotonic fence."""

    lease_token: str
    fencing_token: int


class ProjectionFenceLost(RuntimeError):
    """A stale projector attempted to mutate the shared YAML target."""


class LongTermMemoryOutbox:
    """SQLite-backed queue with atomic enqueue, claim, completion and retry."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        retention: OutboxRetentionPolicy | None = None,
        projection_target: str | Path | None = None,
        lease_seconds: float = 300,
        retry_base_seconds: float = 1,
        retry_max_seconds: float = 300,
    ) -> None:
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")
        if retry_base_seconds < 0 or retry_max_seconds < retry_base_seconds:
            raise ValueError("invalid retry backoff configuration")
        self.path = Path(db_path)
        self._projection_target = Path(projection_target or self.path)
        self.retention = retention or OutboxRetentionPolicy()
        self.lease_seconds = lease_seconds
        self.retry_base_seconds = retry_base_seconds
        self.retry_max_seconds = retry_max_seconds
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), isolation_level=None, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    @contextmanager
    def _connection(self):
        """Yield a connection and always close it (important on Windows/WAL)."""
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    @property
    def _target_key(self) -> str:
        return str(self._projection_target.resolve())

    def _initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS ltm_outbox (
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
                CREATE INDEX IF NOT EXISTS idx_ltm_outbox_ready
                    ON ltm_outbox(status, available_at, created_at);
                CREATE INDEX IF NOT EXISTS idx_ltm_outbox_completed
                    ON ltm_outbox(status, completed_at DESC);

                CREATE TABLE IF NOT EXISTS ltm_outbox_archive (
                    session_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    payload_sha256 TEXT NOT NULL,
                    attempts INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    completed_at REAL NOT NULL,
                    archived_at REAL NOT NULL,
                    PRIMARY KEY (session_id, turn_id)
                );
                CREATE INDEX IF NOT EXISTS idx_ltm_outbox_archive_at
                    ON ltm_outbox_archive(archived_at DESC);

                CREATE TABLE IF NOT EXISTS ltm_outbox_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ltm_projection_writer (
                    target_key TEXT PRIMARY KEY,
                    lease_token TEXT NOT NULL,
                    fencing_token INTEGER NOT NULL DEFAULT 0,
                    lease_expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ltm_projection_fence (
                    target_key TEXT PRIMARY KEY,
                    last_token INTEGER NOT NULL
                );
                """
            )
            # Existing installations created the writer table before fencing.
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(ltm_projection_writer)")
            }
            if "fencing_token" not in columns:
                conn.execute(
                    "ALTER TABLE ltm_projection_writer "
                    "ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0"
                )

    @staticmethod
    def _next_fencing_token(conn: sqlite3.Connection, target_key: str) -> int:
        """Advance the target's durable sequence while holding BEGIN IMMEDIATE."""
        conn.execute(
            "INSERT OR IGNORE INTO ltm_projection_fence(target_key, last_token) "
            "VALUES (?, 0)",
            (target_key,),
        )
        conn.execute(
            "UPDATE ltm_projection_fence SET last_token = last_token + 1 "
            "WHERE target_key = ?",
            (target_key,),
        )
        return int(
            conn.execute(
                "SELECT last_token FROM ltm_projection_fence WHERE target_key = ?",
                (target_key,),
            ).fetchone()[0]
        )

    @staticmethod
    def _payload_json(messages: list[dict[str, Any]]) -> str:
        return json.dumps(
            messages, ensure_ascii=False, separators=(",", ":"), default=str
        )

    def import_legacy_ledger(self, ledger_path: str | Path) -> int:
        """Import the old JSON completion ledger once without trusting its contents."""
        ledger_path = Path(ledger_path)
        marker = "legacy-json-ledger-imported-v1"
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute(
                "SELECT 1 FROM ltm_outbox_meta WHERE key = ?", (marker,)
            ).fetchone():
                conn.commit()
                return 0
            imported = 0
            try:
                raw = (
                    json.loads(ledger_path.read_text(encoding="utf-8"))
                    if ledger_path.exists()
                    else {}
                )
                completed = raw.get("completed", []) if isinstance(raw, dict) else []
                now = time.time()
                for key in completed:
                    try:
                        session_id, turn_id = json.loads(key)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        continue
                    if not isinstance(session_id, str) or not isinstance(turn_id, str):
                        continue
                    cursor = conn.execute(
                        """INSERT OR IGNORE INTO ltm_outbox
                           (session_id, turn_id, payload, status, attempts, available_at,
                            created_at, updated_at, completed_at)
                           VALUES (?, ?, '[]', 'completed', 0, ?, ?, ?, ?)""",
                        (session_id, turn_id, now, now, now, now),
                    )
                    imported += cursor.rowcount
            except (OSError, ValueError, json.JSONDecodeError):
                # A bad historical ledger must not make memory startup fail.
                imported = 0
            conn.execute(
                "INSERT INTO ltm_outbox_meta(key, value) VALUES (?, '1')", (marker,)
            )
            conn.commit()
            return imported

    def enqueue(
        self, session_id: str, turn_id: str, messages: list[dict[str, Any]]
    ) -> bool:
        """Atomically create an identified task, or wake its pending retry.

        ``True`` means a new durable row was inserted.  A client retry of an
        existing pending row makes it immediately eligible, while claimed and
        completed rows remain untouched.
        """
        now = time.time()
        payload = self._payload_json(messages)
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            # A compact audit row deliberately remains a de-duplication tombstone
            # until archive retention expires. Without this check, compaction
            # would silently turn an old completed turn back into new work.
            if conn.execute(
                "SELECT 1 FROM ltm_outbox_archive WHERE session_id = ? AND turn_id = ?",
                (session_id, turn_id),
            ).fetchone():
                conn.commit()
                return False
            cursor = conn.execute(
                """INSERT OR IGNORE INTO ltm_outbox
                   (session_id, turn_id, payload, status, attempts, available_at, created_at, updated_at)
                   VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)""",
                (session_id, turn_id, payload, now, now, now),
            )
            created = cursor.rowcount == 1
            if not created:
                conn.execute(
                    """UPDATE ltm_outbox SET available_at = ?, updated_at = ?
                       WHERE session_id = ? AND turn_id = ? AND status = 'pending'""",
                    (now, now, session_id, turn_id),
                )
            conn.commit()
            return created

    def claim_next(self) -> OutboxJob | None:
        """Lease one ready task under ``BEGIN IMMEDIATE`` for cross-process safety."""
        now = time.time()
        lease_token = uuid.uuid4().hex
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            # A crashed worker's lease is recoverable; it remains at-least-once.
            conn.execute(
                """UPDATE ltm_outbox
                   SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
                       available_at = ?, updated_at = ?
                   WHERE status = 'claimed' AND lease_expires_at <= ?""",
                (now, now, now),
            )
            conn.execute(
                "DELETE FROM ltm_projection_writer WHERE target_key = ? AND lease_expires_at <= ?",
                (self._target_key, now),
            )
            if (
                conn.execute(
                    "SELECT 1 FROM ltm_projection_writer WHERE target_key = ?",
                    (self._target_key,),
                ).fetchone()
                is not None
            ):
                conn.commit()
                return None
            row = conn.execute(
                """SELECT session_id, turn_id, payload, attempts FROM ltm_outbox
                   WHERE status = 'pending' AND available_at <= ?
                   ORDER BY created_at, session_id, turn_id LIMIT 1""",
                (now,),
            ).fetchone()
            if row is None:
                conn.commit()
                return None
            fencing_token = self._next_fencing_token(conn, self._target_key)
            conn.execute(
                """UPDATE ltm_outbox
                   SET status = 'claimed', attempts = attempts + 1, lease_token = ?,
                       lease_expires_at = ?, updated_at = ?
                   WHERE session_id = ? AND turn_id = ? AND status = 'pending'""",
                (
                    lease_token,
                    now + self.lease_seconds,
                    now,
                    row["session_id"],
                    row["turn_id"],
                ),
            )
            conn.execute(
                "INSERT INTO ltm_projection_writer"
                "(target_key, lease_token, fencing_token, lease_expires_at) "
                "VALUES (?, ?, ?, ?)",
                (
                    self._target_key,
                    lease_token,
                    fencing_token,
                    now + self.lease_seconds,
                ),
            )
            conn.commit()
            try:
                payload = json.loads(row["payload"])
                if not isinstance(payload, list):
                    raise ValueError("payload must be a list")
            except (TypeError, ValueError, json.JSONDecodeError):
                # Preserve the row for retry with a clear error rather than drop data.
                self.fail(
                    row["session_id"],
                    row["turn_id"],
                    lease_token,
                    "invalid durable payload",
                )
                return None
            return OutboxJob(
                session_id=row["session_id"],
                turn_id=row["turn_id"],
                payload=payload,
                lease_token=lease_token,
                fencing_token=fencing_token,
                attempts=row["attempts"] + 1,
            )

    def acquire_projection_writer(self) -> ProjectionWriterLease | None:
        """Acquire the target-wide writer lease for a legacy projection.

        Legacy callers have no stable turn identity, so they deliberately keep
        their historic at-least-once delivery semantics.  They still must hold
        this same target lease as identified outbox jobs while invoking the LLM
        and updating YAML.
        """
        now = time.time()
        lease_token = uuid.uuid4().hex
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "DELETE FROM ltm_projection_writer "
                "WHERE target_key = ? AND lease_expires_at <= ?",
                (self._target_key, now),
            )
            try:
                fencing_token = self._next_fencing_token(conn, self._target_key)
                conn.execute(
                    "INSERT INTO ltm_projection_writer "
                    "(target_key, lease_token, fencing_token, lease_expires_at) "
                    "VALUES (?, ?, ?, ?)",
                    (
                        self._target_key,
                        lease_token,
                        fencing_token,
                        now + self.lease_seconds,
                    ),
                )
            except sqlite3.IntegrityError:
                conn.rollback()
                return None
            conn.commit()
        return ProjectionWriterLease(lease_token, fencing_token)

    @staticmethod
    def _lease_values(
        lease: OutboxJob | ProjectionWriterLease | str,
    ) -> tuple[str, int | None]:
        if isinstance(lease, (OutboxJob, ProjectionWriterLease)):
            return lease.lease_token, lease.fencing_token
        return lease, None

    def renew_projection_writer(self, lease: ProjectionWriterLease | str) -> bool:
        """Renew a legacy projection's target-wide writer lease."""
        lease_token, fencing_token = self._lease_values(lease)
        now = time.time()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                "UPDATE ltm_projection_writer SET lease_expires_at = ? "
                "WHERE target_key = ? AND lease_token = ? "
                "AND (? IS NULL OR fencing_token = ?)",
                (
                    now + self.lease_seconds,
                    self._target_key,
                    lease_token,
                    fencing_token,
                    fencing_token,
                ),
            )
            conn.commit()
            return cursor.rowcount == 1

    def release_projection_writer(self, lease: ProjectionWriterLease | str) -> bool:
        """Release a legacy projection lease, without touching another worker."""
        lease_token, fencing_token = self._lease_values(lease)
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                "DELETE FROM ltm_projection_writer "
                "WHERE target_key = ? AND lease_token = ? "
                "AND (? IS NULL OR fencing_token = ?)",
                (self._target_key, lease_token, fencing_token, fencing_token),
            )
            conn.commit()
            return cursor.rowcount == 1

    def renew(self, job: OutboxJob) -> bool:
        """Extend the job and target-writer lease while projection is running."""
        now = time.time()
        expires_at = now + self.lease_seconds
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """UPDATE ltm_outbox SET lease_expires_at = ?, updated_at = ?
                   WHERE session_id = ? AND turn_id = ? AND status = 'claimed' AND lease_token = ?""",
                (expires_at, now, job.session_id, job.turn_id, job.lease_token),
            )
            writer = conn.execute(
                """UPDATE ltm_projection_writer SET lease_expires_at = ?
                   WHERE target_key = ? AND lease_token = ? AND fencing_token = ?""",
                (expires_at, self._target_key, job.lease_token, job.fencing_token),
            )
            if row.rowcount != 1 or writer.rowcount != 1:
                conn.rollback()
                return False
            conn.commit()
            return True

    @contextmanager
    def projection_fence(self, lease: OutboxJob | ProjectionWriterLease):
        """Serialize one YAML mutation behind the currently valid writer lease.

        SQLite's immediate transaction stays open across the caller's atomic
        YAML replacement.  Therefore a new claimant cannot pass this check
        between validation and the filesystem side effect.
        """
        now = time.time()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            writer = conn.execute(
                """SELECT 1 FROM ltm_projection_writer
                   WHERE target_key = ? AND lease_token = ? AND fencing_token = ?
                     AND lease_expires_at > ?""",
                (self._target_key, lease.lease_token, lease.fencing_token, now),
            ).fetchone()
            valid = writer is not None
            if valid and isinstance(lease, OutboxJob):
                valid = (
                    conn.execute(
                        """SELECT 1 FROM ltm_outbox
                           WHERE session_id = ? AND turn_id = ? AND status = 'claimed'
                             AND lease_token = ? AND lease_expires_at > ?""",
                        (lease.session_id, lease.turn_id, lease.lease_token, now),
                    ).fetchone()
                    is not None
                )
            if not valid:
                conn.rollback()
                raise ProjectionFenceLost("projection lease is no longer current")
            try:
                yield
            except BaseException:
                conn.rollback()
                raise
            else:
                conn.commit()

    def complete(self, job: OutboxJob) -> bool:
        """Mark a claimed task completed only when its lease token still matches."""
        now = time.time()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                """UPDATE ltm_outbox
                   SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
                       completed_at = ?, updated_at = ?, last_error = NULL
                   WHERE session_id = ? AND turn_id = ? AND status = 'claimed'
                     AND lease_token = ? AND lease_expires_at > ?
                     AND EXISTS (
                        SELECT 1 FROM ltm_projection_writer
                        WHERE target_key = ? AND lease_token = ? AND fencing_token = ?
                          AND lease_expires_at > ?
                     )""",
                (
                    now,
                    now,
                    job.session_id,
                    job.turn_id,
                    job.lease_token,
                    now,
                    self._target_key,
                    job.lease_token,
                    job.fencing_token,
                    now,
                ),
            )
            if cursor.rowcount:
                conn.execute(
                    "DELETE FROM ltm_projection_writer WHERE target_key = ? AND lease_token = ?",
                    (self._target_key, job.lease_token),
                )
            conn.commit()
        if cursor.rowcount:
            self.cleanup()
            return True
        return False

    def fail(self, session_id: str, turn_id: str, lease_token: str, error: str) -> bool:
        """Release a matching lease with exponential backoff for a later retry."""
        now = time.time()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """SELECT attempts FROM ltm_outbox
                   WHERE session_id = ? AND turn_id = ? AND status = 'claimed' AND lease_token = ?""",
                (session_id, turn_id, lease_token),
            ).fetchone()
            if row is None:
                conn.commit()
                return False
            delay = min(
                self.retry_max_seconds,
                self.retry_base_seconds * (2 ** max(0, int(row["attempts"]) - 1)),
            )
            cursor = conn.execute(
                """UPDATE ltm_outbox
                   SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
                       available_at = ?, updated_at = ?, last_error = ?
                   WHERE session_id = ? AND turn_id = ? AND status = 'claimed' AND lease_token = ?""",
                (now + delay, now, error[:1_000], session_id, turn_id, lease_token),
            )
            if cursor.rowcount:
                conn.execute(
                    "DELETE FROM ltm_projection_writer WHERE target_key = ? AND lease_token = ?",
                    (self._target_key, lease_token),
                )
            conn.commit()
            return cursor.rowcount == 1

    def release_cancelled(
        self, job: OutboxJob, error: str = "projection cancelled"
    ) -> bool:
        """Immediately requeue a cancelled job only while its full lease is current.

        Cancellation is control flow, rather than a failed projection, so it must
        not inherit normal retry backoff.  The outbox row and target-wide writer
        fence are checked in the same transaction before either is released.
        This prevents a stale worker from releasing a newer claimant's job.
        """
        now = time.time()
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            cursor = conn.execute(
                """UPDATE ltm_outbox
                   SET status = 'pending', lease_token = NULL, lease_expires_at = NULL,
                       available_at = ?, updated_at = ?, last_error = ?
                   WHERE session_id = ? AND turn_id = ? AND status = 'claimed'
                     AND lease_token = ? AND lease_expires_at > ?
                     AND EXISTS (
                        SELECT 1 FROM ltm_projection_writer
                        WHERE target_key = ? AND lease_token = ? AND fencing_token = ?
                          AND lease_expires_at > ?
                     )""",
                (
                    now,
                    now,
                    error[:1_000],
                    job.session_id,
                    job.turn_id,
                    job.lease_token,
                    now,
                    self._target_key,
                    job.lease_token,
                    job.fencing_token,
                    now,
                ),
            )
            if cursor.rowcount:
                conn.execute(
                    """DELETE FROM ltm_projection_writer
                       WHERE target_key = ? AND lease_token = ? AND fencing_token = ?""",
                    (self._target_key, job.lease_token, job.fencing_token),
                )
            conn.commit()
            return cursor.rowcount == 1

    def next_ready_delay(self, default_seconds: float = 1.0) -> float:
        """Return a bounded wait until pending work becomes claimable."""
        now = time.time()
        with self._connection() as conn:
            row = conn.execute(
                "SELECT MIN(available_at) AS ready_at FROM ltm_outbox WHERE status = 'pending'"
            ).fetchone()
        if row is None or row["ready_at"] is None:
            return default_seconds
        return max(0.0, min(default_seconds, float(row["ready_at"]) - now))

    def cleanup(self, now: float | None = None) -> dict[str, int]:
        """Archive only completed rows, then expire bounded audit tombstones.

        Pending and claimed rows remain durable.  After archive expiry, an old
        ``(session_id, turn_id)`` may deliberately be enqueued again.
        """
        now = time.time() if now is None else now
        policy = self.retention
        with self._connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            completed = conn.execute(
                """SELECT session_id, turn_id, payload, attempts, created_at, completed_at
                   FROM ltm_outbox WHERE status = 'completed'
                   ORDER BY completed_at DESC, session_id, turn_id"""
            ).fetchall()
            archive_rows: list[sqlite3.Row] = []
            for index, row in enumerate(completed):
                if index < policy.completed_keep_recent:
                    continue
                over_count = index >= policy.completed_max_records
                too_old = row["completed_at"] <= now - policy.completed_max_age_seconds
                if over_count or too_old:
                    archive_rows.append(row)
            for row in archive_rows:
                digest = hashlib.sha256(row["payload"].encode("utf-8")).hexdigest()
                conn.execute(
                    """INSERT OR IGNORE INTO ltm_outbox_archive
                       (session_id, turn_id, payload_sha256, attempts, created_at, completed_at, archived_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        row["session_id"],
                        row["turn_id"],
                        digest,
                        row["attempts"],
                        row["created_at"],
                        row["completed_at"],
                        now,
                    ),
                )
                conn.execute(
                    "DELETE FROM ltm_outbox WHERE session_id = ? AND turn_id = ? AND status = 'completed'",
                    (row["session_id"], row["turn_id"]),
                )
            archive = conn.execute(
                """SELECT session_id, turn_id, archived_at FROM ltm_outbox_archive
                   ORDER BY archived_at DESC, session_id, turn_id"""
            ).fetchall()
            removed_archive = 0
            for index, row in enumerate(archive):
                too_many = index >= policy.archive_max_records
                too_old = row["archived_at"] <= now - policy.archive_max_age_seconds
                if too_many or too_old:
                    conn.execute(
                        "DELETE FROM ltm_outbox_archive WHERE session_id = ? AND turn_id = ?",
                        (row["session_id"], row["turn_id"]),
                    )
                    removed_archive += 1
            conn.commit()
        return {"archived": len(archive_rows), "expired_archive": removed_archive}

    def get(self, session_id: str, turn_id: str) -> dict[str, Any] | None:
        """Return task state for diagnostics and focused tests."""
        with self._connection() as conn:
            row = conn.execute(
                "SELECT * FROM ltm_outbox WHERE session_id = ? AND turn_id = ?",
                (session_id, turn_id),
            ).fetchone()
        return dict(row) if row is not None else None

    def is_archived(self, session_id: str, turn_id: str) -> bool:
        """Whether a compact audit tombstone still protects this turn from replay."""
        with self._connection() as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM ltm_outbox_archive WHERE session_id = ? AND turn_id = ?",
                    (session_id, turn_id),
                ).fetchone()
                is not None
            )

    def counts(self) -> dict[str, int]:
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS count FROM ltm_outbox GROUP BY status"
            ).fetchall()
            archived = conn.execute(
                "SELECT COUNT(*) FROM ltm_outbox_archive"
            ).fetchone()[0]
        result = {row["status"]: row["count"] for row in rows}
        result["archive"] = archived
        return result

    def retained_identities(self) -> set[tuple[str, str]]:
        """Rows/tombstones whose YAML operation fences must not be compacted."""
        with self._connection() as conn:
            rows = conn.execute(
                "SELECT session_id, turn_id FROM ltm_outbox UNION SELECT session_id, turn_id FROM ltm_outbox_archive"
            ).fetchall()
        return {(str(row["session_id"]), str(row["turn_id"])) for row in rows}
