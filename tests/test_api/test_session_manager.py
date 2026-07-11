"""Tests for api/session_manager.py."""

import asyncio
import importlib.util
import sys
import time
import types
from pathlib import Path

import pytest

from api import const_session_store


def _load_session_manager_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "session_manager.py"
    spec = importlib.util.spec_from_file_location("session_manager_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    # Mock heavy/optional dependencies，加载完成后恢复（避免污染全局 sys.modules）
    _saved_modules = {}  # pkg_name -> (was_injected: bool, original_module_or_None)
    _saved_attrs = {}    # (pkg_name, attr) -> original_value

    for pkg_name in [
        "langgraph.checkpoint.memory",
        "langgraph.graph.state",
    ]:
        if pkg_name in sys.modules:
            # 模块已加载：保存并替换属性，不替换模块本身
            _saved_modules[pkg_name] = (False, None)
        else:
            # 模块未加载：注入 fake 模块，加载后删除
            _saved_modules[pkg_name] = (True, None)
            sys.modules[pkg_name] = types.ModuleType(pkg_name)

    # 保存原始属性值，然后设置 fake 属性
    fake_langgraph_checkpoint = sys.modules["langgraph.checkpoint.memory"]
    _saved_attrs[("langgraph.checkpoint.memory", "MemorySaver")] = getattr(
        fake_langgraph_checkpoint, "MemorySaver", None
    )
    fake_langgraph_checkpoint.MemorySaver = object

    fake_langgraph_graph = sys.modules["langgraph.graph.state"]
    _saved_attrs[("langgraph.graph.state", "CompiledStateGraph")] = getattr(
        fake_langgraph_graph, "CompiledStateGraph", None
    )
    fake_langgraph_graph.CompiledStateGraph = object

    try:
        spec.loader.exec_module(module)
    finally:
        # 恢复：删除注入的 fake 模块，恢复已有模块的原始属性
        for pkg_name, (was_injected, _) in _saved_modules.items():
            if was_injected:
                sys.modules.pop(pkg_name, None)
        for (pkg_name, attr), original in _saved_attrs.items():
            if pkg_name in sys.modules:
                mod = sys.modules[pkg_name]
                if original is not None:
                    setattr(mod, attr, original)
                else:
                    delattr(mod, attr)

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
async def test_session_permission_metadata_defaults_to_confirmation_first_and_is_secret_free(manager):
    session = await manager.create()

    metadata = session.persistent_metadata()

    assert metadata["permission_mode"] == "ask"
    assert isinstance(metadata["permission_mode_updated_at"], float)
    assert set(metadata) == {
        "created_at",
        "last_active",
        "message_count",
        "permission_mode",
        "permission_mode_updated_at",
    }


@pytest.mark.asyncio
async def test_invalid_persisted_permission_mode_falls_back_to_confirmation_first(manager):
    session = session_manager_module.SessionState(
        session_id="persisted-session",
        permission_mode="invalid-mode",
    )

    assert session.permission_mode == "ask"


@pytest.mark.asyncio
async def test_selected_permission_mode_round_trips_through_const_metadata(manager, monkeypatch, tmp_path):
    monkeypatch.setattr(const_session_store, "_CONST_DIR", tmp_path)
    session = await manager.create()
    session.set_permission_mode("operate")

    const_session_store.save_const_session(
        session.session_id,
        "Saved session",
        session.persistent_metadata(),
        [],
    )
    persisted = const_session_store.load_const_session_by_id(session.session_id)

    assert persisted is not None
    assert persisted["metadata"]["permission_mode"] == "operate"
    assert persisted["metadata"]["permission_mode_updated_at"] == session.permission_mode_updated_at


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
