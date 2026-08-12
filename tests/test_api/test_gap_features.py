"""GAP 新增功能测试（2026-08-12 能力差距开发批次）。

覆盖：
1. chat.py WS 转发：set_plan_mode / checkpoint_action → sidecar RPC
2. settings_panels.py TTS 配置规范化：历史 provider（edge-tts/openai-tts）
   读取/写入统一收敛为 system（GAP-A2-001）
3. tools.py 工具清单：generate_image 未注册（付费 API 原则，GAP-A4 已砍）
"""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.chat as chat_mod
from api.routes import settings_panels as panels_mod
from api.routes import tools as tools_mod


# ── WS 转发 ────────────────────────────────────────────────────────────────


class _FakeChatSession:
    """与 test_chat_routes_extra 同构的最小会话对象。"""

    def __init__(self, session_id="s1"):
        self.session_id = session_id
        self.auto_approve = False
        self.message_count = 0
        self.created_at = "2026-01-01T00:00:00Z"
        self._sidecar_mgr = None
        self._sidecar_session_id = None
        self.active_turn_ws = None
        self._last_model_key = None
        self._active_task = None
        self.recent_message_ids = []

    def persistent_metadata(self):
        return {"created_at": self.created_at}


class _FakeChatSessionManager:
    def __init__(self):
        self._sessions = {}

    async def get_or_create(self, session_id):
        if session_id not in self._sessions:
            self._sessions[session_id] = _FakeChatSession(session_id=session_id)
        return self._sessions[session_id]


class _FakeWSRegistry:
    def register(self, session_id, ws):
        pass

    def unregister(self, session_id, ws=None):
        pass


@pytest.fixture
def ws_app(monkeypatch):
    """最小 chat.router app，session 预置 sidecar 会话 id。"""
    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get_sidecar_id.return_value = "sc-1"
    inst.get_recent_turns.return_value = []
    inst.append_turn = MagicMock()
    inst.remove = MagicMock()
    inst.set_mapping = MagicMock()
    monkeypatch.setattr(chat_mod, "get_session_map", lambda: inst)
    monkeypatch.setattr(chat_mod, "build_system_prompt", lambda: "system-prompt")

    app = FastAPI()
    app.state.session_manager = _FakeChatSessionManager()
    app.state.ws_registry = _FakeWSRegistry()
    app.state.sidecar_manager = None
    app.include_router(chat_mod.router)

    # 预创建会话并绑定 sidecar 会话（绕过 create_session 路径）
    session = _FakeChatSession(session_id="s1")
    session._sidecar_session_id = "sc-1"
    app.state.session_manager._sessions["s1"] = session
    return app


class TestWebSocketGapForwarding:
    def _attach_client(self, ws_app):
        client = MagicMock()
        client.disconnected = asyncio.Event()
        client.call = AsyncMock(return_value={"ok": True})
        manager = MagicMock()
        manager.start = AsyncMock()
        manager.get_client = MagicMock(return_value=client)
        ws_app.state.sidecar_manager = manager
        return client

    def test_set_plan_mode_enable_forwarded(self, ws_app):
        client = self._attach_client(ws_app)
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "set_plan_mode",
                "payload": {"enabled": True},
            }))
        client.call.assert_any_await(
            "set_plan_mode", {"session_id": "sc-1", "enabled": True}
        )

    def test_set_plan_mode_disable_forwarded(self, ws_app):
        client = self._attach_client(ws_app)
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "set_plan_mode",
                "payload": {"enabled": False},
            }))
        client.call.assert_any_await(
            "set_plan_mode", {"session_id": "sc-1", "enabled": False}
        )

    def test_checkpoint_action_save_forwarded(self, ws_app):
        client = self._attach_client(ws_app)
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "checkpoint_action",
                "payload": {"action": "save", "goal": "before refactor"},
            }))
        client.call.assert_any_await(
            "checkpoint_action",
            {"session_id": "sc-1", "action": "save", "goal": "before refactor"},
        )

    def test_checkpoint_action_restore_forwarded(self, ws_app):
        client = self._attach_client(ws_app)
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "checkpoint_action",
                "payload": {"action": "restore"},
            }))
        client.call.assert_any_await(
            "checkpoint_action", {"session_id": "sc-1", "action": "restore"}
        )

    def test_set_plan_mode_without_sidecar_silently_skipped(self, ws_app, monkeypatch):
        """无 sidecar 会话时静默跳过（不抛错、不崩溃）——与其他 aux 消息一致。"""
        session = ws_app.state.session_manager._sessions["s1"]
        session._sidecar_session_id = None
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "set_plan_mode",
                "payload": {"enabled": True},
            }))
            # 连接仍可用（ping 有响应）
            ws.send_text(json.dumps({"type": "ping"}))
            assert ws.receive_json() == {"type": "pong"}

    def test_goal_action_set_forwarded(self, ws_app):
        client = self._attach_client(ws_app)
        client.call.return_value = {
            "ok": True,
            "action": "set",
            "state": {"enabled": True, "mode": "active", "goal": {"id": "g1", "objective": "完成周报", "status": "active"}},
        }
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "goal_action",
                "payload": {"action": "set", "objective": "完成周报"},
            }))
            # 回执以 goal_updated 事件推送前端
            evt = ws.receive_json()
            assert evt["type"] == "goal_updated"
            assert evt["payload"]["goal"]["objective"] == "完成周报"
            assert evt["payload"]["goal"]["status"] == "active"
        client.call.assert_any_await(
            "goal_action", {"session_id": "sc-1", "action": "set", "objective": "完成周报"}
        )

    def test_goal_action_pause_forwarded_without_state_event(self, ws_app):
        client = self._attach_client(ws_app)
        client.call.return_value = {"ok": True, "action": "pause", "state": None}
        with TestClient(ws_app).websocket_connect("/ws/chat/s1") as ws:
            ws.send_text(json.dumps({
                "type": "goal_action",
                "payload": {"action": "pause"},
            }))
        client.call.assert_any_await(
            "goal_action", {"session_id": "sc-1", "action": "pause"}
        )


