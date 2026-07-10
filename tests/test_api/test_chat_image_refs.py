"""Tests for chat image reference preprocessing."""

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest


def _load_chat_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "routes" / "chat.py"
    spec = importlib.util.spec_from_file_location("chat_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    fake_modules: dict[str, types.ModuleType] = {}

    def add_module(name: str, module_obj: types.ModuleType):
        if name not in fake_modules:
            fake_modules[name] = sys.modules.get(name)
        sys.modules[name] = module_obj

    def ensure_package(name: str):
        if name not in sys.modules:
            pkg = types.ModuleType(name)
            pkg.__path__ = []
            fake_modules[name] = None
            sys.modules[name] = pkg

    ensure_package("langchain_core")
    ensure_package("agent")
    ensure_package("api")
    ensure_package("api.callbacks")
    ensure_package("tools")

    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = lambda: types.SimpleNamespace(websocket=lambda *a, **k: (lambda fn: fn))
    fastapi.WebSocket = object
    fastapi.WebSocketDisconnect = type("WebSocketDisconnect", (Exception,), {})
    add_module("fastapi", fastapi)

    langchain_messages = types.ModuleType("langchain_core.messages")
    langchain_messages.AIMessage = object
    langchain_messages.HumanMessage = object
    langchain_messages.ToolMessage = object
    add_module("langchain_core.messages", langchain_messages)

    agent_graph = types.ModuleType("agent.graph")
    agent_graph.build_agent = lambda *args, **kwargs: None
    add_module("agent.graph", agent_graph)

    agent_prompts = types.ModuleType("agent.prompts")
    agent_prompts.build_system_prompt = lambda: ""
    agent_prompts.get_system_prompt_parts = lambda: {}
    add_module("agent.prompts", agent_prompts)

    context_manager = types.ModuleType("agent.context_manager")
    context_manager.maybe_trim_checkpoint = lambda *args, **kwargs: None
    context_manager.commit_to_episodic = lambda *args, **kwargs: None
    add_module("agent.context_manager", context_manager)

    interaction = types.ModuleType("api.interaction")
    interaction.current_ws = types.SimpleNamespace(set=lambda value: None)
    interaction.current_session_id = types.SimpleNamespace(get=lambda: "", set=lambda value: None)
    interaction.set_session_auto_approve = lambda *args, **kwargs: None
    interaction.cancel_session = lambda *args, **kwargs: None
    interaction.clear_session_settings = lambda *args, **kwargs: None
    interaction.resolve = lambda *args, **kwargs: True
    add_module("api.interaction", interaction)

    ws_callback = types.ModuleType("api.callbacks.websocket_callback")
    ws_callback.WebSocketCallback = object
    add_module("api.callbacks.websocket_callback", ws_callback)

    const_session = types.ModuleType("api.const_session_store")
    const_session.save_const_session = lambda *args, **kwargs: None
    const_session.serialize_messages = lambda *args, **kwargs: []
    add_module("api.const_session_store", const_session)

    context_usage = types.ModuleType("api.context_usage")
    context_usage.estimate_context_usage = lambda *args, **kwargs: {}
    add_module("api.context_usage", context_usage)

    errors = types.ModuleType("api.errors")
    errors.ErrorCode = types.SimpleNamespace(CANCELLED="cancelled", AGENT_ERROR="agent_error", NO_LLM="no_llm")
    errors.format_ws_error = lambda *args, **kwargs: {}
    add_module("api.errors", errors)

    session_manager = types.ModuleType("api.session_manager")
    session_manager.SessionState = object
    add_module("api.session_manager", session_manager)

    tools = types.ModuleType("tools")
    tools.select_tools_for_query = lambda *args, **kwargs: []
    tools.get_all_tools = lambda *args, **kwargs: []
    tools.merge_tool_lists = lambda primary, secondary, **kwargs: list(primary) + [
        t for t in (secondary or [])
    ]
    add_module("tools", tools)

    tools_base = types.ModuleType("tools.base")
    tools_base.format_error = lambda message: {"ok": False, "error": message}
    add_module("tools.base", tools_base)

    tools_path_security = types.ModuleType("tools.path_security")
    tools_path_security.check_path_access = lambda path: None
    add_module("tools.path_security", tools_path_security)

    sys.modules["api"].interaction = interaction

    try:
        spec.loader.exec_module(module)
    finally:
        for name, previous in fake_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous

    return module


chat = _load_chat_module()


def test_resolve_local_image_ref_strips_local_prefix_and_checks_resolved_path(
    tmp_path, monkeypatch
):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")
    checked_paths: list[str] = []

    def fake_check_path_access(path: str):
        checked_paths.append(path)
        return None

    monkeypatch.setattr(chat, "check_path_access", fake_check_path_access)

    resolved = chat._resolve_local_image_ref(f"local:{image_path}")

    assert resolved == image_path.resolve()
    assert checked_paths == [str(image_path.resolve())]


def test_resolve_local_image_ref_checks_plain_paths(tmp_path, monkeypatch):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")
    checked_paths: list[str] = []

    monkeypatch.setattr(
        chat,
        "check_path_access",
        lambda path: checked_paths.append(path) or None,
    )

    resolved = chat._resolve_local_image_ref(str(image_path))

    assert resolved == image_path.resolve()
    assert checked_paths == [str(image_path.resolve())]


def test_resolve_local_image_ref_rejects_blocked_paths(tmp_path, monkeypatch):
    image_path = tmp_path / "image.png"
    image_path.write_bytes(b"png")
    monkeypatch.setattr(chat, "check_path_access", lambda path: "blocked")

    with pytest.raises(PermissionError, match="blocked"):
        chat._resolve_local_image_ref(f"local:{image_path}")


def test_process_image_refs_preserves_local_ref_for_describer(monkeypatch):
    image_ref = r"local:C:\uploads\image.png"
    refs = [{"type": "image", "path": image_ref, "label": "screenshot"}]
    user_message = f"look\n__refs__{json.dumps(refs)}__/refs__"
    seen_refs: list[str] = []

    async def fake_describe(path: str):
        seen_refs.append(path)
        return "a window"

    monkeypatch.setattr(chat, "_describe_image", fake_describe)

    processed = asyncio.run(chat._process_image_refs(user_message))

    assert seen_refs == [image_ref]
    assert "[图片 screenshot: a window]" in processed
    assert "__refs__" in processed


def test_completed_turn_episodic_projection_delegates_without_llm(monkeypatch):
    calls = []

    async def fake_commit(graph, config, episodic_mm, **kwargs):
        calls.append((graph, config, episodic_mm, kwargs))
        return "ep_1234"

    monkeypatch.setattr(chat, "commit_to_episodic", fake_commit)

    asyncio.run(
        chat._project_completed_turn_to_episodic(
            graph="graph",
            config={"configurable": {"thread_id": "session-1"}},
            episodic_mm="manager",
            session_id="session-1",
            turn_id="turn-1",
        )
    )

    assert calls == [
        (
            "graph",
            {"configurable": {"thread_id": "session-1"}},
            "manager",
            {"session_id": "session-1", "turn_id": "turn-1"},
        )
    ]


def test_completed_turn_episodic_projection_contains_failure(monkeypatch, caplog):
    async def fake_commit(*args, **kwargs):
        raise RuntimeError("memory write failed")

    monkeypatch.setattr(chat, "commit_to_episodic", fake_commit)

    asyncio.run(
        chat._project_completed_turn_to_episodic(
            graph="graph",
            config={},
            episodic_mm="manager",
            session_id="session-1",
            turn_id="turn-1",
        )
    )

    assert "projection failed after completed response" in caplog.text
