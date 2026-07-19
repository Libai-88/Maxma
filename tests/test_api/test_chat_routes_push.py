"""覆盖率冲刺 — api/routes/chat.py 未覆盖分支。

针对以下未覆盖行：
- Line 78:  `raise RuntimeError("Sidecar client not available after start()")`
- Lines 90-103:  stale session 校验 try/except（成功 + 失败两条路径）
- Lines 112-128: past turns 历史恢复（成功 + 异常两条路径）
- Line 155: `_make_handler` 中 sid 不匹配时 return
- Lines 162-176: tool_start / tool_end / tool_error / error 事件分支
- Lines 185-186: `_on_answer` handler 设置 final_answer
- Lines 348-349: websocket_chat 中 append_turn 异常分支

不修改源代码，全部通过 mock + 直接调用 / WebSocket TestClient 覆盖。
"""

import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import chat as chat_mod
from api.routes.chat import _stream_turn_sidecar


# ---------------------------------------------------------------------------
# 共享辅助：构造 mock ws / session / sidecar_mgr / client
# ---------------------------------------------------------------------------


def _build_ws_session_mgr(handlers, *, sidecar_session_id=None):
    """构造 (ws, session, mock_client, mock_mgr)。

    handlers: dict，用于捕获 client.on(evt_type, handler) 注册的 handler。
    sidecar_session_id: session._sidecar_session_id 的初始值。
    """
    ws = MagicMock()
    ws.send_json = AsyncMock()

    mock_client = MagicMock()
    mock_client.is_running = True

    def on(evt_type, handler):
        handlers[evt_type] = handler
        return MagicMock()  # unsub callable

    mock_client.on = on
    mock_client.call = AsyncMock()

    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_mgr.client = mock_client

    ws.app.state.sidecar_manager = mock_mgr

    session = MagicMock()
    session.session_id = "maxma-session-1"
    session._sidecar_session_id = sidecar_session_id
    session._sidecar_mgr = None

    return ws, session, mock_client, mock_mgr


def _patch_session_map(sidecar_id=None, recent_turns=None,
                       append_turn_raises=False, remove_raises=False):
    """Patch chat_mod.SessionMap 为返回固定 mock 实例的 factory。

    返回 mock 实例（可用于断言）。
    """
    mock_instance = MagicMock()
    mock_instance.__enter__ = MagicMock(return_value=mock_instance)
    mock_instance.__exit__ = MagicMock(return_value=False)
    mock_instance.get_sidecar_id.return_value = sidecar_id
    mock_instance.get_recent_turns.return_value = recent_turns or []

    if append_turn_raises:
        mock_instance.append_turn.side_effect = RuntimeError("append_turn boom")
    if remove_raises:
        mock_instance.remove.side_effect = RuntimeError("remove boom")

    mock_instance.set_mapping = MagicMock()
    mock_instance.remove = MagicMock() if not remove_raises else mock_instance.remove
    return patch("api.routes.chat.SessionMap", return_value=mock_instance), mock_instance


# ---------------------------------------------------------------------------
# Line 78: RuntimeError when client is None after start()
# ---------------------------------------------------------------------------


class TestStreamTurnSidecarClientNone:
    async def test_raises_when_client_none_after_start(self):
        """mgr.start() 后 client 仍为 None 应抛 RuntimeError。"""
        ws = MagicMock()
        ws.app.state.sidecar_manager = MagicMock()
        ws.app.state.sidecar_manager.start = AsyncMock()
        ws.app.state.sidecar_manager.client = None  # 关键：client 为 None

        session = MagicMock()
        session.session_id = "s1"

        with pytest.raises(RuntimeError, match="Sidecar client not available"):
            await _stream_turn_sidecar(ws, session, "hello", "system prompt")


# ---------------------------------------------------------------------------
# Lines 90-103: Stale session validation
# ---------------------------------------------------------------------------


