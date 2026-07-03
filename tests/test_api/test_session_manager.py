"""Tests for api/session_manager.py."""

import asyncio
import importlib.util
import sys
import time
import types
from pathlib import Path

import pytest


def _load_session_manager_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "session_manager.py"
    spec = importlib.util.spec_from_file_location("session_manager_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    # Mock heavy/optional dependencies that may fail in the test environment
    for pkg_name in [
        "langgraph.checkpoint.memory",
        "langgraph.graph.state",
    ]:
        if pkg_name not in sys.modules:
            sys.modules[pkg_name] = types.ModuleType(pkg_name)

    fake_langgraph_checkpoint = sys.modules["langgraph.checkpoint.memory"]
    fake_langgraph_checkpoint.MemorySaver = object

    fake_langgraph_graph = sys.modules["langgraph.graph.state"]
    fake_langgraph_graph.CompiledStateGraph = object

    spec.loader.exec_module(module)
    return module


session_manager_module = _load_session_manager_module()
SessionManager = session_manager_module.SessionManager


@pytest.fixture
def manager():
    return SessionManager(ttl_seconds=1)


@pytest.mark.asyncio
async def test_create_returns_session_with_id(manager):
    session = await manager.create()

    assert session.session_id
    assert session.session_id in manager._sessions


@pytest.mark.asyncio
async def test_get_returns_existing_session(manager):
    session = await manager.create()

    found = await manager.get(session.session_id)

    assert found is session


@pytest.mark.asyncio
async def test_get_returns_none_for_unknown_session(manager):
    assert await manager.get("unknown") is None


@pytest.mark.asyncio
async def test_get_or_create_creates_new_session(manager):
    session = await manager.get_or_create("sid-1")

    assert session.session_id == "sid-1"
    assert manager._sessions["sid-1"] is session


@pytest.mark.asyncio
async def test_delete_removes_session(manager):
    session = await manager.create()

    assert await manager.delete(session.session_id) is True
    assert await manager.get(session.session_id) is None
    assert await manager.delete(session.session_id) is False


@pytest.mark.asyncio
async def test_cleanup_expired_removes_stale_sessions(manager):
    session = await manager.create()
    # 人为让会话过期
    session.last_active = time.time() - 10

    cleaned = await manager.cleanup_expired()

    assert cleaned == 1
    assert await manager.get(session.session_id) is None


@pytest.mark.asyncio
async def test_cleanup_expired_keeps_const_sessions(manager):
    session = await manager.create()
    session.is_const = True
    session.last_active = time.time() - 10

    cleaned = await manager.cleanup_expired()

    assert cleaned == 0
    assert await manager.get(session.session_id) is session


@pytest.mark.asyncio
async def test_cleanup_expired_keeps_recent_sessions(manager):
    session = await manager.create()
    session.last_active = time.time()

    cleaned = await manager.cleanup_expired()

    assert cleaned == 0
    assert await manager.get(session.session_id) is session


@pytest.mark.asyncio
async def test_cleanup_expired_does_not_remove_active_task_while_still_running(manager):
    """活跃任务在 TTL 内时不应被清理；超过 TTL 后才应被取消并清理。"""
    session = await manager.create()

    async def long_running():
        await asyncio.sleep(5)

    task = asyncio.create_task(long_running())
    session._active_task = task
    session.last_active = time.time()

    cleaned = await manager.cleanup_expired()

    assert cleaned == 0
    assert session.session_id in manager._sessions
    assert not task.done()

    # 模拟超过 TTL
    session.last_active = time.time() - 10
    cleaned = await manager.cleanup_expired()

    assert cleaned == 1
    assert await manager.get(session.session_id) is None
    # 给事件循环一次机会，让取消请求在任务中传播
    await asyncio.sleep(0)
    assert task.cancelled()
