"""Tests for api/db/core.py — connection, migration, transaction, helpers.

Boosts coverage for the previously uncovered paths:
- initialize_database() early-return when already initialized (lines 179, 182)
- migration upgrade path for existing DB with schema_version < SCHEMA_VERSION (198-200)
- transaction() rollback on exception (226-228)
- row_to_dict(None) / rows_to_dicts (238-240, 245)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from api.db import core as db_core
from api.db.core import (
    SCHEMA_MIGRATIONS,
    SCHEMA_VERSION,
    initialize_database,
    row_to_dict,
    rows_to_dicts,
    transaction,
)


# ── DB isolation fixture ──────────────────────────────────────────────


@pytest.fixture
def isolated_db(tmp_path: Path, monkeypatch) -> Path:
    """Redirect DB_PATH to tmp_path and reset _db_initialized flag."""
    test_db = tmp_path / "test_core.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)
    db_core.initialize_database()
    return test_db


# ── initialize_database: early return when already initialized ────────


def test_initialize_database_is_idempotent_when_already_initialized(
    isolated_db: Path, monkeypatch
):
    """Calling initialize_database() when _db_initialized=True must be a no-op.

    Covers lines 179 and 182 (both early-return guards).
    """
    # After isolated_db fixture ran, _db_initialized is True.
    assert db_core._db_initialized is True

    # Sabotage DB_PATH so that any real re-init attempt would crash; the
    # early-return must prevent execution from reaching the body.
    monkeypatch.setattr(db_core, "DB_PATH", Path("Z:/nonexistent/dir/x.db"))

    # Must NOT raise and must NOT touch the filesystem.
    initialize_database()

    assert db_core._db_initialized is True


def test_initialize_database_inner_guard_returns_early(monkeypatch, tmp_path):
    """Cover line 182: the inner double-checked guard inside the lock.

    Simulate a concurrent init race: `_db_initialized` is falsy on the outer
    check (line 179) but truthy by the time the inner check (line 182) runs.
    We achieve this with a sentinel whose `__bool__` flips after the first read.
    """
    class _FlipBool:
        """Falsy on first __bool__, truthy thereafter — mimics a race win."""

        def __init__(self) -> None:
            self.reads = 0

        def __bool__(self) -> bool:
            self.reads += 1
            return self.reads > 1

    sentinel = _FlipBool()
    # Point DB_PATH at an isolated path so any unexpected fallthrough is safe.
    monkeypatch.setattr(db_core, "DB_PATH", tmp_path / "inner_guard.db")
    monkeypatch.setattr(db_core, "_db_initialized", sentinel)

    # Should return at line 182 without running migrations or touching disk.
    initialize_database()

    # The outer guard read once (False), the inner guard read once (True).
    assert sentinel.reads == 2
    # The (mocked) initialized flag was never replaced with a real bool.
    assert db_core._db_initialized is sentinel


# ── initialize_database: migration upgrade path ───────────────────────


def test_initialize_database_migrates_existing_db_from_v1(
    tmp_path: Path, monkeypatch
):
    """Cover lines 198-200: existing DB with schema_version < SCHEMA_VERSION.

    Build a DB at v1, then call initialize_database() and verify v2/v3
    migrations ran (tables + schema_version bumped).
    """
    test_db = tmp_path / "migrate.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)

    # Manually create a v1-only database (run only the first migration).
    db_core.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(test_db))
    try:
        db_core._apply_migration(conn, SCHEMA_MIGRATIONS[0])
        conn.commit()
    finally:
        conn.close()

    # Sanity: v2 table should NOT exist yet.
    conn = sqlite3.connect(str(test_db))
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_snapshots'"
        ).fetchone()
        assert row is None
        version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert version == 1
    finally:
        conn.close()

    # Now run initialize_database() — should migrate from v1 to SCHEMA_VERSION.
    initialize_database()

    conn = sqlite3.connect(str(test_db))
    try:
        # v2 table now exists.
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='metrics_snapshots'"
        ).fetchone()
        assert row is not None
        # v3 column exists.
        cols = [r[1] for r in conn.execute("PRAGMA table_info(providers)").fetchall()]
        assert "priority" in cols
        version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert version == SCHEMA_VERSION
    finally:
        conn.close()

    assert db_core._db_initialized is True


def test_initialize_database_full_new_db_runs_all_migrations(
    tmp_path: Path, monkeypatch
):
    """A brand-new DB (no schema_version table) runs all migrations.

    Confirms the `not exists` branch (lines 189-193) and that the final state
    has all tables and the latest schema_version.
    """
    test_db = tmp_path / "fresh.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)

    initialize_database()

    conn = sqlite3.connect(str(test_db))
    try:
        tables = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for expected in (
            "schema_version",
            "providers",
            "auth_tokens",
            "event_hooks",
            "const_sessions",
            "path_whitelist",
            "maxma_blocker",
            "metrics_snapshots",
            "metrics_events",
        ):
            assert expected in tables
        version = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0]
        assert version == SCHEMA_VERSION
    finally:
        conn.close()


# ── transaction() rollback on exception ───────────────────────────────


def test_transaction_rolls_back_on_exception(isolated_db: Path):
    """Cover lines 226-228: transaction() rollback + re-raise on exception."""
    # First insert a row normally.
    with transaction() as conn:
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("stable",))

    with pytest.raises(RuntimeError, match="boom"):
        with transaction() as conn:
            conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("rolled",))
            raise RuntimeError("boom")

    # The rolled-back row must not persist; only "stable" should remain.
    with transaction() as conn:
        rows = conn.execute("SELECT token FROM auth_tokens ORDER BY id").fetchall()
        tokens = [r[0] for r in rows]
    assert tokens == ["stable"]


def test_transaction_commits_on_success(isolated_db: Path):
    """transaction() commits when the block exits cleanly."""
    with transaction() as conn:
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("committed",))

    with transaction() as conn:
        row = conn.execute("SELECT token FROM auth_tokens").fetchone()
    assert row[0] == "committed"


# ── row_to_dict / rows_to_dicts helpers ───────────────────────────────


def test_row_to_dict_returns_none_for_none():
    """Cover lines 238-240: row_to_dict(None) returns None."""
    assert row_to_dict(None) is None


def test_row_to_dict_converts_row(isolated_db: Path):
    """row_to_dict converts a sqlite3.Row to a plain dict."""
    with transaction() as conn:
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("abc",))
        row = conn.execute("SELECT id, token FROM auth_tokens").fetchone()
    d = row_to_dict(row)
    assert d is not None
    assert d["token"] == "abc"
    assert "id" in d


def test_rows_to_dicts_empty_list():
    """Cover line 245: rows_to_dicts([]) returns []."""
    assert rows_to_dicts([]) == []


def test_rows_to_dicts_converts_multiple_rows(isolated_db: Path):
    """rows_to_dicts converts a list of sqlite3.Row into list of dicts."""
    with transaction() as conn:
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("a",))
        conn.execute("INSERT INTO auth_tokens (token) VALUES (?)", ("b",))
        rows = conn.execute("SELECT id, token FROM auth_tokens ORDER BY id").fetchall()
    out = rows_to_dicts(rows)
    assert [d["token"] for d in out] == ["a", "b"]


# ── _apply_migration callable branch ──────────────────────────────────


def test_apply_migration_dispatches_callable_and_script(isolated_db: Path):
    """_apply_migration handles both callable and string migrations."""
    with transaction() as conn:
        # Callable form.
        def _add_test_table(c: sqlite3.Connection) -> None:
            c.execute("CREATE TABLE IF NOT EXISTS _test_mig_callable (id INTEGER)")

        db_core._apply_migration(conn, _add_test_table)
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_test_mig_callable'"
        ).fetchone() is not None

        # String form (executescript).
        db_core._apply_migration(conn, "CREATE TABLE IF NOT EXISTS _test_mig_str (id INTEGER);")
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_test_mig_str'"
        ).fetchone() is not None


# ── _get_connection configuration ─────────────────────────────────────


def test_get_connection_enables_wal_and_row_factory(isolated_db: Path):
    """_get_connection returns a connection with WAL mode + Row factory."""
    conn = db_core._get_connection()
    try:
        assert conn.row_factory is sqlite3.Row
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
    finally:
        conn.close()
