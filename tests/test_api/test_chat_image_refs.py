"""Tests for chat image reference preprocessing."""

import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest


def _load_chat_module():
    module_path = Path(__file__).resolve().parents[2] / "api" / "routes" / "chat.py"
    spec = importlib.util.spec_from_file_location("chat_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    # 构建 mock 模块字典，用 patch.dict 原子注入 sys.modules
    mock_modules: dict[str, types.ModuleType] = {}

    def _make_pkg(name: str, attrs: dict | None = None) -> types.ModuleType:
        pkg = types.ModuleType(name)
        if attrs:
            for k, v in attrs.items():
                setattr(pkg, k, v)
        if "." not in name:
            pkg.__path__ = []
        return pkg

    mock_modules["fastapi"] = _make_pkg("fastapi", {
        "APIRouter": lambda: types.SimpleNamespace(websocket=lambda *a, **k: (lambda fn: fn)),
        "WebSocket": object,
        "WebSocketDisconnect": type("WebSocketDisconnect", (Exception,), {}),
    })
    mock_modules["langchain_core.messages"] = _make_pkg("langchain_core.messages", {
        "AIMessage": object,
        "HumanMessage": object,
        "ToolMessage": object,
    })
    mock_modules["agent.graph"] = _make_pkg("agent.graph", {"build_agent": lambda *a, **k: None})
    mock_modules["agent.prompts"] = _make_pkg("agent.prompts", {
        "build_system_prompt": lambda: "",
        "get_system_prompt_parts": lambda: {},
    })
    mock_modules["agent.context_manager"] = _make_pkg("agent.context_manager", {
        "maybe_trim_checkpoint": lambda *a, **k: None,
        "commit_to_episodic": lambda *a, **k: None,
    })
    mock_modules["api.interaction"] = _make_pkg("api.interaction", {
        "current_ws": types.SimpleNamespace(set=lambda value: None),
        "current_session_id": types.SimpleNamespace(get=lambda: "", set=lambda value: None),
        "set_session_auto_approve": lambda *a, **k: None,
        "cancel_session": lambda *a, **k: None,
        "clear_session_settings": lambda *a, **k: None,
        "resolve": lambda *a, **k: True,
    })
    mock_modules["api.callbacks.websocket_callback"] = _make_pkg("api.callbacks.websocket_callback", {
        "WebSocketCallback": object,
    })
    mock_modules["api.const_session_store"] = _make_pkg("api.const_session_store", {
        "save_const_session": lambda *a, **k: None,
        "serialize_messages": lambda *a, **k: [],
    })
    mock_modules["api.context_usage"] = _make_pkg("api.context_usage", {
        "estimate_context_usage": lambda *a, **k: {},
    })
    mock_modules["api.errors"] = _make_pkg("api.errors", {
        "ErrorCode": types.SimpleNamespace(
            CANCELLED="cancelled", AGENT_ERROR="agent_error", NO_LLM="no_llm"
        ),
        "format_ws_error": lambda *a, **k: {},
    })
    mock_modules["api.session_manager"] = _make_pkg("api.session_manager", {"SessionState": object})
    mock_modules["tools"] = _make_pkg("tools", {
        "select_tools_for_query": lambda *a, **k: [],
        "get_all_tools": lambda *a, **k: [],
        "merge_tool_lists": lambda primary, secondary, **k: list(primary) + list(secondary or []),
    })
    mock_modules["tools.base"] = _make_pkg("tools.base", {
        "format_error": lambda message: {"ok": False, "error": message},
    })
    mock_modules["tools.path_security"] = _make_pkg("tools.path_security", {
        "check_path_access": lambda path: None,
    })

    # 中间包也需要在 sys.modules 中（Python 包导入会检查父级）
    for parent in ("langchain_core", "agent", "api", "api.callbacks"):
        if parent not in sys.modules:
            mock_modules[parent] = _make_pkg(parent)

    with patch.dict(sys.modules, mock_modules, clear=False):
        spec.loader.exec_module(module)

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
