"""补充测试 — api/routes/chat.py 的 helper 函数 + WebSocket 端点。

直接调用 _get_messages_from_sidecar / _calculate_context_usage / _new_turn_id /
_save_const_session 覆盖纯函数逻辑；通过 TestClient.websocket_connect 覆盖
websocket_chat 的消息分发与 happy path。
"""

import asyncio
import json
import logging
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import chat as chat_mod
from api.routes.chat import (
    _calculate_context_usage,
    _get_messages_from_sidecar,
    _new_turn_id,
    _save_const_session,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeChatSession:
    def __init__(self, session_id="s1", is_const=False, const_name="",
                 message_count=0):
        self.session_id = session_id
        self.is_const = is_const
        self.const_name = const_name
        self.message_count = message_count
        self.created_at = "2026-01-01T00:00:00Z"
        self._sidecar_mgr = None
        self._sidecar_session_id = None

    def persistent_metadata(self):
        return {"created_at": self.created_at}


class _FakeChatSessionManager:
    def __init__(self, session=None):
        self._default = session
        self._sessions = {}

    async def get_or_create(self, session_id):
        if self._default is not None:
            return self._default
        if session_id not in self._sessions:
            self._sessions[session_id] = _FakeChatSession(session_id=session_id)
        return self._sessions[session_id]


class _FakeWSRegistry:
    def __init__(self):
        self.registered = []
        self.unregistered = []

    def register(self, session_id, ws):
        self.registered.append(session_id)

    def unregister(self, session_id):
        self.unregistered.append(session_id)


class _FakeSidecarMgr:
    def __init__(self, client=None):
        self.client = client
        self.started = False

    async def start(self):
        self.started = True


def _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=None):
    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get_sidecar_id.return_value = sidecar_id
    inst.get_recent_turns.return_value = recent_turns or []
    inst.append_turn = MagicMock()
    inst.remove = MagicMock()
    inst.set_mapping = MagicMock()
    factory = lambda *a, **k: inst
    # chat.py 在模块级别 from ... import SessionMap，所以必须 patch chat_mod 的引用
    monkeypatch.setattr(chat_mod, "SessionMap", factory)
    # 同时 patch 源模块，以防有局部 import 路径
    monkeypatch.setattr(
        "api.pi_bridge.session_adapter.SessionMap",
        factory,
    )
    return inst


# ===========================================================================
# _get_messages_from_sidecar
# ===========================================================================


class TestGetMessagesFromSidecar:
    async def test_no_mgr_returns_empty(self):
        session = _FakeChatSession()
        session._sidecar_mgr = None
        result = await _get_messages_from_sidecar(session, sidecar_mgr=None)
        assert result == []

    async def test_uses_session_sidecar_mgr_when_arg_none(self):
        session = _FakeChatSession()
        mgr = _FakeSidecarMgr(client=None)
        session._sidecar_mgr = mgr
        # sidecar_mgr=None 应回退到 session._sidecar_mgr
        result = await _get_messages_from_sidecar(session, sidecar_mgr=None)
        assert result == []
        assert mgr.started is True

    async def test_no_client_returns_empty(self, monkeypatch):
        session = _FakeChatSession()
        mgr = _FakeSidecarMgr(client=None)
        result = await _get_messages_from_sidecar(session, sidecar_mgr=mgr)
        assert result == []
        assert mgr.started is True

    async def test_no_sidecar_id_returns_empty(self, monkeypatch):
        session = _FakeChatSession()
        client = AsyncMock()
        mgr = _FakeSidecarMgr(client=client)
        _patch_session_map(monkeypatch, sidecar_id=None)
        # session._sidecar_session_id 也是 None
        result = await _get_messages_from_sidecar(session, sidecar_mgr=mgr)
        assert result == []

    async def test_uses_session_sidecar_session_id_when_map_misses(self, monkeypatch):
        session = _FakeChatSession()
        session._sidecar_session_id = "from-session"
        client = AsyncMock(return_value={"messages": [{"content": "x"}]})
        client.call = AsyncMock(return_value={"messages": [{"content": "x"}]})
        mgr = _FakeSidecarMgr(client=client)
        _patch_session_map(monkeypatch, sidecar_id=None)

        result = await _get_messages_from_sidecar(session, sidecar_mgr=mgr)
        assert result == [{"content": "x"}]
        client.call.assert_awaited_once()
        args = client.call.call_args
        params = args.args[1] if args.args else args.kwargs.get("params")
        assert params["session_id"] == "from-session"

    async def test_success_returns_messages(self, monkeypatch):
        session = _FakeChatSession()
        client = AsyncMock()
        client.call = AsyncMock(return_value={
            "messages": [{"role": "user", "content": "hi"}]
        })
        mgr = _FakeSidecarMgr(client=client)
        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        result = await _get_messages_from_sidecar(session, sidecar_mgr=mgr)
        assert result == [{"role": "user", "content": "hi"}]

    async def test_exception_returns_empty(self, monkeypatch):
        session = _FakeChatSession()
        client = AsyncMock()
        client.call = AsyncMock(side_effect=RuntimeError("boom"))
        mgr = _FakeSidecarMgr(client=client)
        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        result = await _get_messages_from_sidecar(session, sidecar_mgr=mgr)
        assert result == []

    async def test_respects_limit_param(self, monkeypatch):
        session = _FakeChatSession()
        client = AsyncMock()
        client.call = AsyncMock(return_value={"messages": []})
        mgr = _FakeSidecarMgr(client=client)
        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        await _get_messages_from_sidecar(session, limit=10, sidecar_mgr=mgr)
        args = client.call.call_args
        params = args.args[1] if args.args else args.kwargs.get("params")
        assert params["limit"] == 10


