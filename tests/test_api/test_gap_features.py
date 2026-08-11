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