class TestStaleSessionValidation:
    """覆盖 sidecar_sid 存在时的校验 try/except 两条路径。"""

    async def test_existing_valid_session_skips_create(self):
        """lines 90-95: get_messages 成功 → sidecar_valid=True，不调 create_session。"""
        handlers = {}
        ws, session, mock_client, mock_mgr = _build_ws_session_mgr(
            handlers, sidecar_session_id=None,
        )

        # SessionMap 返回已有的 sidecar_id
        sm_patch, sm_inst = _patch_session_map(sidecar_id="sc-existing-1")
        with sm_patch:
            call_log = []

            async def mock_call(method, params=None, **kwargs):
                call_log.append((method, params))
                if method == "get_messages":
                    # 校验成功
                    return {"messages": []}
                if method == "prompt":
                    # 触发 done handler 完成回合
                    if "done" in handlers:
                        await handlers["done"]("sc-existing-1", {"payload": {}})
                    return {}
                return {}

            mock_client.call = mock_call

            final_answer = await _stream_turn_sidecar(
                ws, session, "hello", "system prompt",
            )

        # 验证：create_session 未被调用
        methods = [c[0] for c in call_log]
        assert "create_session" not in methods
        # get_messages 被调用了（校验）
        assert "get_messages" in methods
        # remove 未被调用（不需要清理）
        sm_inst.remove.assert_not_called()

    async def test_stale_session_cleared_and_recreated(self):
        """lines 96-103: get_messages 抛异常 → 清理 mapping → 重新 create_session。"""
        handlers = {}
        ws, session, mock_client, mock_mgr = _build_ws_session_mgr(
            handlers, sidecar_session_id=None,
        )

        sm_patch, sm_inst = _patch_session_map(sidecar_id="sc-stale-1")
        with sm_patch:
            call_log = []

            async def mock_call(method, params=None, **kwargs):
                call_log.append((method, params))
                if method == "get_messages":
                    # 第一次校验（limit=0）抛异常 → 触发 except 分支
                    raise RuntimeError("stale session")
                if method == "create_session":
                    return {"session_id": "sc-new-1"}
                if method == "prompt":
                    if "done" in handlers:
                        await handlers["done"]("sc-new-1", {"payload": {}})
                    return {}
                return {}

            mock_client.call = mock_call

            final_answer = await _stream_turn_sidecar(
                ws, session, "hello", "system prompt",
            )

        # 验证：stale session 被清理
        sm_inst.remove.assert_called_once_with("maxma-session-1")
        # 验证：新 session 被创建
        methods = [c[0] for c in call_log]
        assert "create_session" in methods
        # 验证：mapping 被更新为新 sid
        sm_inst.set_mapping.assert_called_once_with("maxma-session-1", "sc-new-1")


# ---------------------------------------------------------------------------
# Lines 112-128: Past turns restoration
# ---------------------------------------------------------------------------


class TestPastTurnsRestore:
    """覆盖 _past_turns 历史恢复块（成功 + 异常）。"""

    async def test_past_turns_appended_to_system_prompt(self):
        """lines 112-126: get_recent_turns 返回非空 → system_prompt 含历史上下文。"""
        handlers = {}
        ws, session, mock_client, mock_mgr = _build_ws_session_mgr(
            handlers, sidecar_session_id=None,
        )

        recent_turns = [
            {"user": "q1", "assistant": "a1"},
            {"user": "q2", "assistant": "a2"},
        ]
        sm_patch, sm_inst = _patch_session_map(
            sidecar_id=None, recent_turns=recent_turns,
        )
        with sm_patch:
            captured_create_params = {}

            async def mock_call(method, params=None, **kwargs):
                if method == "create_session":
                    captured_create_params.update(params)
                    return {"session_id": "sc-new-with-history"}
                if method == "prompt":
                    if "done" in handlers:
                        await handlers["done"](
                            "sc-new-with-history", {"payload": {}}
                        )
                    return {}
                return {}

            mock_client.call = mock_call

            await _stream_turn_sidecar(ws, session, "hello", "base-prompt")

        # 验证：create_session 的 system_prompt 包含历史上下文标记
        sp = captured_create_params["system_prompt"]
        assert "base-prompt" in sp
        assert "[历史对话上下文（共 2 轮）]" in sp
        assert "用户: q1" in sp
        assert "助理: a1" in sp
        assert "用户: q2" in sp
        assert "助理: a2" in sp

    async def test_past_turns_failure_logged_and_skipped(self, caplog):
        """lines 127-128: get_recent_turns 抛异常 → 记录 debug，仍用原始 prompt。"""
        handlers = {}
        ws, session, mock_client, mock_mgr = _build_ws_session_mgr(
            handlers, sidecar_session_id=None,
        )

        # 让 get_recent_turns 抛异常
        mock_instance = MagicMock()
        mock_instance.__enter__ = MagicMock(return_value=mock_instance)
        mock_instance.__exit__ = MagicMock(return_value=False)
        mock_instance.get_sidecar_id.return_value = None
        mock_instance.get_recent_turns.side_effect = RuntimeError("db locked")
        mock_instance.set_mapping = MagicMock()
        mock_instance.remove = MagicMock()

        captured_create_params = {}

        with patch("api.routes.chat.SessionMap", return_value=mock_instance):
            async def mock_call(method, params=None, **kwargs):
                if method == "create_session":
                    captured_create_params.update(params)
                    return {"session_id": "sc-fallback"}
                if method == "prompt":
                    if "done" in handlers:
                        await handlers["done"]("sc-fallback", {"payload": {}})
                    return {}
                return {}

            mock_client.call = mock_call

            with caplog.at_level(logging.DEBUG):
                await _stream_turn_sidecar(
                    ws, session, "hello", "original-prompt",
                )

        # 验证：create_session 用的是原始 system_prompt（无历史上下文）
        assert captured_create_params["system_prompt"] == "original-prompt"
        # 验证：异常被记录
        assert any(
            "Failed to restore past turns" in r.message
            for r in caplog.records
        )


