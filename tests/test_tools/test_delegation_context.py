"""Execution-boundary tests for serial and parallel sub-agent delegation."""
import asyncio
import sys
import time
import types
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from tools.sub_agent import delegation_context as context_module
from tools.sub_agent.delegation_context import DelegationContext, ScopedTool, create_delegation_context
from tools.tool_base import ToolBase


class _PathInput(BaseModel):
    file_path: str = ""


class _PathTool(ToolBase):
    name: str = "file_read"
    description: str = "test path tool"
    args_schema: type[BaseModel] = _PathInput

    def _run(self, file_path: str = "") -> str:
        return f"read:{file_path}"


class _Model:
    model_name = "parent-model"

    def bind(self, **kwargs):
        self.bind_kwargs = kwargs
        return self


class _ProviderManager:
    def iter_enabled(self):
        return iter([SimpleNamespace(config=SimpleNamespace(id="parent-provider"), default_model="parent-model")])


def _stub_system_prompt(monkeypatch) -> None:
    """Keep background-boundary tests independent from prompt assembly."""
    prompts = types.ModuleType("agent.prompts")
    prompts.build_system_prompt = lambda: "system"
    monkeypatch.setitem(sys.modules, "agent.prompts", prompts)


@pytest.fixture
def enabled_scope(monkeypatch):
    monkeypatch.setattr(context_module, "_scope_enforced", lambda: True)
    monkeypatch.setattr(context_module, "_whitelisted_paths", lambda: ["D:/allowed"])


def test_context_captures_parent_model_provider_and_trace(enabled_scope):
    model = _Model()
    state = SimpleNamespace(
        llm=model,
        tools=[_PathTool()],
        provider_manager=_ProviderManager(),
    )

    context = create_delegation_context(state, "parent-turn")

    assert context.model is model
    assert context.provider_id == "parent-provider"
    assert context.model_name == "parent-model"
    assert context.parent_turn_id == "parent-turn"
    assert context.trace_id
    assert context.allowed_tools == frozenset({"file_read"})


def test_context_uses_explicit_turn_model_instead_of_global_default(enabled_scope):
    default_model = _Model()
    selected_model = _Model()
    selected_model.model_name = "requested-model"
    state = SimpleNamespace(
        llm=default_model,
        tools=[_PathTool()],
        provider_manager=_ProviderManager(),
    )

    context = create_delegation_context(
        state,
        "parent-turn",
        model=selected_model,
        provider_id="requested-provider",
        model_name="requested-model",
    )

    assert context.model is selected_model
    assert context.model is not default_model
    assert context.provider_id == "requested-provider"
    assert context.model_name == "requested-model"


def test_scoped_tool_rejects_paths_outside_delegated_capability():
    context = DelegationContext(
        allowed_tools=frozenset({"file_read"}),
        allowed_paths=frozenset({"D:/allowed"}),
        enforce_scope=True,
    )
    tool = ScopedTool.wrap(_PathTool(), context)

    assert "无权访问路径" in tool.invoke({"file_path": "D:/outside/secret.txt"})
    assert tool.invoke({"file_path": "D:/allowed/notes.txt"}) == "read:D:/allowed/notes.txt"


@pytest.mark.asyncio
async def test_parallel_children_share_one_inherited_context(enabled_scope, monkeypatch):
    from tools.sub_agent import tool_parallel
    from tools.sub_agent.tool_parallel import ParallelExecuteTool

    model = _Model()
    created = []

    class _SessionManager:
        async def create_sub_session(self, task, parent_session_id):
            session = SimpleNamespace(
                session_id=f"child-{len(created)}",
                _pending_result=asyncio.get_running_loop().create_future(),
                _active_task=None,
            )
            session._pending_result.set_result(f"done:{task}")
            created.append(session)
            return session

    class _Ws:
        url = "/ws/chat/parent-turn"
        app = SimpleNamespace(state=SimpleNamespace(
            llm=model,
            tools=[_PathTool()],
            provider_manager=_ProviderManager(),
            session_manager=_SessionManager(),
        ))

        async def send_json(self, _payload):
            return None

    # Some isolated chat tests replace current_ws with a minimal test double
    # exposing only set().  Do not assume ContextVar.reset() exists here; the
    # production ContextVar contract remains unchanged.
    monkeypatch.setattr(
        tool_parallel.interaction,
        "current_ws",
        SimpleNamespace(get=lambda: _Ws()),
    )
    result = await ParallelExecuteTool()._do_run([
        {"task": "first", "name": "one"},
        {"task": "second", "name": "two"},
    ])

    assert '"succeeded": 2' in result
    assert len(created) == 2
    assert created[0].delegation_context is created[1].delegation_context
    assert created[0].delegation_context.model is model
    assert created[0].delegation_context.parent_turn_id == "parent-turn"


