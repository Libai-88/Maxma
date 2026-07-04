"""Tests for API event-hook callback wiring."""

from types import SimpleNamespace

import pytest

from agent.hooks import HookConfig, HookUnsupportedError
from api import server


def _hook() -> HookConfig:
    return HookConfig(
        hook_id="hook-1",
        name="Nightly cleanup",
        hook_type="webhook",
        config={"timeout": 5},
        action="Summarize the trigger payload.",
    )


@pytest.mark.asyncio
async def test_event_hook_action_reports_unsupported_without_llm():
    async def _fake_create():
        return object()

    app = SimpleNamespace(
        state=SimpleNamespace(
            llm=None,
            session_manager=SimpleNamespace(create=_fake_create),
            system_prompt="system",
        )
    )

    with pytest.raises(HookUnsupportedError, match="未配置 LLM Provider"):
        await server._run_event_hook_action(app, _hook(), "payload")


@pytest.mark.asyncio
async def test_event_hook_action_uses_agent_entrypoint(monkeypatch):
    calls = {}

    class FakeGraph:
        async def ainvoke(self, inputs, config):
            calls["inputs"] = inputs
            calls["config"] = config
            return {"messages": [SimpleNamespace(content="hook done")]}

    def fake_build_agent(**kwargs):
        calls["build_agent"] = kwargs
        return FakeGraph()

    session = SimpleNamespace(session_id="session-1", checkpointer=object(), _graph=None)
    deleted_sessions = []

    # 模拟异步 session_manager：create/delete 都需要可被 await
    async def _fake_create():
        return session

    async def _fake_delete(session_id: str):
        deleted_sessions.append(session_id)

    app = SimpleNamespace(
        state=SimpleNamespace(
            llm=object(),
            session_manager=SimpleNamespace(
                create=_fake_create,
                delete=_fake_delete,
            ),
            system_prompt="system",
            mcp_tools=[],
        )
    )

    monkeypatch.setattr(server, "build_agent", fake_build_agent)
    monkeypatch.setattr(server, "_hook_tools_for_action", lambda *_args: [])

    result = await server._run_event_hook_action(app, _hook(), "payload")

    assert result == "hook done"
    assert calls["build_agent"]["checkpointer"] is session.checkpointer
    assert calls["inputs"]["messages"][0].content.startswith("[事件钩子触发]")
    assert calls["config"]["configurable"]["thread_id"] == "session-1"
    assert deleted_sessions == ["session-1"]