# ===========================================================================
# _calculate_context_usage
# ===========================================================================


class TestCalculateContextUsage:
    async def test_basic_math(self, monkeypatch):
        session = _FakeChatSession()
        # mock _get_messages_from_sidecar 返回已知内容
        async def fake_get(session, limit=50, *, sidecar_mgr=None):
            return [{"content": "ab"}, {"content": "cde"}]  # 5 chars

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        # system_prompt = "sp" (2 chars) → total 7 → 7/2 = 3
        usage = await _calculate_context_usage(session, "sp")
        assert usage["estimated_tokens"] == 3
        assert usage["max_tokens"] == 256_000
        assert usage["message_count"] == 2
        assert usage["model_name"] == ""
        assert usage["percentage"] == 0  # 3 / 256000 * 100 = 0 (int)

    async def test_zero_messages(self, monkeypatch):
        session = _FakeChatSession()

        async def fake_get(session, limit=50, *, sidecar_mgr=None):
            return []

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        usage = await _calculate_context_usage(session, "")
        assert usage["estimated_tokens"] == 0
        assert usage["message_count"] == 0
        assert usage["percentage"] == 0

    async def test_caps_percentage_at_100(self, monkeypatch):
        session = _FakeChatSession()

        async def fake_get(session, limit=50, *, sidecar_mgr=None):
            return [{"content": "x" * 1_000_000}]

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        usage = await _calculate_context_usage(session, "sp")
        assert usage["percentage"] == 100

    async def test_system_prompt_none_treated_as_empty(self, monkeypatch):
        session = _FakeChatSession()

        async def fake_get(session, limit=50, *, sidecar_mgr=None):
            return []

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        usage = await _calculate_context_usage(session, None)
        assert usage["estimated_tokens"] == 0

    async def test_custom_max_tokens_and_model_name(self, monkeypatch):
        session = _FakeChatSession()

        async def fake_get(session, limit=50, *, sidecar_mgr=None):
            return [{"content": "x" * 200}]  # 200 chars → 100 tokens

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        usage = await _calculate_context_usage(
            session, "", max_tokens=1000, model_name="gpt-4"
        )
        assert usage["max_tokens"] == 1000
        assert usage["model_name"] == "gpt-4"
        assert usage["percentage"] == 10  # 100/1000 = 10%


# ===========================================================================
# _new_turn_id
# ===========================================================================


class TestNewTurnId:
    def test_valid_string_kept(self):
        assert _new_turn_id("abc123") == "abc123"

    def test_strips_whitespace(self):
        assert _new_turn_id("  x  ") == "x"

    def test_empty_string_after_strip_replaced(self):
        result = _new_turn_id("   ")
        # 应返回 uuid hex（32 字符）
        assert len(result) == 32
        assert result == uuid.uuid4().hex or _is_uuid_hex(result)

    def test_too_long_replaced(self):
        long_str = "x" * 129
        result = _new_turn_id(long_str)
        assert len(result) == 32

    def test_exactly_128_chars_kept(self):
        s = "x" * 128
        assert _new_turn_id(s) == s

    def test_non_string_replaced(self):
        assert _is_uuid_hex(_new_turn_id(None))
        assert _is_uuid_hex(_new_turn_id(123))
        assert _is_uuid_hex(_new_turn_id(["not", "string"]))

    def test_none_replaced(self):
        assert _is_uuid_hex(_new_turn_id(None))

    def test_default_arg_replaced(self):
        assert _is_uuid_hex(_new_turn_id())


def _is_uuid_hex(s: str) -> bool:
    """检查字符串是否是 32 位 hex（uuid4().hex 格式）。"""
    if not isinstance(s, str) or len(s) != 32:
        return False
    try:
        int(s, 16)
        return True
    except ValueError:
        return False