@pytest.mark.asyncio
async def test_frontend_subsession_consumes_inherited_runtime(monkeypatch):
    """The WebSocket execution path must not fall back to app.state.llm/tools."""
    from api.routes import chat

    inherited_model = _Model()
    global_model = object()
    context = DelegationContext(
        model=inherited_model,
        provider_id="parent-provider",
        model_name="parent-model",
        allowed_tools=frozenset({"file_read"}),
        allowed_paths=frozenset({"D:/allowed"}),
        max_tokens=123,
        time_limit_seconds=30,
        trace_id="trace-1",
        parent_turn_id="parent-turn",
        enforce_scope=True,
    )
    session = SimpleNamespace(
        session_id="child-session",
        is_subagent=True,
        delegation_context=context,
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
        llm=global_model,
        mcp_tools=[],
        episodic_mm=None,
        ltm=None,
    )
    sent = []
    ws = SimpleNamespace(app=SimpleNamespace(state=app_state), send_json=lambda payload: _send(sent, payload))
    captured = {}

    class _Callback:
        def __init__(self, _ws):
            self.session_id = ""

    async def no_op(*_args, **_kwargs):
        return None

    async def fake_stream(*_args, **_kwargs):
        assert context_module.current_delegation_context() is context
        return ""

    def fake_build_agent(*, model, tools, **_kwargs):
        captured["model"] = model
        captured["tools"] = tools
        return object()

    monkeypatch.setattr(chat, "WebSocketCallback", _Callback)
    monkeypatch.setattr(chat, "_process_image_refs", lambda message: _value(message))
    monkeypatch.setattr(chat, "_get_provider_context", lambda _state: (256_000, "global-model"))
    monkeypatch.setattr(chat, "build_system_prompt", lambda: "system")
    monkeypatch.setattr(chat, "get_all_tools", lambda: [_PathTool()])
    monkeypatch.setattr(chat, "build_agent", fake_build_agent)
    monkeypatch.setattr(chat, "maybe_trim_checkpoint", no_op)
    monkeypatch.setattr(chat, "_calculate_context_usage", no_op)
    monkeypatch.setattr(chat, "_build_runtime_context_for_agent", lambda *_args: "")
    monkeypatch.setattr(chat, "_stream_turn", fake_stream)

    await chat._run_agent_turn(ws, session, "child work", private_mode=True)

    assert captured["model"] is inherited_model
    assert inherited_model.bind_kwargs == {"max_tokens": 123}
    assert len(captured["tools"]) == 1
    assert isinstance(captured["tools"][0], ScopedTool)
    assert context_module.current_delegation_context() is None


@pytest.mark.asyncio
async def test_top_level_delegation_inherits_the_parent_turn_model(monkeypatch):
    """A parent-selected provider must be visible to a tool called in its turn."""
    from api.routes import chat

    default_model = _Model()
    selected_model = _Model()
    selected_model.model_name = "requested-model"
    provider = SimpleNamespace(
        config=SimpleNamespace(id="requested-provider", context_window=64_000),
        default_model="requested-model",
        create_llm=lambda *_args, **_kwargs: selected_model,
    )
    manager = SimpleNamespace(
        count=1,
        get=lambda _provider_id: provider,
        iter_enabled=lambda: iter([provider]),
    )
    session = SimpleNamespace(
        session_id="parent-session",
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
        llm=default_model,
        provider_manager=manager,
        mcp_tools=[],
        episodic_mm=None,
        ltm=None,
        tools=[_PathTool()],
    )
    sent = []
    ws = SimpleNamespace(app=SimpleNamespace(state=app_state), send_json=lambda payload: _send(sent, payload))
    captured = {}

    class _Callback:
        def __init__(self, _ws):
            self.session_id = ""

    async def no_op(*_args, **_kwargs):
        return None

    async def fake_stream(*_args, **_kwargs):
        child_context = create_delegation_context(app_state, "parent-session")
        captured["model"] = child_context.model
        captured["provider_id"] = child_context.provider_id
        captured["model_name"] = child_context.model_name
        return ""

    monkeypatch.setattr(chat, "WebSocketCallback", _Callback)
    monkeypatch.setattr(chat, "_process_image_refs", lambda message: _value(message))
    monkeypatch.setattr(chat, "build_system_prompt", lambda: "system")
    monkeypatch.setattr(chat, "get_all_tools", lambda: [_PathTool()])
    monkeypatch.setattr(chat, "build_agent", lambda **_kwargs: object())
    monkeypatch.setattr(chat, "maybe_trim_checkpoint", no_op)
    monkeypatch.setattr(chat, "_calculate_context_usage", no_op)
    monkeypatch.setattr(chat, "_build_runtime_context_for_agent", lambda *_args: "")
    monkeypatch.setattr(chat, "_stream_turn", fake_stream)

    await chat._run_agent_turn(
        ws,
        session,
        "parent work",
        private_mode=True,
        provider_id="requested-provider",
        model_name="requested-model",
    )

    assert captured == {
        "model": selected_model,
        "provider_id": "requested-provider",
        "model_name": "requested-model",
    }
    assert context_module.current_delegation_context() is None


