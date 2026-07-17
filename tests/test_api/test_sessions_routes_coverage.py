"""覆盖 — api/routes/sessions.py 剩余分支（lines 213,215,219,221,224,250,251,321,409,461）。

覆盖 _sync_const_session_after_undo 的早退分支与异常处理，
以及 get_context_usage / constify_session / generate_session_title 中
session._sidecar_session_id 回退分支。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import sessions as sessions_mod
from api.routes.sessions import router


# ---------------------------------------------------------------------------
# Fakes — 复用 test_sessions_routes_sidecar.py 中的模式
# ---------------------------------------------------------------------------


class _FakeTask:
    def __init__(self, done: bool = False) -> None:
        self._done = done

    def done(self) -> bool:
        return self._done


class _FakeSession:
    def __init__(
        self,
        session_id="s1",
        is_const=False,
        const_name="",
        permission_mode="ask",
        active_task=None,
        message_count=5,
    ):
        self.session_id = session_id
        self.is_const = is_const
        self.const_name = const_name
        self.permission_mode = permission_mode
        self.permission_mode_updated_at = "2026-01-01T00:00:00Z"
        self._active_task = active_task
        self.message_count = message_count
        self.created_at = "2026-01-01T00:00:00Z"
        self._sidecar_session_id = None
        self._sidecar_mgr = None

    def set_permission_mode(self, mode):
        if mode not in ("read_only", "ask", "operate", "auto"):
            raise ValueError(f"bad mode: {mode}")
        self.permission_mode = mode

    def persistent_metadata(self):
        return {"created_at": self.created_at, "message_count": self.message_count}


class _FakeSessionManager:
    def __init__(self, sessions=None):
        self._sessions = sessions or {}

    async def create(self):
        sid = f"s{len(self._sessions) + 1}"
        s = _FakeSession(session_id=sid)
        self._sessions[sid] = s
        return s

    async def list_sessions(self):
        return [
            {"session_id": sid, "created_at": s.created_at}
            for sid, s in self._sessions.items()
        ]

    async def get(self, session_id):
        return self._sessions.get(session_id)

    async def delete(self, session_id):
        return self._sessions.pop(session_id, None) is not None


class _FakeSidecarManager:
    def __init__(self, client=None):
        self.client = client
        self.started = False

    async def start(self):
        self.started = True


def _make_session_map_mock(sidecar_id=None, recent_turns=None):
    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get_sidecar_id.return_value = sidecar_id
    inst.get_recent_turns.return_value = recent_turns or []
    inst.remove.return_value = True
    return inst


def _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=None):
    inst = _make_session_map_mock(sidecar_id=sidecar_id, recent_turns=recent_turns)
    monkeypatch.setattr(
        "api.pi_bridge.session_adapter.SessionMap",
        lambda *a, **k: inst,
    )
    return inst


@pytest.fixture
def app_with_sidecar(monkeypatch):
    """创建带 _FakeSidecarManager 的 app。"""
    monkeypatch.setattr(sessions_mod, "_permission_modes_enabled", lambda: False)
    client = AsyncMock()
    sm = _FakeSidecarManager(client=client)
    app = FastAPI()
    app.state.session_manager = _FakeSessionManager()
    app.state.system_prompt = "system prompt"
    app.state.sidecar_manager = sm
    app.state.llm = None
    app.include_router(router)
    return {"app": app, "client": TestClient(app), "sidecar": sm, "rpc_client": client}


# ---------------------------------------------------------------------------
# _sync_const_session_after_undo — 早退分支
# ---------------------------------------------------------------------------


class TestSyncConstSessionAfterUndoEarlyReturns:
    async def test_no_sidecar_id_from_map_or_session_returns(self, monkeypatch):
        """Lines 213, 215: SessionMap 返回 None + session._sidecar_session_id=None → return。"""
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        session._sidecar_session_id = None
        _patch_session_map(monkeypatch, sidecar_id=None)
        # 应直接返回，不抛异常
        await sessions_mod._sync_const_session_after_undo(session, deleted=1)

    async def test_no_sidecar_mgr_returns(self, monkeypatch):
        """Lines 219, 221: sidecar_mgr=None + session._sidecar_mgr=None → return。"""
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        session._sidecar_session_id = "sc-1"  # sidecar_id 存在
        session._sidecar_mgr = None
        _patch_session_map(monkeypatch, sidecar_id=None)  # SessionMap 返回 None
        # sidecar_mgr 参数为 None，session._sidecar_mgr 也是 None → return
        await sessions_mod._sync_const_session_after_undo(session, deleted=1)

    async def test_sidecar_mgr_client_none_returns(self, monkeypatch):
        """Line 224: sidecar_mgr.client is None → return。"""
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        session._sidecar_session_id = "sc-1"
        mgr = _FakeSidecarManager(client=None)  # client is None
        _patch_session_map(monkeypatch, sidecar_id=None)
        await sessions_mod._sync_const_session_after_undo(
            session, deleted=1, sidecar_mgr=mgr
        )


class TestSyncConstSessionAfterUndoException:
    async def test_exception_logs_warning(self, monkeypatch):
        """Lines 250, 251: try 块内抛异常 → except + logger.warning。"""
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        session._sidecar_session_id = "sc-1"

        _patch_session_map(monkeypatch, sidecar_id=None)

        client = AsyncMock()
        client.call = AsyncMock(side_effect=RuntimeError("sidecar boom"))
        mgr = _FakeSidecarManager(client=client)

        # patch save_const_session 防止真实写入
        monkeypatch.setattr(
            "api.const_session_store.save_const_session", lambda *a, **k: None
        )

        # 不应抛异常（被 except 捕获）
        await sessions_mod._sync_const_session_after_undo(
            session, deleted=1, sidecar_mgr=mgr
        )


# ---------------------------------------------------------------------------
# get_context_usage — line 321
# ---------------------------------------------------------------------------


class TestGetContextUsageSidecarIdFallback:
    def test_uses_session_sidecar_id_when_map_misses(self, app_with_sidecar, monkeypatch):
        """Line 321: SessionMap 返回 None + session._sidecar_session_id 有值。"""
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        session._sidecar_session_id = "from-session"
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id=None)
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={"messages": [{"content": "ab"}]})

        resp = app_with_sidecar["client"].get("/sessions/s1/context-usage")
        assert resp.status_code == 200
        # 验证 client.call 使用了 from-session
        called_args = client.call.call_args
        params = called_args.args[1] if called_args.args else called_args.kwargs.get("params")
        assert params["session_id"] == "from-session"


# ---------------------------------------------------------------------------
# constify_session — line 409
# ---------------------------------------------------------------------------


class TestConstifySidecarIdFallback:
    def test_uses_session_sidecar_id_when_map_misses(self, app_with_sidecar, monkeypatch):
        """Line 409: SessionMap 返回 None + session._sidecar_session_id 有值。"""
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", active_task=_FakeTask(done=True))
        session._sidecar_session_id = "from-session"
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id=None)
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={"messages": []})

        monkeypatch.setattr(
            "api.const_session_store.save_const_session", lambda *a, **k: None
        )

        resp = app_with_sidecar["client"].post(
            "/sessions/s1/const", json={"name": "c1"}
        )
        assert resp.status_code == 200
        # 验证 client.call 使用了 from-session
        called_args = client.call.call_args
        params = called_args.args[1] if called_args.args else called_args.kwargs.get("params")
        assert params["session_id"] == "from-session"


# ---------------------------------------------------------------------------
# generate_session_title — line 461
# ---------------------------------------------------------------------------


class TestGenerateTitleSidecarIdFallback:
    def test_uses_session_sidecar_id_when_map_misses(self, app_with_sidecar, monkeypatch):
        """Line 461: SessionMap 返回 None + session._sidecar_session_id 有值。"""
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        session._sidecar_session_id = "from-session"
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id=None)
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={"messages": [{"role": "user", "content": "x"}]})

        # mock LLM
        class FakeResp:
            content = "标题"

        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(return_value=FakeResp())

        resp = app_with_sidecar["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 200
        assert resp.json()["title"] == "标题"
        # 验证 client.call 使用了 from-session
        called_args = client.call.call_args
        params = called_args.args[1] if called_args.args else called_args.kwargs.get("params")
        assert params["session_id"] == "from-session"
