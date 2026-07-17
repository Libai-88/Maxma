"""Coverage push tests for api/interaction.py.

Targets previously uncovered lines:
- Lines 29, 34, 39: set/get/clear_session_auto_approve
- Line 77: resolve returns False when future already done
- Line 102: cancel_all uses default reason when reason is None
- Line 113: cancel_all continues when future is None (stale interaction_id)
"""

from __future__ import annotations

import asyncio

import pytest

from api import interaction


@pytest.fixture(autouse=True)
async def clear_state():
    """Clear all global state before and after each test."""
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()
    interaction._settings.clear()
    yield
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()
    interaction._settings.clear()


@pytest.mark.asyncio
async def test_session_auto_approve_set_get_clear():
    """Lines 29, 34, 39: set/get/clear session auto_approve settings."""
    # Initially False for unknown session
    assert interaction.get_session_auto_approve("sess-auto") is False  # line 34

    # Set to True
    interaction.set_session_auto_approve("sess-auto", True)  # line 29
    assert interaction.get_session_auto_approve("sess-auto") is True

    # Set to False
    interaction.set_session_auto_approve("sess-auto", False)
    assert interaction.get_session_auto_approve("sess-auto") is False

    # Clear
    interaction.clear_session_settings("sess-auto")  # line 39
    assert interaction.get_session_auto_approve("sess-auto") is False


@pytest.mark.asyncio
async def test_resolve_done_future_returns_false():
    """Line 77: resolving an already-done future returns False."""
    iid, future = await interaction.register("sess-done")
    assert await interaction.resolve(iid, "first") is True
    assert future.done()
    # Second resolve on already-done future
    assert await interaction.resolve(iid, "second") is False  # line 77


@pytest.mark.asyncio
async def test_cancel_all_default_reason():
    """Line 102: cancel_all without reason uses the default message."""
    iid, future = await interaction.register("sess-default")
    # Call cancel_all with reason=None → default reason is used
    await interaction.cancel_all(reason=None, session_id="sess-default")  # line 102
    assert future.done()
    result = await future
    assert "取消" in result  # default reason contains "取消"


@pytest.mark.asyncio
async def test_cancel_all_skips_none_future():
    """Line 113: cancel_all continues when future is None for a stale
    interaction_id (present in _pending_by_session but not in _pending)."""
    # Register a real interaction
    iid, future = await interaction.register("sess-stale")
    # Inject a stale interaction_id into _pending_by_session that has no
    # corresponding entry in _pending (simulates a race condition)
    interaction._pending_by_session["sess-stale"].add("nonexistent-id")
    # cancel_all should skip the nonexistent-id (future is None → continue)
    await interaction.cancel_all(reason="cleanup", session_id="sess-stale")  # line 113
    # Real future was cancelled
    assert future.done()