def test_subsession_auto_approve_cannot_exceed_parent_policy():
    from api.routes import chat

    session = SimpleNamespace(
        is_subagent=True,
        delegation_context=DelegationContext(auto_approve=False),
    )

    assert chat._effective_auto_approve(session, True) is False
    assert chat._effective_auto_approve(session, False) is False


@pytest.mark.asyncio
async def test_parallel_unconnected_children_reserve_fallback_budget(monkeypatch):
    from tools.sub_agent import tool_parallel
    from tools.sub_agent.tool_parallel import ParallelExecuteTool

    context = DelegationContext(
        model=_Model(),
        deadline_monotonic=time.monotonic() + 20,
    )
    created = []

    class _SessionManager:
        async def create_sub_session(self, task, parent_session_id):
            session = SimpleNamespace(
                session_id=f"child-{len(created)}",
                _pending_result=asyncio.get_running_loop().create_future(),
                _active_task=None,
            )
            created.append(session)
            return session

    class _Ws:
        url = "/ws/chat/parent-turn"
        app = SimpleNamespace(state=SimpleNamespace(session_manager=_SessionManager()))

        async def send_json(self, _payload):
            return None

    observed_waits = []
    background_calls = []

    async def timeout_wait(_future, timeout):
        observed_waits.append(timeout)
        raise asyncio.TimeoutError

    async def fake_background(self, sub, task, app_state, delegation_context):
        background_calls.append((sub.session_id, task, delegation_context.remaining_seconds()))
        return f"fallback:{task}"

    monkeypatch.setattr(
        tool_parallel.interaction,
        "current_ws",
        SimpleNamespace(get=lambda: _Ws()),
    )
    monkeypatch.setattr(tool_parallel, "create_delegation_context", lambda *_args, **_kwargs: context)
    monkeypatch.setattr(tool_parallel.asyncio, "wait_for", timeout_wait)
    monkeypatch.setattr(ParallelExecuteTool, "_run_background", fake_background)

    result = await ParallelExecuteTool()._do_run([
        {"task": "first"},
        {"task": "second"},
    ])

    assert '"succeeded": 2' in result
    assert len(background_calls) == 2
    assert all(0 < timeout < 20 for timeout in observed_waits)
    assert all(remaining > 0 for _, _, remaining in background_calls)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_module", "tool_class"),
    [
        ("tools.sub_agent.tool_call_sub_agent", "CallSubAgentTool"),
        ("tools.sub_agent.tool_parallel", "ParallelExecuteTool"),
    ],
)
@pytest.mark.parametrize("with_provider_manager", [True, False])
async def test_background_subagent_binds_child_session_and_provider_failover(
    monkeypatch, tool_module, tool_class, with_provider_manager
):
    """Fallback execution receives failover support without a child WebSocket."""
    import importlib

    from agent import graph
    from api import interaction

    module = importlib.import_module(tool_module)
    _stub_system_prompt(monkeypatch)
    runner = getattr(module, tool_class)()
    manager = _ProviderManager() if with_provider_manager else None
    model = _Model()
    context = DelegationContext(model=model, time_limit_seconds=30)
    pending = asyncio.get_running_loop().create_future()
    sub = SimpleNamespace(
        session_id="child-session",
        parent_session_id="parent-session",
        delegation_context=context,
        checkpointer=None,
        message_count=0,
        _pending_result=pending,
    )
    app_state = SimpleNamespace(
        tools=[_PathTool()],
        episodic_mm=None,
        provider_manager=manager,
    )
    captured = {}

    class _Agent:
        async def astream_events(self, *_args, **_kwargs):
            captured["session_id"] = interaction.current_session_id.get()
            captured["context"] = context_module.current_delegation_context()
            yield {
                "event": "on_chain_end",
                "name": "agent",
                "data": {"output": {"messages": [AIMessage(content="child answer")]}}
            }

    def fake_build_agent(**kwargs):
        captured["provider_manager"] = kwargs["provider_manager"]
        return _Agent()

    monkeypatch.setattr(graph, "build_agent", fake_build_agent)
    session_token = interaction.current_session_id.set("parent-session")
    outer_context = DelegationContext(trace_id="parent-context")
    context_token = context_module.activate_delegation_context(outer_context)
    try:
        answer = await runner._run_background(sub, "do work", app_state, context)
        assert answer == "child answer"
        assert captured["provider_manager"] is manager
        assert captured["session_id"] == "child-session"
        assert captured["context"] is context
        assert interaction.current_session_id.get() == "parent-session"
        assert context_module.current_delegation_context() is outer_context
    finally:
        context_module.reset_delegation_context(context_token)
        interaction.current_session_id.reset(session_token)


