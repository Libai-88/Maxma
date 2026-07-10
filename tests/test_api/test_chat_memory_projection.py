"""Memory persistence boundaries for completed chat turns."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest


class _Model:
    model_name = "test-model"

    def bind(self, **_kwargs):
        return self


async def _send(target, payload):
    target.append(payload)


@pytest.mark.asyncio
async def test_provider_failure_does_not_project_to_any_memory(monkeypatch):
    """A user-facing failure must not be treated as a completed memory turn."""
    from api.routes import chat

    ltm = SimpleNamespace(send_history=AsyncMock())
    session = SimpleNamespace(
        session_id="memory-boundary-session",
        is_subagent=False,
        auto_approve=False,
        checkpointer=None,
        _active_task=None,
        _project_context=None,
        _project_path=None,
        is_const=False,
        message_count=0,
        _pending_result=None,
    )
    app_state = SimpleNamespace(
        llm=_Model(),
        mcp_tools=[],
        episodic_mm=MagicMock(),
        ltm=ltm,
    )
    sent = []
    ws = SimpleNamespace(
        app=SimpleNamespace(state=app_state),
        send_json=lambda payload: _send(sent, payload),
    )

    class _Callback:
        def __init__(self, _ws):
            self.session_id = ""
            self.turn_id = ""

    async def no_op(*_args, **_kwargs):
        return None

    graph = SimpleNamespace(
        aget_state=AsyncMock(
            return_value=SimpleNamespace(values={"llm_invocation_succeeded": False})
        )
    )

    async def provider_failure(*_args, **_kwargs):
        # The graph intentionally turns this provider failure into an answer.
        return "（调用模型时出错：ProviderError。请稍后重试。）"

    project_turn = AsyncMock()
    monkeypatch.setattr(chat, "WebSocketCallback", _Callback)
    monkeypatch.setattr(chat.interaction, "cancel_session", no_op)
    monkeypatch.setattr(chat, "_process_image_refs", lambda message: _value(message))
    monkeypatch.setattr(
        chat, "_get_provider_context", lambda _state: (256_000, "test-model")
    )
    monkeypatch.setattr(chat, "build_system_prompt", lambda: "system")
    monkeypatch.setattr(chat, "get_all_tools", lambda: [])
    monkeypatch.setattr(chat, "build_agent", lambda **_kwargs: graph)
    monkeypatch.setattr(chat, "maybe_trim_checkpoint", no_op)
    monkeypatch.setattr(chat, "_calculate_context_usage", no_op)
    monkeypatch.setattr(chat, "_build_runtime_context_for_agent", lambda *_args: "")
    monkeypatch.setattr(chat, "_stream_turn", provider_failure)
    monkeypatch.setattr(chat, "_project_completed_turn_to_episodic", project_turn)

    await chat._run_agent_turn(ws, session, "please help", turn_id="retry-safe-turn")

    project_turn.assert_not_awaited()
    ltm.send_history.assert_not_awaited()
    assert any(event.get("type") == "answer" for event in sent)
    done_events = [event for event in sent if event.get("type") == "done"]
    assert done_events[-1]["payload"]["turn_id"] == "retry-safe-turn"


async def _value(value):
    return value