# ── TTS 面板规范化（GAP-A2-001） ───────────────────────────────────────────


@pytest.fixture
def panels_app(tmp_path, monkeypatch):
    monkeypatch.setattr(panels_mod, "CONFIG_PATH", tmp_path / "panel_configs.json")
    monkeypatch.setattr(panels_mod, "LOCK_PATH", tmp_path / "panel_configs.json.lock")
    app = FastAPI()
    app.include_router(panels_mod.router)
    return app


class TestTtsConfigNormalization:
    def test_default_provider_is_system(self, panels_app):
        with TestClient(panels_app) as client:
            resp = client.get("/settings/tts")
            assert resp.status_code == 200
            assert resp.json()["provider"] == "system"

    def test_legacy_provider_normalized_on_read(self, panels_app):
        with TestClient(panels_app) as client:
            # 先写入历史值（旧版本面板遗留）
            assert client.put("/settings/tts", json={"provider": "edge-tts"}).status_code == 200
            resp = client.get("/settings/tts")
            assert resp.status_code == 200
            assert resp.json()["provider"] == "system"

    def test_legacy_provider_normalized_on_write(self, panels_app):
        with TestClient(panels_app) as client:
            resp = client.put("/settings/tts", json={"provider": "openai-tts"})
            assert resp.status_code == 200
            assert resp.json()["provider"] == "system"

    def test_system_provider_accepted(self, panels_app):
        with TestClient(panels_app) as client:
            resp = client.put("/settings/tts", json={"provider": "system", "enabled": True})
            assert resp.status_code == 200
            body = resp.json()
            assert body["provider"] == "system"
            assert body["enabled"] is True

    def test_unknown_provider_rejected(self, panels_app):
        with TestClient(panels_app) as client:
            resp = client.put("/settings/tts", json={"provider": "some-cloud-tts"})
            assert resp.status_code == 422


# ── 工具清单（GAP-A4 已砍：图片生成依赖付费 provider 图像 API） ─────────────


class TestToolListNoPaidApiTools:
    def test_generate_image_not_registered(self):
        names = [t["name"] for t in tools_mod._BUILTIN_TOOLS]
        assert "generate_image" not in names

    def test_tools_all_have_required_fields(self):
        for t in tools_mod._BUILTIN_TOOLS:
            assert t["name"]
            assert t["label"]
            assert t["category"]
            assert t.get("builtin") is True


# ── 会话闲置回顾端点（GAP-B3-001） ──────────────────────────────────────────


@pytest.fixture
def recap_app(monkeypatch):
    from api.routes import sessions as sessions_mod
    from api.pi_bridge import session_adapter

    class _Sess:
        def __init__(self):
            self._active_task = None
            self._sidecar_session_id = None

    manager = MagicMock()
    manager.get = AsyncMock(return_value=None)

    smap = MagicMock()
    smap.get_sidecar_id.return_value = None
    smap.remove_recent_turns = MagicMock()

    monkeypatch.setattr(session_adapter, "get_session_map", lambda: smap)

    app = FastAPI()
    app.state.session_manager = manager
    app.state.sidecar_manager = None
    app.include_router(sessions_mod.router)
    return app, manager, smap


