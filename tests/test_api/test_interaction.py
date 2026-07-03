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
async def clear_pending():
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()
    yield
    interaction._pending.clear()
    interaction._pending_sessions.clear()
    interaction._pending_by_session.clear()


@pytest.mark.asyncio
async def test_register_returns_unique_interaction_id():
    id_a, future_a = await interaction.register("session-a")
    id_b, future_b = await interaction.register("session-a")

    assert id_a != id_b
    assert isinstance(future_a, asyncio.Future)
    assert isinstance(future_b, asyncio.Future)
    assert not future_a.done()
    assert not future_b.done()


@pytest.mark.asyncio
async def test_resolve_wakes_pending_future():
    id_, future = await interaction.register("session-a")

    result = await interaction.resolve(id_, "user answer")

    assert result is True
    assert future.done()
    assert await future == "user answer"


@pytest.mark.asyncio
async def test_resolve_unknown_interaction_returns_false():
    assert await interaction.resolve("nonexistent-id", "answer") is False


@pytest.mark.asyncio
async def test_cleanup_removes_pending_state():
    id_, future = await interaction.register("session-a")

    await interaction.cleanup(id_)

    assert id_ not in interaction._pending
    assert "session-a" not in interaction._pending_sessions
    assert id_ not in interaction._pending_by_session.get("session-a", set())


@pytest.mark.asyncio
async def test_cancel_session_only_cancels_matching_pending_interactions():
    id_a, future_a = await interaction.register("session-a")
    id_b, future_b = await interaction.register("session-b")

    await interaction.cancel_session("session-a", "cancel a")

    assert future_a.done()
    assert not future_b.done()
    assert id_a not in interaction._pending
    assert id_b in interaction._pending
    assert "session-a" not in interaction._pending_by_session
    assert interaction._pending_by_session["session-b"] == {id_b}


@pytest.mark.asyncio
async def test_cancel_all_without_session_keeps_legacy_global_behavior():
    id_a, future_a = await interaction.register("session-a")
    id_b, future_b = await interaction.register("session-b")

    await interaction.cancel_all("cancel all")

    assert future_a.done()
    assert future_b.done()
    assert id_a not in interaction._pending
    assert id_b not in interaction._pending
    assert interaction._pending_by_session == {}


@pytest.mark.asyncio
async def test_concurrent_register_and_cancel_all_is_safe():
    """多个任务并发注册/取消同一会话，不应抛出异常或留下脏状态。"""
    ids = [await interaction.register("session-a") for _ in range(20)]

    async def canceler():
        await interaction.cancel_all("reason", "session-a")

    await asyncio.gather(*(canceler() for _ in range(10)))

    # 允许部分 future 已被取消或完成，但全局状态必须一致
    assert interaction._pending_by_session.get("session-a", set()) == set()
    assert all(
        (iid not in interaction._pending) or interaction._pending[iid].done()
        for iid, _ in ids
    )


@pytest.mark.asyncio
async def test_concurrent_register_race():
    """多个任务并发注册，应生成唯一 ID 且不丢失会话映射。"""
    async def worker(session_id: str, count: int):
        registered = []
        for _ in range(count):
            iid, _ = await interaction.register(session_id)
            registered.append(iid)
        return registered

    results = await asyncio.gather(
        worker("session-x", 20),
        worker("session-x", 20),
        worker("session-y", 20),
    )

    all_ids = [iid for batch in results for iid in batch]
    assert len(all_ids) == len(set(all_ids))
    assert interaction._pending_by_session["session-x"] == set(results[0]) | set(results[1])
    assert interaction._pending_by_session["session-y"] == set(results[2])
