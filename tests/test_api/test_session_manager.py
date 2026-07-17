"""Tests for api/session_manager.py."""

import asyncio
import importlib.util
import sys
import time
import types
from pathlib import Path
from unittest.mock import patch

import pytest

from api import const_session_store


def _load_session_manager_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "session_manager.py"
    spec = importlib.util.spec_from_file_location("session_manager_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    mock_modules: dict[str, types.ModuleType] = {}

    for pkg_name in [
        "langgraph.checkpoint.memory",
        "langgraph.graph.state",
    ]:
        pkg = types.ModuleType(pkg_name)
        if pkg_name == "langgraph.checkpoint.memory":
            pkg.MemorySaver = object
        elif pkg_name == "langgraph.graph.state":
            pkg.CompiledStateGraph = object
        mock_modules[pkg_name] = pkg

    # 确保 langgraph 父包存在（Python 包导入检查 sys.modules 的父级）
    for parent in ("langgraph", "langgraph.checkpoint"):
        if parent not in sys.modules:
            mock_modules[parent] = types.ModuleType(parent)

    with patch.dict(sys.modules, mock_modules, clear=False):
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


# ── Silent-except logging tests ────────────────────────────


@pytest.mark.asyncio
async def test_delete_logs_warning_when_active_task_raises(manager, caplog):
    """delete() should log a warning when awaiting the cancelled active task raises."""
    import logging

    session = await manager.create()

    async def failing_task():
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            raise RuntimeError("task boom")

    task = asyncio.create_task(failing_task())
    await asyncio.sleep(0)  # Let the task start and reach sleep(100)
    session._active_task = task

    with caplog.at_level(logging.WARNING):
        await manager.delete(session.session_id)

    assert any(
        "task" in r.message.lower() or "取消" in r.message
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )


@pytest.mark.asyncio
async def test_delete_logs_warning_when_run_manager_raises(manager, caplog):
    """delete() should log a warning when run_manager.cancel_parent raises."""
    import logging

    class FailingRunManager:
        async def cancel_parent(self, session_id):
            raise RuntimeError("run_manager boom")

    session = await manager.create()
    manager._deferred_run_manager = FailingRunManager()

    with caplog.at_level(logging.WARNING):
        result = await manager.delete(session.session_id)

    assert result is True
    assert any(
        "run" in r.message.lower() or "durable" in r.message.lower()
        for r in caplog.records
    )


@pytest.mark.asyncio
async def test_delete_logs_warning_when_workflow_manager_raises(manager, caplog):
    """delete() should log a warning when workflow_manager.cancel_parent raises."""
    import logging

    class FailingWorkflowManager:
        async def cancel_parent(self, session_id, reason):
            raise RuntimeError("workflow boom")

    session = await manager.create()
    manager._workflow_run_manager = FailingWorkflowManager()

    with caplog.at_level(logging.WARNING):
        result = await manager.delete(session.session_id)

    assert result is True
    assert any("workflow" in r.message.lower() for r in caplog.records)