class TestRecapEndpoint:
    def test_recap_404_when_session_missing(self, recap_app):
        app, manager, _ = recap_app
        manager.get.return_value = None
        with TestClient(app) as client:
            resp = client.post("/sessions/nope/recap")
            assert resp.status_code == 404

    def test_recap_409_when_agent_busy(self, recap_app):
        app, manager, _ = recap_app
        sess = MagicMock()
        sess._active_task = MagicMock()
        sess._active_task.done.return_value = False
        manager.get.return_value = sess
        with TestClient(app) as client:
            resp = client.post("/sessions/s1/recap")
            assert resp.status_code == 409

    def test_recap_503_without_sidecar(self, recap_app):
        app, manager, _ = recap_app
        sess = MagicMock()
        sess._active_task = None
        manager.get.return_value = sess
        with TestClient(app) as client:
            resp = client.post("/sessions/s1/recap")
            assert resp.status_code == 503

    def test_recap_calls_rpc_and_returns_answer(self, recap_app, monkeypatch):
        app, manager, smap = recap_app
        sess = MagicMock()
        sess._active_task = None
        sess._sidecar_session_id = "sc-1"
        manager.get.return_value = sess
        smap.get_sidecar_id.return_value = "sc-1"

        client_mock = MagicMock()
        client_mock.call = AsyncMock(return_value={"answer": "回顾：已完成 A，待办 B。", "status": "completed"})
        mgr = MagicMock()
        mgr.start = AsyncMock()
        mgr.get_client = AsyncMock(return_value=client_mock)
        app.state.sidecar_manager = mgr

        with TestClient(app) as client:
            resp = client.post("/sessions/s1/recap")
            assert resp.status_code == 200
            body = resp.json()
            assert body["answer"] == "回顾：已完成 A，待办 B。"
            assert body["status"] == "completed"
        client_mock.call.assert_any_await("session_recap", {"session_id": "sc-1"})


# ── 斜杠命令 /compact 端点（GAP-CMD-001） ───────────────────────────────────


class TestCompactEndpoint:
    def test_compact_404_when_session_missing(self, recap_app):
        app, manager, _ = recap_app
        manager.get.return_value = None
        with TestClient(app) as client:
            resp = client.post("/sessions/nope/compact")
            assert resp.status_code == 404

    def test_compact_409_when_agent_busy(self, recap_app):
        app, manager, _ = recap_app
        sess = MagicMock()
        sess._active_task = MagicMock()
        sess._active_task.done.return_value = False
        manager.get.return_value = sess
        with TestClient(app) as client:
            resp = client.post("/sessions/s1/compact")
            assert resp.status_code == 409

    def test_compact_invalid_keep_last_rejected(self, recap_app):
        app, manager, _ = recap_app
        sess = MagicMock()
        sess._active_task = None
        manager.get.return_value = sess
        with TestClient(app) as client:
            resp = client.post("/sessions/s1/compact?keep_last=0")
            assert resp.status_code == 400
            resp2 = client.post("/sessions/s1/compact?keep_last=9999")
            assert resp2.status_code == 400

    def test_compact_probes_stale_then_calls_rpc(self, recap_app):
        app, manager, smap = recap_app
        sess = MagicMock()
        sess._active_task = None
        sess._sidecar_session_id = "sc-1"
        manager.get.return_value = sess
        smap.get_sidecar_id.return_value = "sc-1"

        client_mock = MagicMock()
        client_mock.call = AsyncMock(side_effect=[
            {"ok": True},  # 探活 get_messages
            {"compressed": True, "removed_count": 42, "detail": "压缩完成"},
        ])
        mgr = MagicMock()
        mgr.start = AsyncMock()
        mgr.get_client = AsyncMock(return_value=client_mock)
        app.state.sidecar_manager = mgr

        with TestClient(app) as client:
            resp = client.post("/sessions/s1/compact?keep_last=20")
            assert resp.status_code == 200
            body = resp.json()
            assert body["compressed"] is True
            assert body["removed_count"] == 42
        client_mock.call.assert_any_await("compact", {"session_id": "sc-1", "keep_last": 20})

    def test_compact_stale_session_cleared(self, recap_app):
        app, manager, smap = recap_app
        sess = MagicMock()
        sess._active_task = None
        sess._sidecar_session_id = "sc-1"
        manager.get.return_value = sess
        smap.get_sidecar_id.return_value = "sc-1"

        client_mock = MagicMock()
        client_mock.call = AsyncMock(side_effect=Exception("Session not found"))
        mgr = MagicMock()
        mgr.start = AsyncMock()
        mgr.get_client = AsyncMock(return_value=client_mock)
        app.state.sidecar_manager = mgr

        with TestClient(app) as client:
            resp = client.post("/sessions/s1/compact")
            assert resp.status_code == 409
        smap.clear_sidecar_id.assert_called_once_with("s1")
