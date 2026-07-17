"""Coverage boost tests for api/session_manager.py.

Targets previously uncovered lines:
- set_permission_mode ValueError (line 75)
- set_deferred_run_manager / set_workflow_run_manager (96, 100)
- create_sub_session (108-118)
- get_or_create concurrent-path existing-session return (134-135)
- delete() cancelled-task debug log (156)
- list_sessions (178-196)
- session_count (221-223)

Direct import from api.session_manager is safe — the module does not import
langgraph (only typed as Any), and direct import ensures coverage.py tracks
the module under its canonical name.
"""

from __future__ import annotations

import asyncio
import logging
import time
from unittest.mock import patch

import pytest

from api.session_manager import SessionManager, SessionState


@pytest.fixture
def manager():
    return SessionManager(ttl_seconds=1)


# ── set_permission_mode validation (line 75) ─────────────────────────


def test_set_permission_mode_rejects_invalid_mode(manager):
    """Line 75: invalid permission mode raises ValueError."""
    session = SessionState(session_id="s1")
    with pytest.raises(ValueError, match="Unsupported permission mode"):
        session.set_permission_mode("bogus-mode")


def test_set_permission_mode_accepts_all_valid_modes(manager):
    """All four valid modes round-trip and update the timestamp."""
    for mode in ("read_only", "ask", "operate", "auto"):
        session = SessionState(session_id=f"s-{mode}")
        before = session.permission_mode_updated_at
        time.sleep(0.001)  # ensure timestamp moves
        result = session.set_permission_mode(mode)
        assert result == mode
        assert session.permission_mode == mode
        assert session.permission_mode_updated_at > before


# ── set_deferred_run_manager / set_workflow_run_manager (96, 100) ────


def test_set_deferred_run_manager_binds_attribute(manager):
    """Line 96: set_deferred_run_manager stores the manager on self."""
    sentinel = object()
    manager.set_deferred_run_manager(sentinel)
    assert manager._deferred_run_manager is sentinel


def test_set_workflow_run_manager_binds_attribute(manager):
    """Line 100: set_workflow_run_manager stores the manager on self."""
    sentinel = object()
    manager.set_workflow_run_manager(sentinel)
    assert manager._workflow_run_manager is sentinel


# ── create_sub_session (108-118) ─────────────────────────────────────


@pytest.mark.asyncio
async def test_create_sub_session_populates_subagent_fields(manager):
    """Lines 108-118: create_sub_session builds a sub-agent session."""
    parent = await manager.create()
    sub = await manager.create_sub_session(
        "do the thing", parent_session_id=parent.session_id
    )

    assert sub.is_subagent is True
    assert sub.parent_session_id == parent.session_id
    assert sub._sub_agent_task == "do the thing"
    assert isinstance(sub._pending_result, asyncio.Future)
    assert sub._pending_result.done() is False
    # Stored in the manager's session map.
    assert sub.session_id in manager._sessions
    assert manager._sessions[sub.session_id] is sub


@pytest.mark.asyncio
async def test_create_sub_session_without_parent(manager):
    """create_sub_session works with parent_session_id=None."""
    sub = await manager.create_sub_session("orphan task")
    assert sub.is_subagent is True
    assert sub.parent_session_id is None
    assert sub._sub_agent_task == "orphan task"


# ── get_or_create concurrent path: existing session returned (134-135) ─


@pytest.mark.asyncio
async def test_get_or_create_returns_existing_when_session_appears_concurrently(
    manager,
):
    """Lines 134-135: if a session appears in _sessions between the get() call
    and the lock acquisition, get_or_create returns that existing session
    instead of the freshly-constructed one.
    """
    sid = "race-sid"
    pre_existing = SessionState(session_id=sid)

    original_get = manager.get

    async def _racy_get(session_id):
        # Simulate another coroutine inserting the session after the real get
        # (which returns None) but before get_or_create acquires the lock.
        result = await original_get(session_id)
        if result is None and session_id == sid:
            manager._sessions[session_id] = pre_existing
        return result

    with patch.object(manager, "get", _racy_get):
        result = await manager.get_or_create(sid)

    # Must return the pre-existing session, not a new one.
    assert result is pre_existing
    # The pre-existing session's last_active was refreshed.
    assert result.last_active >= pre_existing.created_at


