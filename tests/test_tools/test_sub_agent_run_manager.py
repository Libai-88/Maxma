"""Dispatcher tests for cancellation and one-time durable settlement."""
from __future__ import annotations

import asyncio

import pytest

try:
    from tools.sub_agent.deferred_result_store import DeferredResultStore
    from tools.sub_agent.run_manager import DeferredRunManager
except ImportError:
    DeferredResultStore = None
    DeferredRunManager = None


def _run(store: DeferredResultStore):
    return store.submit(
        parent_session_id="parent", parent_turn_id="turn", task="read only",
        input_summary="read only", delegation_snapshot={"allowed_tools": []},
        deadline_at=None, retryable=True,
    )


@pytest.mark.asyncio
async def test_manager_settles_result_once(tmp_path):
    from agent import audit_log
    audit_log.AUDIT_LOG_PATH = tmp_path / "audit.jsonl"
    audit_log.LOGS_DIR = tmp_path
    store = DeferredResultStore(tmp_path / "runs.sqlite")
    manager = DeferredRunManager(store)
    run = _run(store)

    async def execute(_run):
        return "answer"

    assert manager.submit(run, execute) is True
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    persisted = store.get(run.run_id)
    assert persisted is not None
    assert persisted.status == "succeeded"
    assert persisted.result == "answer"
    assert manager.submit(persisted, execute) is False
    assert [item["detail"] for item in audit_log.read_subagent_run_events(run.run_id)] == [
        "completed", "execution_started"
    ]


@pytest.mark.asyncio
async def test_manager_cancel_does_not_turn_cancelled_error_into_failure(tmp_path):
    store = DeferredResultStore(tmp_path / "runs.sqlite")
    manager = DeferredRunManager(store)
    run = _run(store)
    started = asyncio.Event()

    async def execute(_run):
        started.set()
        await asyncio.Event().wait()
        return "unreachable"

    assert manager.submit(run, execute) is True
    await started.wait()
    assert await manager.cancel(run.run_id, "parent_cancelled") is True
    persisted = store.get(run.run_id)
    assert persisted is not None
    assert persisted.status == "cancelled"
    assert persisted.error_summary is None


@pytest.mark.asyncio
async def test_manager_recovers_an_expired_retryable_run(tmp_path):
    now = [100.0]
    store = DeferredResultStore(tmp_path / "runs.sqlite", lease_seconds=1, clock=lambda: now[0])
    original = _run(store)
    assert store.claim(original.run_id) is not None
    now[0] = 102.0
    manager = DeferredRunManager(store)

    async def execute(_run):
        return "recovered"

    assert manager.recover(lambda _run: execute) == [original.run_id]
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    persisted = store.get(original.run_id)
    assert persisted is not None
    assert persisted.status == "succeeded"
    assert persisted.result == "recovered"


@pytest.mark.asyncio
async def test_manager_cancels_all_active_runs_for_deleted_parent(tmp_path):
    store = DeferredResultStore(tmp_path / "runs.sqlite")
    manager = DeferredRunManager(store)
    first = _run(store)
    second = store.submit(
        parent_session_id="parent", parent_turn_id="turn-2", task="second",
        input_summary="second", delegation_snapshot={}, deadline_at=None, retryable=True,
    )

    assert await manager.cancel_parent("parent") == 2
    assert store.get(first.run_id).status == "cancelled"
    assert store.get(second.run_id).status == "cancelled"


@pytest.mark.asyncio
async def test_call_subagent_returns_handle_immediately_when_async_flag_is_enabled(monkeypatch, tmp_path):
    """The feature flag must not retain the legacy await-child behaviour."""
    from types import SimpleNamespace
    from tools.sub_agent import tool_call_sub_agent as module
    from tools.sub_agent.tool_call_sub_agent import CallSubAgentTool

    started = asyncio.Event()
    release = asyncio.Event()
    manager = DeferredRunManager(DeferredResultStore(tmp_path / "runs.sqlite"))
    sub = SimpleNamespace(
        session_id="child", parent_session_id="parent", checkpointer=None,
        _active_task=None, _pending_result=asyncio.get_running_loop().create_future(),
        message_count=0,
    )

    class SessionManager:
        async def create_sub_session(self, **_kwargs):
            return sub

    sent = []
    state = SimpleNamespace(
        session_manager=SessionManager(), llm=None, tools=[], provider_manager=None,
    )
    ws = SimpleNamespace(
        url="/ws/chat/parent", app=SimpleNamespace(state=state),
        send_json=lambda payload: _send(sent, payload),
    )

    async def background(_self, _sub, _task, _state, context):
        assert context.allowed_tools == frozenset()
        assert context.enforce_scope is True
        started.set()
        await release.wait()
        return "done"

    monkeypatch.setattr(module.interaction, "current_ws", SimpleNamespace(get=lambda: ws))
    monkeypatch.setattr(module, "_async_subagent_enabled", lambda: True)
    monkeypatch.setattr(module, "_subagent_stream_on_demand_enabled", lambda: True)
    monkeypatch.setattr(module, "_get_deferred_run_manager", lambda _state: manager)
    monkeypatch.setattr(CallSubAgentTool, "_run_background", background)

    result = await CallSubAgentTool()._do_run("read-only research", "research")

    assert '"run_id"' in result
    assert '"answer"' not in result
    await started.wait()
    assert any(item["type"] == "deferred_subagent_submitted" for item in sent)
    release.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    await manager.shutdown()


@pytest.mark.asyncio
async def test_async_subagent_omits_lazy_stream_event_until_its_flag_is_enabled(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from tools.sub_agent import tool_call_sub_agent as module
    from tools.sub_agent.tool_call_sub_agent import CallSubAgentTool

    manager = DeferredRunManager(DeferredResultStore(tmp_path / "runs.sqlite"))
    sub = SimpleNamespace(
        session_id="child", parent_session_id="parent", checkpointer=None,
        _active_task=None, _pending_result=asyncio.get_running_loop().create_future(), message_count=0,
    )

    class SessionManager:
        async def create_sub_session(self, **_kwargs):
            return sub

    sent = []
    state = SimpleNamespace(session_manager=SessionManager(), llm=None, tools=[], provider_manager=None)
    ws = SimpleNamespace(
        url="/ws/chat/parent", app=SimpleNamespace(state=state),
        send_json=lambda payload: _send(sent, payload),
    )

    async def background(*_args):
        return "done"

    monkeypatch.setattr(module.interaction, "current_ws", SimpleNamespace(get=lambda: ws))
    monkeypatch.setattr(module, "_async_subagent_enabled", lambda: True)
    monkeypatch.setattr(module, "_subagent_stream_on_demand_enabled", lambda: False)
    monkeypatch.setattr(module, "_get_deferred_run_manager", lambda _state: manager)
    monkeypatch.setattr(CallSubAgentTool, "_run_background", background)

    result = await CallSubAgentTool()._do_run("read-only research", "research")

    assert '"run_id"' in result
    assert sent == []
    await asyncio.sleep(0)
    await manager.shutdown()


async def _send(items, payload):
    items.append(payload)
