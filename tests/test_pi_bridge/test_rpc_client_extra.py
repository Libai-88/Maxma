"""补充测试 — api/pi_bridge/rpc_client.py JsonRpcClient 完整路径覆盖。

使用真实 asyncio.StreamReader（通过 feed_data 喂数据）+ mock StreamWriter，
覆盖 call / on / stop / _read_loop / _dispatch 的所有分支。
"""

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.pi_bridge.rpc_client import JsonRpcClient, JsonRpcError


def _make_client():
    """构造一个 JsonRpcClient：stdout 用真实 StreamReader，stdin 用 mock。"""
    stdout = asyncio.StreamReader()
    stdin = MagicMock()
    stdin.write = MagicMock()
    stdin.drain = AsyncMock()
    client = JsonRpcClient(stdin, stdout)
    return client, stdin, stdout


# ---------------------------------------------------------------------------
# JsonRpcError
# ---------------------------------------------------------------------------


class TestJsonRpcError:
    def test_init_stores_message_and_data(self):
        err = JsonRpcError("boom", data={"k": 1})
        assert str(err) == "boom"
        assert err.data == {"k": 1}

    def test_init_default_data_is_none(self):
        err = JsonRpcError("boom")
        assert err.data is None

    def test_is_exception_subclass(self):
        assert issubclass(JsonRpcError, Exception)


# ---------------------------------------------------------------------------
# start_reading / is_running
# ---------------------------------------------------------------------------


class TestStartReading:
    async def test_start_reading_creates_read_task(self):
        client, _, _ = _make_client()
        assert client.is_running is False
        await client.start_reading()
        assert client.is_running is True
        assert client._read_task is not None
        await client.stop()

    async def test_start_reading_idempotent(self):
        client, _, _ = _make_client()
        await client.start_reading()
        first_task = client._read_task
        await client.start_reading()  # 第二次应 no-op
        assert client._read_task is first_task
        await client.stop()


# ---------------------------------------------------------------------------
# call()
# ---------------------------------------------------------------------------


class TestCall:
    async def test_call_not_running_raises_runtime_error(self):
        client, _, _ = _make_client()
        with pytest.raises(RuntimeError, match="not running"):
            await client.call("foo")

    async def test_call_happy_path_returns_result(self):
        client, stdin, stdout = _make_client()
        await client.start_reading()

        async def feed():
            # 等待 call 写出请求后，再喂响应
            await asyncio.sleep(0.01)
            stdout.feed_data(
                b'{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n'
            )

        task = asyncio.create_task(feed())
        result = await client.call("foo")
        await task
        assert result == {"ok": True}
        await client.stop()

    async def test_call_with_params_sends_params(self):
        client, stdin, stdout = _make_client()
        await client.start_reading()

        async def feed():
            await asyncio.sleep(0.01)
            stdout.feed_data(b'{"jsonrpc":"2.0","id":1,"result":{}}\n')

        task = asyncio.create_task(feed())
        await client.call("add", params={"a": 1, "b": 2})
        await task

        # 验证写入的请求包含 params
        written = stdin.write.call_args[0][0]
        req = json.loads(written.decode("utf-8"))
        assert req["method"] == "add"
        assert req["params"] == {"a": 1, "b": 2}
        assert req["id"] == 1
        assert req["jsonrpc"] == "2.0"
        await client.stop()

    async def test_call_writes_json_line_with_newline(self):
        client, stdin, stdout = _make_client()
        await client.start_reading()

        async def feed():
            await asyncio.sleep(0.01)
            stdout.feed_data(b'{"jsonrpc":"2.0","id":1,"result":{}}\n')

        task = asyncio.create_task(feed())
        await client.call("foo")
        await task

        written = stdin.write.call_args[0][0]
        assert written.endswith(b"\n")
        assert stdin.drain.await_count >= 1
        await client.stop()

    async def test_call_error_response_raises_json_rpc_error(self):
        client, stdin, stdout = _make_client()
        await client.start_reading()

        async def feed():
            await asyncio.sleep(0.01)
            stdout.feed_data(
                b'{"jsonrpc":"2.0","id":1,"error":{"message":"boom","data":{"k":1}}}\n'
            )

        task = asyncio.create_task(feed())
        with pytest.raises(JsonRpcError) as exc_info:
            await client.call("foo")
        await task
        assert "boom" in str(exc_info.value)
        assert exc_info.value.data == {"k": 1}
        await client.stop()

    async def test_call_timeout_raises_timeout_error_and_cleans_pending(self):
        client, _, _ = _make_client()
        await client.start_reading()
        with pytest.raises(TimeoutError, match="timed out"):
            await client.call("slow", timeout=0.05)
        # pending 应已清理
        assert 1 not in client._pending
        await client.stop()

    async def test_call_increments_msg_id(self):
        client, stdin, stdout = _make_client()
        await client.start_reading()

        async def feed(n):
            await asyncio.sleep(0.01)
            stdout.feed_data(
                json.dumps({"jsonrpc": "2.0", "id": n, "result": {}}).encode() + b"\n"
            )

        t1 = asyncio.create_task(feed(1))
        await client.call("a")
        await t1
        t2 = asyncio.create_task(feed(2))
        await client.call("b")
        await t2
        # _msg_id 应已自增到 2
        assert client._msg_id == 2
        await client.stop()

    async def test_call_drain_exception_cleans_pending(self):
        client, stdin, _ = _make_client()
        await client.start_reading()
        stdin.drain = AsyncMock(side_effect=RuntimeError("pipe broken"))
        with pytest.raises(RuntimeError, match="pipe broken"):
            await client.call("foo")
        assert 1 not in client._pending
        await client.stop()


