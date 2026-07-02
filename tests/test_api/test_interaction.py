"""Tests for api/interaction.py session-scoped pending interactions."""

import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import pytest


def _load_interaction_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "interaction.py"
    spec = importlib.util.spec_from_file_location("interaction_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    previous_tools = sys.modules.get("tools")
    if previous_tools is None:
        tools_pkg = types.ModuleType("tools")
        tools_pkg.__path__ = []
        sys.modules["tools"] = tools_pkg

    fake_tools_base = types.ModuleType("tools.base")
    fake_tools_base.format_error = lambda message: {"ok": False, "error": message}

    previous = sys.modules.get("tools.base")
    sys.modules["tools.base"] = fake_tools_base
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            sys.modules.pop("tools.base", None)
        else:
            sys.modules["tools.base"] = previous
        if previous_tools is None:
            sys.modules.pop("tools", None)

    return module


interaction = _load_interaction_module()


@pytest.fixture(autouse=True)
def clear_pending():
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()
    yield
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()


@pytest.fixture
def event_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        yield loop
    finally:
        loop.close()
        asyncio.set_event_loop(None)


def test_cancel_session_only_cancels_matching_pending_interactions(event_loop):
    id_a, future_a = interaction.register("session-a")
    id_b, future_b = interaction.register("session-b")

    interaction.cancel_session("session-a", "cancel a")

    assert future_a.done()
    assert not future_b.done()
    assert id_a not in interaction._pending
    assert id_b in interaction._pending
    assert "session-a" not in interaction._pending_by_session
    assert interaction._pending_by_session["session-b"] == {id_b}


def test_cancel_all_without_session_keeps_legacy_global_behavior(event_loop):
    id_a, future_a = interaction.register("session-a")
    id_b, future_b = interaction.register("session-b")

    interaction.cancel_all("cancel all")

    assert future_a.done()
    assert future_b.done()
    assert id_a not in interaction._pending
    assert id_b not in interaction._pending
    assert interaction._pending_by_session == {}