# ---------------------------------------------------------------------------
# Lines 155, 162-176, 185-186: Event handler branches
# ---------------------------------------------------------------------------


class TestEventHandlerBranches:
    """覆盖 _make_handler 内各 evt_type 分支 + _on_answer + sid 不匹配。"""

    @staticmethod
    async def _run_to_capture_handlers(handlers, *, sidecar_id=None):
        """运行 _stream_turn_sidecar 到完成，捕获 handlers + 返回 sidecar_sid。

        sidecar_id: 若提供，SessionMap.get_sidecar_id 返回它（已有 session 路径）；
                    否则走 create_session 路径，sid 为 'sc-fresh'。
        """
        ws, session, mock_client, mock_mgr = _build_ws_session_mgr(handlers)

        sm_patch, _ = _patch_session_map(sidecar_id=sidecar_id)
        with sm_patch:
            async def mock_call(method, params=None, **kwargs):
                if method == "get_messages" and sidecar_id:
                    return {"messages": []}
                if method == "create_session":
                    return {"session_id": "sc-fresh"}
                if method == "prompt":
                    if "done" in handlers:
                        await handlers["done"](
                            sidecar_id or "sc-fresh", {"payload": {}}
                        )
                    return {}
                return {}

            mock_client.call = mock_call
            await _stream_turn_sidecar(ws, session, "hi", "sp")
            return ws, (sidecar_id or "sc-fresh")

    async def test_handler_returns_early_on_sid_mismatch(self):
        """line 155: sid != sidecar_sid 时 handler 直接 return，不调 ws.send_json。"""
        handlers = {}
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id="sc-real")

        # 重置 send_json mock
        ws.send_json.reset_mock()

        # 用不匹配的 sid 调 token handler
        await handlers["token"]("sc-wrong", {"payload": {"token": "t"}})
        ws.send_json.assert_not_called()

    async def test_tool_start_handler_sends_payload(self):
        """lines 162-165: tool_start 分支。"""
        handlers = {}
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id="sc-real")

        ws.send_json.reset_mock()
        await handlers["tool_start"]("sc-real", {
            "payload": {"tool_name": "search", "input": "q"},
        })

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.await_args.args[0]
        assert sent["type"] == "tool_start"
        assert sent["payload"]["tool_name"] == "search"
        assert sent["payload"]["input"] == "q"

    async def test_tool_end_handler_sends_payload(self):
        """lines 166-169: tool_end 分支。"""
        handlers = {}
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id="sc-real")

        ws.send_json.reset_mock()
        await handlers["tool_end"]("sc-real", {
            "payload": {"tool_name": "search", "output": "result", "elapsed": 42},
        })

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.await_args.args[0]
        assert sent["type"] == "tool_end"
        assert sent["payload"]["tool_name"] == "search"
        assert sent["payload"]["output"] == "result"
        assert sent["payload"]["elapsed"] == 42

    async def test_tool_error_handler_sends_payload(self):
        """lines 170-173: tool_error 分支。"""
        handlers = {}
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id="sc-real")

        ws.send_json.reset_mock()
        await handlers["tool_error"]("sc-real", {
            "payload": {"tool_name": "search", "error": "boom"},
        })

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.await_args.args[0]
        assert sent["type"] == "tool_error"
        assert sent["payload"]["tool_name"] == "search"
        assert sent["payload"]["error"] == "boom"

    async def test_error_handler_logs_and_sends(self, caplog):
        """lines 174-178: error 分支（含 logger.warning + ws.send_json）。"""
        handlers = {}
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id="sc-real")

        ws.send_json.reset_mock()
        with caplog.at_level(logging.WARNING):
            await handlers["error"]("sc-real", {
                "payload": {
                    "code": "INTERNAL",
                    "message": "something broke",
                },
            })

        ws.send_json.assert_awaited_once()
        sent = ws.send_json.await_args.args[0]
        assert sent["type"] == "error"
        assert sent["payload"]["code"] == "INTERNAL"
        assert sent["payload"]["message"] == "something broke"
        # logger.warning 被调用
        assert any(
            "Error for session" in r.message for r in caplog.records
        )

    async def test_on_answer_handler_sets_final_answer(self):
        """lines 185-186: _on_answer handler 设置 final_answer。"""
        handlers = {}
        # 这里走 create_session 路径，sid = sc-fresh
        ws, sid = await self._run_to_capture_handlers(handlers, sidecar_id=None)

        # 直接调 answer handler，验证 final_answer 被设置
        # _stream_turn_sidecar 已返回，final_answer 是函数返回值
        # 我们再次运行一次，但这次在 prompt 阶段触发 answer handler
        handlers2 = {}
        ws2, session2, mock_client2, _ = _build_ws_session_mgr(handlers2)
        sm_patch2, _ = _patch_session_map(sidecar_id=None)

        with sm_patch2:
            async def mock_call2(method, params=None, **kwargs):
                if method == "create_session":
                    return {"session_id": "sc-fresh2"}
                if method == "prompt":
                    # 触发 answer handler 设置 final_answer
                    if "answer" in handlers2:
                        await handlers2["answer"]("sc-fresh2", {
                            "payload": {"content": "the-answer"},
                        })
                    # 触发 done
                    if "done" in handlers2:
                        await handlers2["done"]("sc-fresh2", {"payload": {}})
                    return {}
                return {}

            mock_client2.call = mock_call2
            result = await _stream_turn_sidecar(ws2, session2, "hi", "sp")

        assert result == "the-answer"