# ---------------------------------------------------------------------------
# on() / unsubscribe
# ---------------------------------------------------------------------------


class TestOn:
    async def test_on_registers_sync_handler_called(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        received: list = []

        def handler(sid, event):
            received.append((sid, event))

        client.on("token", handler)
        stdout.feed_data(
            b'{"method":"event","params":{"session_id":"s1","event":{"type":"token","payload":{"token":"x"}}}}\n'
        )
        # 给 read loop 一点时间处理
        await asyncio.sleep(0.05)
        assert len(received) == 1
        assert received[0] == ("s1", {"type": "token", "payload": {"token": "x"}})
        await client.stop()

    async def test_on_registers_async_handler_awaited(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        received: list = []

        async def handler(sid, event):
            received.append((sid, event))

        client.on("answer", handler)
        stdout.feed_data(
            b'{"method":"event","params":{"session_id":"s2","event":{"type":"answer","payload":{"content":"hi"}}}}\n'
        )
        await asyncio.sleep(0.05)
        assert received == [("s2", {"type": "answer", "payload": {"content": "hi"}})]
        await client.stop()

    async def test_unsubscribe_removes_handler(self):
        client, _, _ = _make_client()
        received: list = []

        def handler(sid, event):
            received.append(event)

        unsub = client.on("token", handler)
        unsub()
        # 再次触发事件，handler 不应被调用
        assert "token" not in client._handlers or handler not in client._handlers["token"]

    async def test_on_multiple_handlers_same_event(self):
        client, _, _ = _make_client()
        calls = []

        def h1(sid, event):
            calls.append("h1")

        def h2(sid, event):
            calls.append("h2")

        client.on("token", h1)
        client.on("token", h2)
        assert len(client._handlers["token"]) == 2


# ---------------------------------------------------------------------------
# stop()
# ---------------------------------------------------------------------------


class TestStop:
    async def test_stop_sets_running_false(self):
        client, _, _ = _make_client()
        await client.start_reading()
        assert client.is_running is True
        await client.stop()
        assert client.is_running is False
        assert client._read_task is None

    async def test_stop_cancels_pending_futures_with_runtime_error(self):
        client, _, _ = _make_client()
        await client.start_reading()

        # 启动一个不会收到响应的 call
        call_task = asyncio.create_task(client.call("foo", timeout=10))
        await asyncio.sleep(0.02)  # 等 call 把 future 放进 pending
        assert len(client._pending) == 1

        await client.stop()
        # call 应收到 RuntimeError（read_loop finally 设 "Sidecar disconnected"，
        # 或 stop() 的兜底设 "Client stopped"——取决于 read_task 取消时序）
        with pytest.raises(RuntimeError):
            await call_task
        assert len(client._pending) == 0

    async def test_stop_sets_client_stopped_when_read_loop_already_done(self):
        """read_task 已完成时，stop() 走兜底分支设 "Client stopped"。"""
        client, _, _ = _make_client()
        await client.start_reading()
        # 等 read_loop 因 stdout 一直阻塞而挂起，然后直接置 _read_task 为已完成的空任务
        # 模拟 read_task 已 done 但 pending 仍有 future 的边界场景
        client._read_task = asyncio.get_event_loop().create_future()
        client._read_task.set_result(None)  # 标记为已完成
        # 手动塞一个 pending future
        fut = asyncio.get_event_loop().create_future()
        client._pending[42] = fut
        await client.stop()
        assert fut.done()
        assert isinstance(fut.exception(), RuntimeError)
        assert "Client stopped" in str(fut.exception())

    async def test_stop_when_not_running_is_noop(self):
        client, _, _ = _make_client()
        # 未 start_reading，直接 stop 不应抛异常
        await client.stop()
        assert client.is_running is False

    async def test_stop_cancels_read_task_and_logs_debug(self, caplog):
        client, _, _ = _make_client()
        await client.start_reading()
        with caplog.at_level(logging.DEBUG):
            await client.stop()
        assert any("cancel" in r.message.lower() for r in caplog.records)


# ---------------------------------------------------------------------------
# _read_loop / _dispatch (via real stream)
# ---------------------------------------------------------------------------


class TestReadLoop:
    async def test_read_loop_invalid_json_logs_warning(self, caplog):
        client, _, stdout = _make_client()
        await client.start_reading()
        with caplog.at_level(logging.WARNING):
            stdout.feed_data(b"this is not json\n")
            await asyncio.sleep(0.05)
        assert any("invalid JSON" in r.message for r in caplog.records)
        # read loop 仍存活
        assert client.is_running is True
        await client.stop()

    async def test_read_loop_skips_empty_lines(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        # 喂一个空行 + 一个有效事件
        received: list = []

        def handler(sid, event):
            received.append(event)

        client.on("token", handler)
        stdout.feed_data(b"\n\n")
        stdout.feed_data(
            b'{"method":"event","params":{"session_id":"s1","event":{"type":"token","payload":{}}}}\n'
        )
        await asyncio.sleep(0.05)
        assert len(received) == 1
        await client.stop()

    async def test_read_loop_eof_clears_running(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        stdout.feed_eof()
        await asyncio.sleep(0.05)
        assert client.is_running is False
        # read task 应已完成
        assert client._read_task is None or client._read_task.done()

    async def test_read_loop_eof_cancels_pending_futures(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        call_task = asyncio.create_task(client.call("foo", timeout=10))
        await asyncio.sleep(0.02)
        # 模拟 sidecar 进程退出（EOF）
        stdout.feed_eof()
        with pytest.raises(RuntimeError, match="Sidecar disconnected"):
            await call_task

    async def test_dispatch_event_handler_exception_logged(self, caplog):
        client, _, stdout = _make_client()
        await client.start_reading()

        def bad_handler(sid, event):
            raise ValueError("handler boom")

        client.on("token", bad_handler)
        with caplog.at_level(logging.ERROR):
            stdout.feed_data(
                b'{"method":"event","params":{"session_id":"s1","event":{"type":"token","payload":{}}}}\n'
            )
            await asyncio.sleep(0.05)
        assert any("event handler error" in r.message for r in caplog.records)
        # read loop 仍存活
        assert client.is_running is True
        await client.stop()

    async def test_dispatch_event_with_non_dict_event(self):
        """event 不是 dict 时 event_type 应为空字符串，不应崩溃。"""
        client, _, stdout = _make_client()
        await client.start_reading()
        received: list = []

        def handler(sid, event):
            received.append(event)

        # event_type="" 不会匹配任何已注册 handler；这里注册一个空 type handler
        client.on("", handler)
        stdout.feed_data(
            b'{"method":"event","params":{"session_id":"s1","event":"not-a-dict"}}\n'
        )
        await asyncio.sleep(0.05)
        # event="not-a-dict"，handlers[""] 被调用
        assert len(received) == 1
        assert received[0] == "not-a-dict"
        await client.stop()

    async def test_dispatch_event_without_session_id_defaults_empty(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        received: list = []

        def handler(sid, event):
            received.append(sid)

        client.on("token", handler)
        # params 里没有 session_id
        stdout.feed_data(
            b'{"method":"event","params":{"event":{"type":"token","payload":{}}}}\n'
        )
        await asyncio.sleep(0.05)
        assert received == [""]
        await client.stop()

    async def test_dispatch_rpc_response_unknown_id_ignored(self):
        """id 不在 pending 中时，响应应被静默忽略。"""
        client, _, stdout = _make_client()
        await client.start_reading()
        # 喂一个 id=999 的响应，但没有对应的 pending
        stdout.feed_data(b'{"jsonrpc":"2.0","id":999,"result":{"ok":1}}\n')
        await asyncio.sleep(0.05)
        # 不应崩溃，read loop 仍存活
        assert client.is_running is True
        await client.stop()

    async def test_dispatch_message_without_method_or_id_ignored(self):
        client, _, stdout = _make_client()
        await client.start_reading()
        # 既无 method=event 也无 id，应被静默忽略
        stdout.feed_data(b'{"jsonrpc":"2.0","result":{"ok":1}}\n')
        await asyncio.sleep(0.05)
        assert client.is_running is True
        await client.stop()

    async def test_unsubscribe_missing_handler_logs_debug(self, caplog):
        """已存在的回归测试，确保 unsubscribe 找不到 handler 时记 debug。"""
        client, _, _ = _make_client()

        def handler(sid, event):
            pass

        unsub = client.on("test_event", handler)
        # 手动移除使 _unsubscribe 找不到
        client._handlers["test_event"].remove(handler)
        with caplog.at_level(logging.DEBUG):
            unsub()
        assert any("unsubscribe" in r.message.lower() for r in caplog.records)
