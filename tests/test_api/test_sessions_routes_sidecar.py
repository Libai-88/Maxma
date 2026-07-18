"""补充测试 — api/routes/sessions.py 的 sidecar / const / title / undo / context-usage 路径。

扩展已有的 _FakeSession/_FakeSessionManager 模式，加入 _FakeSidecarManager，
并 patch SessionMap 以覆盖所有 sidecar 依赖分支。
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import sessions as sessions_mod
from api.routes.sessions import router


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeTask:
    """模拟 asyncio.Task 的 done() 行为。"""

    def __init__(self, done: bool = False) -> None:
        self._done = done

    def done(self) -> bool:
        return self._done


class _FakeSession:
    def __init__(self, session_id="s1", is_const=False, const_name="",
                 permission_mode="ask", active_task=None, message_count=5):
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
        self.created = []

    async def create(self):
        sid = f"s{len(self.created) + 1}"
        s = _FakeSession(session_id=sid)
        self._sessions[sid] = s
        self.created.append(sid)
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
    """模拟 SidecarManager：持有 client，start() 设 started=True。"""

    def __init__(self, client=None):
        self.client = client
        self.started = False

    async def start(self):
        self.started = True


def _make_session_map_mock(sidecar_id=None, recent_turns=None):
    """构造一个 mock SessionMap 实例（context manager）。"""
    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get_sidecar_id.return_value = sidecar_id
    inst.get_recent_turns.return_value = recent_turns or []
    inst.remove.return_value = True
    inst.set_mapping.return_value = None
    return inst


def _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=None):
    """patch api.pi_bridge.session_adapter.SessionMap 返回 mock 实例。"""
    inst = _make_session_map_mock(sidecar_id=sidecar_id, recent_turns=recent_turns)
    monkeypatch.setattr(
        "api.pi_bridge.session_adapter.SessionMap",
        lambda *a, **k: inst,
    )
    return inst


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app_client(monkeypatch):
    """创建带 mock session_manager + sidecar_manager=None 的 app。"""
    monkeypatch.setattr(sessions_mod, "_permission_modes_enabled", lambda: False)
    app = FastAPI()
    app.state.session_manager = _FakeSessionManager()
    app.state.system_prompt = "system prompt"
    app.state.sidecar_manager = None
    app.state.llm = None
    app.include_router(router)
    return {"app": app, "client": TestClient(app)}


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
# permission-mode 422
# ---------------------------------------------------------------------------


class TestSetPermissionMode422:
    def test_value_error_returns_422(self, app_client, monkeypatch):
        monkeypatch.setattr(sessions_mod, "_permission_modes_enabled", lambda: True)
        # 先创建一个 session
        app_client["client"].post("/sessions")
        # patch session.set_permission_mode 抛 ValueError
        session = app_client["app"].state.session_manager._sessions["s1"]

        def raise_value_error(mode):
            raise ValueError("bad mode")

        monkeypatch.setattr(session, "set_permission_mode", raise_value_error)

        resp = app_client["client"].put(
            "/sessions/s1/permission-mode",
            json={"permission_mode": "operate"},
        )
        assert resp.status_code == 422
        assert "Unsupported" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# get_messages
# ---------------------------------------------------------------------------


class TestGetMessages:
    def test_const_session_reads_yaml(self, app_client, monkeypatch):
        # 准备一个 const session
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session

        const_data = {
            "messages": [
                {"type": "human", "content": "hello"},
                {"type": "ai", "content": "world"},
            ]
        }
        monkeypatch.setattr(
            "api.const_session_store.load_const_session_by_id",
            lambda sid: const_data,
        )
        resp = app_client["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == "s1"
        assert body["messages"] == [
            {"role": "human", "content": "hello"},
            {"role": "ai", "content": "world"},
        ]

    def test_const_session_no_data_falls_back_empty(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session
        monkeypatch.setattr(
            "api.const_session_store.load_const_session_by_id", lambda sid: None
        )
        # sidecar=None，走 SessionMap fallback
        _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=[])

        resp = app_client["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        body = resp.json()
        assert body["messages"] == []
        assert body["total"] == 0

    def test_const_session_with_non_list_messages_falls_back(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session
        # messages 不是 list，应走 fallback
        monkeypatch.setattr(
            "api.const_session_store.load_const_session_by_id",
            lambda sid: {"messages": "not-a-list"},
        )
        _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=[])

        resp = app_client["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_const_session_with_non_dict_message_filtered(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session
        const_data = {
            "messages": [
                {"type": "human", "content": "ok"},
                "not-a-dict",
                {"type": "ai", "content": "yo"},
            ]
        }
        monkeypatch.setattr(
            "api.const_session_store.load_const_session_by_id",
            lambda sid: const_data,
        )
        resp = app_client["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        msgs = resp.json()["messages"]
        assert len(msgs) == 2  # 非 dict 被过滤
        assert msgs[0] == {"role": "human", "content": "ok"}

    def test_sidecar_path_returns_normalized(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "yo"},
            ],
            "total": 2,
        })

        resp = app_with_sidecar["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        body = resp.json()
        # role 映射：user → human, assistant → ai
        assert body["messages"] == [
            {"role": "human", "content": "hi", },
            {"role": "ai", "content": "yo"},
        ]
        assert body["total"] == 2

    def test_sidecar_no_sidecar_id_falls_back(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        # SessionMap 返回 None，session._sidecar_session_id 也是 None
        _patch_session_map(monkeypatch, sidecar_id=None, recent_turns=[])

        resp = app_with_sidecar["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_sidecar_uses_session_sidecar_id_when_map_misses(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        session._sidecar_session_id = "from-session"
        sm._sessions["s1"] = session

        # SessionMap 没找到，但 session 上有 _sidecar_session_id
        _patch_session_map(monkeypatch, sidecar_id=None)
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={"messages": [], "total": 0})

        resp = app_with_sidecar["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        # 验证 client.call 用的是 from-session（位置参数）
        called_args = client.call.call_args
        params = called_args.args[1] if called_args.args else called_args.kwargs.get("params")
        assert params["session_id"] == "from-session"

    def test_sidecar_exception_falls_back_to_session_map(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(
            monkeypatch,
            sidecar_id="sc-1",
            recent_turns=[{"user": "u1", "assistant": "a1"}],
        )
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(side_effect=RuntimeError("sidecar boom"))

        resp = app_with_sidecar["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        body = resp.json()
        # fallback 从 recent_turns 构造
        assert body["messages"] == [
            {"role": "human", "content": "u1"},
            {"role": "ai", "content": "a1"},
        ]
        assert body["total"] == 2

    def test_fallback_from_session_map_turns(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        # sidecar_manager=None
        _patch_session_map(
            monkeypatch,
            recent_turns=[
                {"user": "q1", "assistant": "r1"},
                {"user": "q2", "assistant": "r2"},
            ],
        )
        resp = app_client["client"].get("/sessions/s1/messages")
        assert resp.status_code == 200
        body = resp.json()
        assert body["messages"] == [
            {"role": "human", "content": "q1"},
            {"role": "ai", "content": "r1"},
            {"role": "human", "content": "q2"},
            {"role": "ai", "content": "r2"},
        ]
        assert body["total"] == 4

    def test_get_messages_404(self, app_client):
        resp = app_client["client"].get("/sessions/ghost/messages")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# undo
# ---------------------------------------------------------------------------


class TestUndoWithSidecar:
    def test_undo_with_sidecar_success(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", message_count=10, is_const=False)
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]

        async def fake_call(method, params=None, **kwargs):
            if method == "undo":
                return {"removed": 3}
            return {}

        client.call = fake_call
        # patch save_const_session（即使 is_const=False 也不会调用，但防 side-effect）
        monkeypatch.setattr(
            "api.const_session_store.save_const_session", lambda *a, **k: "x"
        )

        resp = app_with_sidecar["client"].post("/sessions/s1/undo?n=3")
        assert resp.status_code == 200
        assert resp.json() == {"deleted_count": 3}
        assert session.message_count == 7  # 10 - 3
        # sidecar_mgr 注入到 session
        assert session._sidecar_mgr is app_with_sidecar["sidecar"]

    def test_undo_with_sidecar_const_syncs_yaml(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", message_count=5, is_const=True, const_name="c1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        saved = {"called": False}

        def fake_save(sid, name, meta, msgs):
            saved["called"] = True
            saved["msgs"] = msgs

        monkeypatch.setattr("api.const_session_store.save_const_session", fake_save)

        client = app_with_sidecar["rpc_client"]

        async def fake_call(method, params=None, **kwargs):
            if method == "undo":
                return {"removed": 1}
            if method == "get_messages":
                return {
                    "messages": [
                        {"role": "user", "content": "q"},
                        {"role": "assistant", "content": "a"},
                    ]
                }
            return {}

        client.call = fake_call

        resp = app_with_sidecar["client"].post("/sessions/s1/undo")
        assert resp.status_code == 200
        assert resp.json() == {"deleted_count": 1}
        assert saved["called"] is True
        assert saved["msgs"] == [
            {"type": "human", "content": "q"},
            {"type": "ai", "content": "a"},
        ]

    def test_undo_const_syncs_yaml_with_updated_message_count(self, app_with_sidecar, monkeypatch):
        """const 会话 undo 后，YAML 持久化的 metadata.message_count 应反映
        扣减后的新值，而非旧值（避免内存与磁盘状态不一致）。
        """
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", message_count=5, is_const=True, const_name="c1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")

        saved = {"meta": None}

        def fake_save(sid, name, meta, msgs):
            saved["meta"] = meta

        monkeypatch.setattr("api.const_session_store.save_const_session", fake_save)

        client = app_with_sidecar["rpc_client"]

        async def fake_call(method, params=None, **kwargs):
            if method == "undo":
                return {"removed": 2}
            if method == "get_messages":
                return {"messages": []}
            return {}

        client.call = fake_call

        resp = app_with_sidecar["client"].post("/sessions/s1/undo?n=2")
        assert resp.status_code == 200
        # 内存中的 message_count 已扣减
        assert session.message_count == 3
        # YAML 持久化的 metadata 也应是扣减后的值
        assert saved["meta"] is not None
        assert saved["meta"]["message_count"] == 3

    def test_undo_sidecar_exception_returns_503(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", message_count=5)
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(side_effect=RuntimeError("undo failed"))

        resp = app_with_sidecar["client"].post("/sessions/s1/undo")
        assert resp.status_code == 503
        assert "sidecar" in resp.json()["detail"].lower()

    def test_undo_no_sidecar_id_returns_503(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", message_count=5)
        sm._sessions["s1"] = session
        # SessionMap 没 sidecar_id，session 也没 _sidecar_session_id
        _patch_session_map(monkeypatch, sidecar_id=None)

        resp = app_with_sidecar["client"].post("/sessions/s1/undo")
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# get_context_usage
# ---------------------------------------------------------------------------


class TestGetContextUsage:
    def test_no_sidecar_uses_empty(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        _patch_session_map(monkeypatch)

        resp = app_client["client"].get("/sessions/s1/context-usage")
        assert resp.status_code == 200
        body = resp.json()
        assert body["estimated_tokens"] == 6  # len("system prompt")=13, 13/2=6
        assert body["max_tokens"] == 256_000
        assert body["message_count"] == 0
        assert body["model_name"] == ""
        assert body["session_id"] == "s1"

    def test_with_sidecar_messages(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        # system_prompt = "system prompt" (13 chars)
        # messages: 2 + 3 = 5 chars → total 18 → 18/2 = 9
        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={
            "messages": [
                {"content": "ab"},
                {"content": "cde"},
            ]
        })

        resp = app_with_sidecar["client"].get("/sessions/s1/context-usage")
        assert resp.status_code == 200
        body = resp.json()
        assert body["estimated_tokens"] == 9  # (5 + 13) / 2 = 9
        assert body["message_count"] == 2

    def test_percentage_capped_at_100(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        # 巨大 content → percentage 应被截到 100
        client.call = AsyncMock(return_value={
            "messages": [{"content": "x" * 1_000_000}]
        })

        resp = app_with_sidecar["client"].get("/sessions/s1/context-usage")
        body = resp.json()
        assert body["percentage"] == 100

    def test_sidecar_exception_falls_back(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(side_effect=RuntimeError("boom"))

        resp = app_with_sidecar["client"].get("/sessions/s1/context-usage")
        assert resp.status_code == 200
        # 失败时 counting_messages 为空，只用 system_prompt
        assert resp.json()["message_count"] == 0

    def test_context_usage_404(self, app_client):
        resp = app_client["client"].get("/sessions/ghost/context-usage")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# delete with sidecar/const
# ---------------------------------------------------------------------------


class TestDeleteSessionSidecar:
    def test_delete_const_cleans_yaml(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session
        deleted = {"called": False}

        def fake_delete(sid):
            deleted["called"] = True
            return True

        monkeypatch.setattr("api.const_session_store.delete_const_session", fake_delete)

        resp = app_client["client"].delete("/sessions/s1")
        assert resp.status_code == 200
        assert deleted["called"] is True

    def test_delete_with_sidecar_destroys_session(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        smap_mock = _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={})

        resp = app_with_sidecar["client"].delete("/sessions/s1")
        assert resp.status_code == 200
        # destroy_session 被调用
        client.call.assert_any_call("destroy_session", {"session_id": "sc-1"})
        # SessionMap.remove 被调用
        smap_mock.remove.assert_called_with("s1")

    def test_delete_uses_session_sidecar_id_when_map_misses(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        session._sidecar_session_id = "from-session"
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id=None)
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={})

        resp = app_with_sidecar["client"].delete("/sessions/s1")
        assert resp.status_code == 200
        client.call.assert_any_call("destroy_session", {"session_id": "from-session"})

    def test_delete_sidecar_exception_swallowed(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(side_effect=RuntimeError("destroy failed"))

        resp = app_with_sidecar["client"].delete("/sessions/s1")
        # 即使 sidecar 失败，本地删除仍应成功
        assert resp.status_code == 200
        assert resp.json() == {"status": "deleted"}


# ---------------------------------------------------------------------------
# constify_session
# ---------------------------------------------------------------------------


class TestConstifySession:
    def test_constify_404(self, app_client):
        resp = app_client["client"].post(
            "/sessions/ghost/const", json={"name": "c1"}
        )
        assert resp.status_code == 404

    def test_constify_409_when_agent_running(self, app_client):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", active_task=_FakeTask(done=False))
        sm._sessions["s1"] = session
        resp = app_client["client"].post(
            "/sessions/s1/const", json={"name": "c1"}
        )
        assert resp.status_code == 409
        assert "运行" in resp.json()["detail"]

    def test_constify_success_serializes_messages(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", active_task=_FakeTask(done=True))
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(return_value={
            "messages": [
                {"role": "user", "content": "q"},
                {"role": "assistant", "content": "a"},
            ]
        })

        saved = {"called": False}

        def fake_save(sid, name, meta, msgs):
            saved["called"] = True
            saved["name"] = name
            saved["msgs"] = msgs

        monkeypatch.setattr("api.const_session_store.save_const_session", fake_save)

        resp = app_with_sidecar["client"].post(
            "/sessions/s1/const", json={"name": "my-const"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_const"] is True
        assert body["const_name"] == "my-const"
        assert session.is_const is True
        assert session.const_name == "my-const"
        assert saved["called"] is True
        assert saved["name"] == "my-const"
        assert saved["msgs"] == [
            {"type": "human", "content": "q"},
            {"type": "ai", "content": "a"},
        ]

    def test_constify_sidecar_exception_still_saves_empty(self, app_with_sidecar, monkeypatch):
        app = app_with_sidecar["app"]
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1", active_task=_FakeTask(done=True))
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        client = app_with_sidecar["rpc_client"]
        client.call = AsyncMock(side_effect=RuntimeError("get_messages failed"))

        saved = {"msgs": None}

        def fake_save(sid, name, meta, msgs):
            saved["msgs"] = msgs

        monkeypatch.setattr("api.const_session_store.save_const_session", fake_save)

        resp = app_with_sidecar["client"].post(
            "/sessions/s1/const", json={"name": "c1"}
        )
        assert resp.status_code == 200
        # 失败时 serialized=[]
        assert saved["msgs"] == []

    def test_constify_no_sidecar_saves_empty(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", active_task=_FakeTask(done=True))
        sm._sessions["s1"] = session

        saved = {"msgs": None}

        def fake_save(sid, name, meta, msgs):
            saved["msgs"] = msgs

        monkeypatch.setattr("api.const_session_store.save_const_session", fake_save)

        resp = app_client["client"].post(
            "/sessions/s1/const", json={"name": "c1"}
        )
        assert resp.status_code == 200
        assert saved["msgs"] == []


# ---------------------------------------------------------------------------
# generate_session_title
# ---------------------------------------------------------------------------


class TestGenerateTitle:
    def test_generate_title_404(self, app_client):
        resp = app_client["client"].post("/sessions/ghost/generate-title")
        assert resp.status_code == 404

    def test_generate_title_400_when_no_messages(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session
        # sidecar=None，SessionMap 返回空 turns
        _patch_session_map(monkeypatch, recent_turns=[])

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 400
        assert "消息" in resp.json()["detail"]

    def test_generate_title_success(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(return_value={
            "messages": [
                {"role": "user", "content": "讲讲 Python"},
                {"role": "assistant", "content": "Python 是一门编程语言"},
            ]
        })

        # mock LLM
        class FakeResp:
            content = '  "Python 入门指南"  '

        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(return_value=FakeResp())

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 200
        title = resp.json()["title"]
        # 应去除首尾空格和引号
        assert title == "Python 入门指南"

    def test_generate_title_truncates_to_50(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(return_value={
            "messages": [{"role": "user", "content": "x"}]
        })

        long_title = "很长的标题" * 20  # 100 chars
        class FakeResp:
            content = long_title

        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(return_value=FakeResp())

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 200
        assert len(resp.json()["title"]) <= 50

    def test_generate_title_empty_response_uses_default(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(return_value={
            "messages": [{"role": "user", "content": "x"}]
        })

        class FakeResp:
            content = "   "  # 只有空格

        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(return_value=FakeResp())

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 200
        assert resp.json()["title"] == "未命名会话"

    def test_generate_title_500_when_llm_raises(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(return_value={
            "messages": [{"role": "user", "content": "x"}]
        })

        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(side_effect=RuntimeError("llm down"))

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 500
        assert "标题生成失败" in resp.json()["detail"]

    def test_generate_title_no_content_attr_uses_str(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(return_value={
            "messages": [{"role": "user", "content": "x"}]
        })

        # response 没有 content 属性，应走 str(response)
        app.state.llm = MagicMock()
        app.state.llm.ainvoke = AsyncMock(return_value="plain-string-response")

        resp = app_client["client"].post("/sessions/s1/generate-title")
        assert resp.status_code == 200
        assert resp.json()["title"] == "plain-string-response"

    def test_generate_title_sidecar_exception_400(self, app_client, monkeypatch):
        app = app_client["app"]
        app.state.sidecar_manager = _FakeSidecarManager(client=AsyncMock())
        sm = app.state.session_manager
        session = _FakeSession(session_id="s1")
        sm._sessions["s1"] = session

        _patch_session_map(monkeypatch, sidecar_id="sc-1")
        app.state.sidecar_manager.client.call = AsyncMock(
            side_effect=RuntimeError("sidecar down")
        )

        resp = app_client["client"].post("/sessions/s1/generate-title")
        # sidecar 失败 → messages 为空 → 400
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# unconstify_session
# ---------------------------------------------------------------------------


class TestUnconstifySessionIdempotent:
    def test_unconstify_when_session_missing_still_ok(self, app_client, monkeypatch):
        # session 不存在，仍应返回 ok（因为先 delete_const_session 再 get session）
        monkeypatch.setattr(
            "api.const_session_store.delete_const_session", lambda sid: False
        )
        resp = app_client["client"].delete("/sessions/ghost/const")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_unconstify_clears_session_flags(self, app_client, monkeypatch):
        sm = app_client["app"].state.session_manager
        session = _FakeSession(session_id="s1", is_const=True, const_name="c1")
        sm._sessions["s1"] = session
        monkeypatch.setattr(
            "api.const_session_store.delete_const_session", lambda sid: True
        )
        resp = app_client["client"].delete("/sessions/s1/const")
        assert resp.status_code == 200
        assert session.is_const is False
        assert session.const_name == ""