# ---------------------------------------------------------------------------
# Lines 348-349: append_turn exception in websocket_chat
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


class TestAppendTurnException:
    """覆盖 websocket_chat 中 SessionMap.append_turn 抛异常的分支。"""

    def test_append_turn_exception_swallowed(self, monkeypatch):
        """lines 348-349: append_turn 抛异常应被 debug 日志吞掉，不影响 done。"""
        # patch _stream_turn_sidecar 返回固定 answer
        async def fake_stream(ws, session, user_message, system_prompt, model_config=None, cancel_event=None):
            return "final-answer"

        monkeypatch.setattr(chat_mod, "_stream_turn_sidecar", fake_stream)

        # patch build_system_prompt
        monkeypatch.setattr(chat_mod, "build_system_prompt", lambda: "sp")

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

        # 关键：patch SessionMap 让 append_turn 抛异常
        mock_sm = MagicMock()
        mock_sm.__enter__ = MagicMock(return_value=mock_sm)
        mock_sm.__exit__ = MagicMock(return_value=False)
        mock_sm.get_sidecar_id.return_value = None
        mock_sm.get_recent_turns.return_value = []
        mock_sm.set_mapping = MagicMock()
        mock_sm.remove = MagicMock()
        mock_sm.append_turn.side_effect = RuntimeError("db locked")
        monkeypatch.setattr(chat_mod, "SessionMap", lambda *a, **k: mock_sm)

        app = FastAPI()
        app.state.session_manager = _FakeChatSessionManager()
        app.state.ws_registry = _FakeWSRegistry()
        app.state.sidecar_manager = None
        app.include_router(chat_mod.router)

        with TestClient(app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "chat",
                "payload": {"message": "hi"},
            }))
            answer = ws.receive_json()
            assert answer["type"] == "answer"
            assert answer["payload"]["content"] == "final-answer"
            done = ws.receive_json()
            assert done["type"] == "done"

        # 验证 append_turn 确实被调用（并抛了异常）
        mock_sm.append_turn.assert_called_once()
