"""Tests for api/time_traveler.py — 对话轮次撤回工具（oh-my-pi sidecar 版本）。

覆盖 undo_rounds / undo_last_round / undo_all：
- 参数校验（n<1 / 无 mgr / 无 session_id）
- client 为 None 的降级
- 成功路径返回 removed 计数并传递正确参数
- 异常路径返回 0 并 warn

发现：模块被打包进 build/maxma-server.spec 的 hiddenimports，但无当前 Python
导入者。/sessions/{id}/undo 路由（api/routes/sessions.py:257）内联实现了 undo
而非调用本模块。建议：要么重构路由复用本模块，要么从 hiddenimports 移除。
"""

from __future__ import annotations

import logging

import pytest

from api.time_traveler import undo_all, undo_last_round, undo_rounds


class _FakeClient:
    """模拟 sidecar RPC client。

    成功时返回 calls 列表中的下一个响应（或默认 {"removed": 1}）。
    raise_on_call 为 True 时抛出异常。
    """

    def __init__(self, *, responses=None, raise_exc: Exception | None = None):
        self.calls: list[tuple[str, dict]] = []
        self._responses = responses or []
        self._raise_exc = raise_exc

    async def call(self, method: str, args: dict):
        self.calls.append((method, dict(args)))
        if self._raise_exc is not None:
            raise self._raise_exc
        if self._responses:
            return self._responses.pop(0)
        return {"removed": 1}


class _FakeSidecarMgr:
    """最小 SidecarManager 替身，只暴露 .client。"""

    def __init__(self, client):
        self.client = client


@pytest.fixture
def caplog_at_debug(caplog):
    """捕获 DEBUG 及以上日志。"""
    caplog.set_level(logging.DEBUG, logger="api.time_traveler")
    return caplog


class TestUndoRoundsValidation:
    """参数校验：非法输入应返回 0 且不触碰 client。"""

    async def test_n_less_than_1_returns_0(self):
        client = _FakeClient()
        mgr = _FakeSidecarMgr(client)
        result = await undo_rounds(mgr, "sess-1", n=0)
        assert result == 0
        assert client.calls == []  # 未调用 client

    async def test_negative_n_returns_0(self):
        result = await undo_rounds(_FakeSidecarMgr(_FakeClient()), "sess-1", n=-3)
        assert result == 0

    async def test_no_sidecar_mgr_returns_0(self):
        result = await undo_rounds(None, "sess-1", n=1)
        assert result == 0

    async def test_empty_session_id_returns_0(self):
        client = _FakeClient()
        result = await undo_rounds(_FakeSidecarMgr(client), "", n=1)
        assert result == 0
        assert client.calls == []

    async def test_none_session_id_returns_0(self):
        result = await undo_rounds(_FakeSidecarMgr(_FakeClient()), None, n=1)
        assert result == 0


class TestUndoRoundsClientNone:
    """sidecar client 不可用时的降级。"""

    async def test_client_none_returns_0(self, caplog_at_debug):
        mgr = _FakeSidecarMgr(None)
        result = await undo_rounds(mgr, "sess-1", n=1)
        assert result == 0
        # 应记录 warning
        warnings = [r for r in caplog_at_debug.records if r.levelno == logging.WARNING]
        assert any("client not available" in r.getMessage() for r in warnings)


class TestUndoRoundsSuccess:
    """成功路径。"""

    async def test_returns_removed_count(self):
        client = _FakeClient(responses=[{"removed": 5}])
        result = await undo_rounds(_FakeSidecarMgr(client), "sess-1", n=2)
        assert result == 5

    async def test_default_n_is_1(self):
        client = _FakeClient(responses=[{"removed": 1}])
        await undo_rounds(_FakeSidecarMgr(client), "sess-1")
        method, args = client.calls[0]
        assert method == "undo"
        assert args["steps"] == 1

    async def test_passes_session_id_and_steps_to_client(self):
        client = _FakeClient(responses=[{"removed": 3}])
        await undo_rounds(_FakeSidecarMgr(client), "my-session", n=4)
        method, args = client.calls[0]
        assert method == "undo"
        assert args == {"session_id": "my-session", "steps": 4}

    async def test_missing_removed_key_defaults_to_0(self):
        # result.get("removed", 0) — 返回字典无 removed 时应为 0
        client = _FakeClient(responses=[{"other": "data"}])
        result = await undo_rounds(_FakeSidecarMgr(client), "sess-1", n=1)
        assert result == 0

    async def test_logs_info_on_success(self, caplog_at_debug):
        client = _FakeClient(responses=[{"removed": 2}])
        await undo_rounds(_FakeSidecarMgr(client), "sess-1", n=1)
        infos = [r for r in caplog_at_debug.records if r.levelno == logging.INFO]
        assert any("undo" in r.getMessage() and "removed 2" in r.getMessage() for r in infos)


class TestUndoRoundsException:
    """client.call 抛异常时应返回 0 并 warn。"""

    async def test_exception_returns_0(self, caplog_at_debug):
        client = _FakeClient(raise_exc=RuntimeError("rpc timeout"))
        result = await undo_rounds(_FakeSidecarMgr(client), "sess-1", n=1)
        assert result == 0
        warnings = [r for r in caplog_at_debug.records if r.levelno == logging.WARNING]
        assert any("undo failed" in r.getMessage() for r in warnings)

    async def test_generic_exception_returns_0(self):
        client = _FakeClient(raise_exc=ValueError("bad"))
        result = await undo_rounds(_FakeSidecarMgr(client), "sess-1", n=1)
        assert result == 0


class TestUndoLastRound:
    """undo_last_round 应委托 undo_rounds(n=1)。"""

    async def test_calls_with_n_1(self):
        client = _FakeClient(responses=[{"removed": 1}])
        result = await undo_last_round(_FakeSidecarMgr(client), "sess-1")
        assert result == 1
        assert client.calls[0][1]["steps"] == 1

    async def test_returns_0_for_invalid_input(self):
        # 委托路径同样校验参数
        assert await undo_last_round(None, "sess-1") == 0
        assert await undo_last_round(_FakeSidecarMgr(_FakeClient()), "") == 0


class TestUndoAll:
    """undo_all 应委托 undo_rounds(n=100)。"""

    async def test_calls_with_n_100(self):
        client = _FakeClient(responses=[{"removed": 99}])
        result = await undo_all(_FakeSidecarMgr(client), "sess-1")
        assert result == 99
        assert client.calls[0][1]["steps"] == 100

    async def test_returns_0_for_invalid_input(self):
        assert await undo_all(None, "sess-1") == 0
        assert await undo_all(_FakeSidecarMgr(_FakeClient()), "") == 0