# ===========================================================================
# _save_const_session
# ===========================================================================


class TestSaveConstSession:
    async def test_skips_when_no_messages(self, monkeypatch):
        session = _FakeChatSession(is_const=True, const_name="c1")

        async def fake_get(session_, limit=200, *, sidecar_mgr=None):
            return []

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        save_mock = MagicMock()
        monkeypatch.setattr("api.routes.chat.save_const_session", save_mock)

        await _save_const_session(session, "final")
        save_mock.assert_not_called()

    async def test_serializes_and_replaces_last_ai(self, monkeypatch):
        session = _FakeChatSession(is_const=True, const_name="c1")

        async def fake_get(session_, limit=200, *, sidecar_mgr=None):
            return [
                {"role": "user", "content": "q1"},
                {"role": "assistant", "content": "old-answer"},
                {"role": "user", "content": "q2"},
                {"role": "assistant", "content": "to-be-replaced"},
            ]

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        saved = {"args": None}

        def fake_save(sid, name, meta, msgs):
            saved["args"] = (sid, name, meta, msgs)

        monkeypatch.setattr("api.routes.chat.save_const_session", fake_save)

        await _save_const_session(session, "new-final-answer")
        assert saved["args"] is not None
        sid, name, meta, msgs = saved["args"]
        assert sid == "s1"
        assert name == "c1"
        # 最后一个 ai 消息的 content 被替换
        assert msgs[-1] == {"type": "ai", "content": "new-final-answer"}
        # 其它消息不变
        assert msgs[0] == {"type": "human", "content": "q1"}
        assert msgs[1] == {"type": "ai", "content": "old-answer"}
        assert msgs[2] == {"type": "human", "content": "q2"}

    async def test_no_ai_message_does_not_replace(self, monkeypatch):
        session = _FakeChatSession(is_const=True, const_name="c1")

        async def fake_get(session_, limit=200, *, sidecar_mgr=None):
            return [{"role": "user", "content": "only-user"}]

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        saved = {"msgs": None}

        def fake_save(sid, name, meta, msgs):
            saved["msgs"] = msgs

        monkeypatch.setattr("api.routes.chat.save_const_session", fake_save)

        await _save_const_session(session, "final")
        # 没有 ai 消息，不替换任何内容
        assert saved["msgs"] == [{"type": "human", "content": "only-user"}]

    async def test_unknown_role_filtered_out(self, monkeypatch):
        session = _FakeChatSession(is_const=True, const_name="c1")

        async def fake_get(session_, limit=200, *, sidecar_mgr=None):
            return [
                {"role": "user", "content": "q"},
                {"role": "tool", "content": "tool-output"},
                {"role": "assistant", "content": "a"},
            ]

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)
        saved = {"msgs": None}

        def fake_save(sid, name, meta, msgs):
            saved["msgs"] = msgs

        monkeypatch.setattr("api.routes.chat.save_const_session", fake_save)

        await _save_const_session(session, "final")
        # 只有 user / assistant 被序列化
        assert saved["msgs"] == [
            {"type": "human", "content": "q"},
            {"type": "ai", "content": "final"},
        ]

    async def test_exception_logged_not_raised(self, monkeypatch, caplog):
        session = _FakeChatSession(is_const=True, const_name="c1")

        async def fake_get(session_, limit=200, *, sidecar_mgr=None):
            return [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]

        monkeypatch.setattr(chat_mod, "_get_messages_from_sidecar", fake_get)

        def boom(*a, **k):
            raise RuntimeError("save failed")

        monkeypatch.setattr("api.routes.chat.save_const_session", boom)

        with caplog.at_level(logging.WARNING):
            # 不应抛异常
            await _save_const_session(session, "final")
        assert any("[const]" in r.message or "Failed" in r.message for r in caplog.records)


# ===========================================================================
# websocket_chat (via TestClient)
# ===========================================================================


@pytest.fixture
def ws_app(monkeypatch):
    """构建带 chat.router 的最小 app，patch 依赖。"""
    _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=[])

    # patch build_system_prompt
    monkeypatch.setattr(chat_mod, "build_system_prompt", lambda: "system-prompt")

    # patch _calculate_context_usage 避免触发 sidecar
    async def fake_calc(session, system_prompt, **kwargs):
        return {
            "estimated_tokens": 0,
            "max_tokens": 256_000,
            "percentage": 0,
            "message_count": 0,
            "model_name": "",
        }
    monkeypatch.setattr(chat_mod, "_calculate_context_usage", fake_calc)

    app = FastAPI()
    app.state.session_manager = _FakeChatSessionManager()
    app.state.ws_registry = _FakeWSRegistry()
    app.state.sidecar_manager = None
    app.include_router(chat_mod.router)
    return app