# ── delete() cancelled-task debug log (line 156) ─────────────────────


@pytest.mark.asyncio
async def test_delete_logs_debug_when_active_task_cancelled_cleanly(manager, caplog):
    """Line 156: when a running _active_task is cancelled and raises
    CancelledError (clean cancel), delete() logs a debug message.
    """
    session = await manager.create()

    async def long_running():
        await asyncio.sleep(100)

    task = asyncio.create_task(long_running())
    await asyncio.sleep(0)  # let it start
    session._active_task = task

    with caplog.at_level(logging.DEBUG, logger="api.session_manager"):
        result = await manager.delete(session.session_id)

    assert result is True
    # The debug log for clean cancellation must be present.
    assert any(
        "Active task cancelled" in r.getMessage() for r in caplog.records
    )
    # Task was cancelled.
    await asyncio.sleep(0)
    assert task.cancelled() or task.done()


# ── list_sessions (178-196) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_sessions_returns_dicts_sorted_by_last_active_desc(manager):
    """Lines 178-196: list_sessions returns dict per session, sorted by
    last_active descending, with correct has_active_agent flag.
    """
    # Create three sessions with staggered last_active values.
    s_old = await manager.create()
    s_old.last_active = 1000.0
    s_mid = await manager.create()
    s_mid.last_active = 2000.0
    s_new = await manager.create()
    s_new.last_active = 3000.0

    result = await manager.list_sessions()

    assert len(result) == 3
    assert all(isinstance(r, dict) for r in result)
    # Sorted descending by last_active.
    assert result[0]["session_id"] == s_new.session_id
    assert result[1]["session_id"] == s_mid.session_id
    assert result[2]["session_id"] == s_old.session_id
    # Each dict has the expected keys.
    for r in result:
        assert set(r.keys()) == {
            "session_id",
            "message_count",
            "created_at",
            "last_active",
            "has_active_agent",
            "is_subagent",
            "is_const",
            "const_name",
        }
        assert r["has_active_agent"] is False
        assert r["is_subagent"] is False
        assert r["is_const"] is False
        assert r["const_name"] == ""


@pytest.mark.asyncio
async def test_list_sessions_marks_active_agent_and_includes_const_subagent(manager):
    """list_sessions flags has_active_agent, is_const, is_subagent correctly."""
    # A const session.
    s_const = await manager.create()
    s_const.is_const = True
    s_const.const_name = "my-const"

    # A sub-agent session.
    s_sub = await manager.create_sub_session("task")

    # A normal session with an active task.
    s_active = await manager.create()

    async def long_running():
        await asyncio.sleep(100)

    task = asyncio.create_task(long_running())
    await asyncio.sleep(0)
    s_active._active_task = task

    try:
        result = await manager.list_sessions()
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    by_id = {r["session_id"]: r for r in result}
    assert by_id[s_const.session_id]["is_const"] is True
    assert by_id[s_const.session_id]["const_name"] == "my-const"
    assert by_id[s_sub.session_id]["is_subagent"] is True
    assert by_id[s_active.session_id]["has_active_agent"] is True


@pytest.mark.asyncio
async def test_list_sessions_empty(manager):
    """list_sessions on an empty manager returns []."""
    assert await manager.list_sessions() == []


@pytest.mark.asyncio
async def test_list_sessions_sort_handles_non_numeric_last_active(manager):
    """Line 195: sort key falls back to 0.0 when last_active is not numeric."""
    s = await manager.create()
    s.last_active = "not-a-number"  # type: ignore[assignment]
    result = await manager.list_sessions()
    assert len(result) == 1
    assert result[0]["session_id"] == s.session_id


# ── session_count (221-223) ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_session_count_excludes_subagents(manager):
    """Lines 221-223: session_count counts only non-subagent sessions."""
    await manager.create()
    await manager.create()
    await manager.create_sub_session("sub task")

    count = await manager.session_count()
    assert count == 2


@pytest.mark.asyncio
async def test_session_count_zero_when_empty(manager):
    """session_count returns 0 when no sessions exist."""
    assert await manager.session_count() == 0


@pytest.mark.asyncio
async def test_session_count_includes_const_sessions(manager):
    """Const sessions are not subagents, so they count towards session_count."""
    s = await manager.create()
    s.is_const = True
    assert await manager.session_count() == 1
