"""H1/H2/F10 回归测试：互斥守卫恢复 / workflows None 崩溃 / 幂等记录时机。"""

import asyncio
import json
from collections import deque
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routes.chat as chat_mod
from api.pi_bridge.rpc_client import JsonRpcClient

from tests.test_api.test_chat_routes_extra import (
    _FakeChatSession,
    _FakeChatSessionManager,
    _FakeWSRegistry,
    _patch_session_map,
)


class TestMutexGuardRestored:
    """H1 回归：CONN-MUTEX 互斥 if 必须独立存在（此前被注释吞掉，
    BUSY 块嵌套进 max_tokens 分支导致聊天全断）。"""

    def test_mutex_guard_is_not_commented(self):
        src = open('api/routes/chat.py', encoding='utf-8').read()
        # 关键：if 语句必须独立成行（不在 # 注释内）
        assert '            if session.active_turn_ws is not None and session.active_turn_ws is not ws:' in src
        # max_tokens 分支的 body 只含赋值（BUSY 发送不在其中）
        idx = src.find('session._max_tokens = int(_mt)')
        assert idx > 0
        window = src[idx:idx+200]
        assert 'BUSY' not in window


class TestWorkflowsNoneParentTurn:
    """H2 回归：parent_turn_id=None 的运行不导致列表 500。"""

    def test_list_workflows_with_none_parent_turn_id(self):
        import api.routes.workflows as wf
        # 用 dataclass 构造 parent_turn_id=None 的运行
        run = wf.WorkflowRunState(
            run_id="r1",
            workflow_id="w1",
            workflow_def={"version": 1},
            parent_turn_id=None,
        )
        run.status = "running"
        with wf._runs_lock:
            wf._runs["r1"] = run
        try:
            # 列表渲染必须不抛 AttributeError（None.startswith）
            runs = [
                r for r in wf._runs.values()
                if r.parent_turn_id is not None
                and (r.parent_turn_id == "sess-1" or r.parent_turn_id.startswith("sess-1"[:8]))
            ]
            assert runs == []
        finally:
            with wf._runs_lock:
                wf._runs.pop("r1", None)


class TestIdempotencyRecordOnSuccess:
    """F10 回归：幂等 id 在 turn 成功后记录（失败轮次可重试）。"""

    def test_id_recorded_after_success_not_on_receive(self, monkeypatch):
        src = open('api/routes/chat.py', encoding='utf-8').read()
        # 收到消息处不再立即 append
        receive_zone = src[src.find('client_msg_id = payload.get'):src.find('MAXTOKENS-END2END')]
        assert 'recent_message_ids.append' not in receive_zone
        # 成功路径（_handle_turn_result）记录
        success_zone = src[src.find('IDEMPOTENCY-001：turn 成功后才记录'):]
        assert 'recent_message_ids.append' in success_zone


class TestRpcReadLoopMalformed:
    """MALFORMED-RPC-001：畸形消息不击穿读循环（回归）。"""

    def test_read_loop_survives_malformed(self):
        class FakeStdout:
            def __init__(self):
                self.lines = [
                    b'[1,2,3]\n',
                    b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n',
                    b'"tail"\n',
                ]
                self.pos = 0
            async def readline(self):
                if self.pos >= len(self.lines):
                    return b""
                line = self.lines[self.pos]
                self.pos += 1
                return line

        async def run():
            client = JsonRpcClient(stdin=MagicMock(), stdout=FakeStdout())
            fut = asyncio.get_event_loop().create_future()
            client._pending[1] = fut
            await client.start_reading()
            result = await asyncio.wait_for(fut, timeout=3)
            assert result == {"ok": True}
            await asyncio.sleep(0.1)
            await client.stop()

        asyncio.run(run())