class TestWebSocketChat:
    def test_ping_pong(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({"type": "ping"}))
            msg = ws.receive_json()
            assert msg == {"type": "pong"}

    def test_invalid_json_skipped(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text("not-json")
            # 发一个 ping 验证连接仍活
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_non_dict_json_skipped(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps([1, 2, 3]))  # 合法 JSON 但是 list
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_non_chat_type_skipped(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({"type": "other", "payload": {}}))
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_empty_message_skipped(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "   "}
            }))
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_non_dict_payload_skipped(self, ws_app):
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({"type": "chat", "payload": "not-dict"}))
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_happy_path_returns_answer_and_done(
        self, ws_app, monkeypatch
    ):
        # patch _stream_turn_sidecar 返回固定 answer
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return f"echo:{user_message}"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "payload": {"message": "hello", "turn_id": "my-turn-id"},
            }))
            answer = ws.receive_json()
            assert answer["type"] == "answer"
            assert answer["payload"]["content"] == "echo:hello"
            done = ws.receive_json()
            assert done["type"] == "done"
            assert done["payload"]["turn_id"] == "my-turn-id"
            assert "context_usage" in done["payload"]

        # 验证 session message_count 增加
        session = ws_app.state.session_manager._sessions["s1"]
        assert session.message_count == 2

    def test_happy_path_increments_message_count(
        self, ws_app, monkeypatch
    ):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "answer"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)
        session = _FakeChatSession(session_id="s2", message_count=10)
        ws_app.state.session_manager._default = session

        with TestClient(ws_app).websocket_connect("/ws/chat/s2") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "hi"}
            }))
            ws.receive_json()  # answer
            ws.receive_json()  # done

        assert session.message_count == 12

    def test_empty_final_answer_skips_message_count(
        self, ws_app, monkeypatch
    ):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return ""  # 空 answer

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)
        session = _FakeChatSession(session_id="s3", message_count=5)
        ws_app.state.session_manager._default = session

        with TestClient(ws_app).websocket_connect("/ws/chat/s3") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "hi"}
            }))
            done = ws.receive_json()
            assert done["type"] == "done"
        # 空 answer 不增加 message_count
        assert session.message_count == 5

    def test_const_session_triggers_save(
        self, ws_app, monkeypatch
    ):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "final-answer"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        saved = {"called": False}

        async def fake_save_const(session, final_answer):
            saved["called"] = True
            saved["final"] = final_answer

        monkeypatch.setattr(chat_mod, "_save_const_session", fake_save_const)

        session = _FakeChatSession(session_id="s4", is_const=True, const_name="c1")
        ws_app.state.session_manager._default = session

        with TestClient(ws_app).websocket_connect("/ws/chat/s4") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "hi"}
            }))
            ws.receive_json()  # answer
            ws.receive_json()  # done

        assert saved["called"] is True
        assert saved["final"] == "final-answer"

    def test_non_const_session_does_not_trigger_save(
        self, ws_app, monkeypatch
    ):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "answer"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)
        save_called = {"v": False}

        async def fake_save_const(session, final_answer):
            save_called["v"] = True

        monkeypatch.setattr(chat_mod, "_save_const_session", fake_save_const)

        session = _FakeChatSession(session_id="s5", is_const=False)
        ws_app.state.session_manager._default = session

        with TestClient(ws_app).websocket_connect("/ws/chat/s5") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "hi"}
            }))
            ws.receive_json()  # answer
            ws.receive_json()  # done

        assert save_called["v"] is False

    def test_ws_registers_and_unregisters(self, ws_app, monkeypatch):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "x"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        with TestClient(ws_app).websocket_connect("/ws/chat/s6") as ws:
            ws.send_text(json.dumps({
                "type": "chat", "payload": {"message": "hi"}
            }))
            ws.receive_json()
            ws.receive_json()

        registry = ws_app.state.ws_registry
        assert "s6" in registry.registered
        assert "s6" in registry.unregistered

    def test_done_message_has_turn_id_from_payload(self, ws_app, monkeypatch):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "x"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        with TestClient(ws_app).websocket_connect("/ws/chat/s7") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "payload": {"message": "hi", "turn_id": "client-turn-1"},
            }))
            ws.receive_json()  # answer
            done = ws.receive_json()
            assert done["payload"]["turn_id"] == "client-turn-1"

    def test_done_message_generates_turn_id_when_missing(self, ws_app, monkeypatch):
        async def fake_stream(ws, session, user_message, system_prompt, cancel_event=None):
            return "x"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        with TestClient(ws_app).websocket_connect("/ws/chat/s8") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "payload": {"message": "hi"},  # 无 turn_id
            }))
            ws.receive_json()  # answer
            done = ws.receive_json()
            # 应自动生成 32 位 hex
            assert len(done["payload"]["turn_id"]) == 32