@pytest.mark.asyncio
async def test_background_subagent_restores_context_after_failure(monkeypatch):
    """An exception must not leak a child identity into the parent task."""
    from agent import graph
    from api import interaction
    from tools.sub_agent.tool_call_sub_agent import CallSubAgentTool

    _stub_system_prompt(monkeypatch)

    context = DelegationContext(model=_Model(), time_limit_seconds=30)
    sub = SimpleNamespace(
        session_id="child-session",
        parent_session_id="parent-session",
        delegation_context=context,
        checkpointer=None,
        message_count=0,
        _pending_result=asyncio.get_running_loop().create_future(),
    )
    app_state = SimpleNamespace(tools=[], episodic_mm=None, provider_manager=None)

    class _FailingAgent:
        async def astream_events(self, *_args, **_kwargs):
            assert interaction.current_session_id.get() == "child-session"
            assert context_module.current_delegation_context() is context
            raise RuntimeError("expected failure")
            yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(graph, "build_agent", lambda **_kwargs: _FailingAgent())
    session_token = interaction.current_session_id.set("parent-session")
    outer_context = DelegationContext(trace_id="parent-context")
    context_token = context_module.activate_delegation_context(outer_context)
    try:
        with pytest.raises(RuntimeError, match="expected failure"):
            await CallSubAgentTool()._run_background(sub, "do work", app_state, context)
        assert interaction.current_session_id.get() == "parent-session"
        assert context_module.current_delegation_context() is outer_context
    finally:
        context_module.reset_delegation_context(context_token)
        interaction.current_session_id.reset(session_token)


@pytest.mark.asyncio
async def test_delegation_context_freezes_approval_policy(monkeypatch):
    """A later parent auto-approve update cannot promote a delegated child."""
    from agent.approval_gateway import ApprovalDecision, approval_gateway
    from agent.approval_tool_node import ApprovalToolNode
    from api import interaction

    observed = {}

    async def fake_invoke(_state, _config):
        return {"messages": []}

    async def fake_request(*_args, **_kwargs):
        return ApprovalDecision.REJECTED

    def fake_authorize(tool_name, session_id, auto_approve, **_kwargs):
        observed.update(
            tool_name=tool_name,
            session_id=session_id,
            auto_approve=auto_approve,
        )
        from agent.approval_gateway import AuthorizationAction, AuthorizationDecision, ToolRisk
        return AuthorizationDecision(AuthorizationAction.ASK, "test", ToolRisk.LOCAL_WRITE)

    node = ApprovalToolNode([])
    node._inner_node = SimpleNamespace(ainvoke=fake_invoke)
    monkeypatch.setattr(node, "_request_approval", fake_request)
    monkeypatch.setattr(approval_gateway, "authorize", fake_authorize)

    session_token = interaction.current_session_id.set("parent-session")
    context_token = context_module.activate_delegation_context(
        DelegationContext(auto_approve=False)
    )
    interaction.set_session_auto_approve("parent-session", True)
    try:
        await node({
            "messages": [AIMessage(content="", tool_calls=[{
                "name": "file_write", "args": {}, "id": "call-1",
            }])]
        })
        assert observed == {
            "tool_name": "file_write",
            "session_id": "parent-session",
            "auto_approve": False,
        }
    finally:
        context_module.reset_delegation_context(context_token)
        interaction.current_session_id.reset(session_token)
        interaction.set_session_auto_approve("parent-session", False)


async def _send(target, payload):
    target.append(payload)


async def _value(value):
    return value
