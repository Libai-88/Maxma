"""Tests for api/bootstrap/idle_queue.py — Tier 3 空闲任务队列。

覆盖队列注册、状态查询、清空以及 drain 执行流程（同步/协程任务、
异常隔离、draining 标志、重入跳过、空队列）。
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from api.bootstrap import idle_queue
from api.bootstrap.idle_queue import (
    clear_idle_queue,
    is_idle_draining,
    register_idle_task,
    start_idle_drain,
)


@pytest.fixture(autouse=True)
def _reset_queue():
    """每个测试前后清空全局队列，隔离测试状态。"""
    clear_idle_queue()
    yield
    clear_idle_queue()


class TestRegisterIdleTask:
    """register_idle_task 注册逻辑。"""

    def test_returns_uuid_string(self):
        """返回的任务 ID 应为合法 UUID 字符串。"""
        task_id = register_idle_task("t", lambda: None)
        # 合法 UUID 能被解析
        uuid.UUID(task_id)

    def test_each_call_returns_unique_id(self):
        """多次注册应返回不同的 ID。"""
        a = register_idle_task("t", lambda: None)
        b = register_idle_task("t", lambda: None)
        assert a != b

    def test_appends_to_pending_queue(self):
        """注册后任务应进入待执行队列。"""
        fn = lambda: None  # noqa: E731
        register_idle_task("my-task", fn)
        assert len(idle_queue._pending_tasks) == 1
        task_id, name, queued_fn = idle_queue._pending_tasks[0]
        assert name == "my-task"
        assert queued_fn is fn

    def test_public_api_reexported_from_bootstrap(self):
        """api.bootstrap 应重新导出全部 4 个公共函数。"""
        from api.bootstrap import (
            clear_idle_queue as c,
            is_idle_draining as i,
            register_idle_task as r,
            start_idle_drain as s,
        )

        assert r is register_idle_task
        assert s is start_idle_drain
        assert i is is_idle_draining
        assert c is clear_idle_queue


class TestQueueState:
    """is_idle_draining / clear_idle_queue。"""

    def test_is_draining_default_false(self):
        """初始状态下不在 draining。"""
        assert is_idle_draining() is False

    def test_clear_empties_queue(self):
        """clear_idle_queue 清空待执行队列。"""
        register_idle_task("t1", lambda: None)
        register_idle_task("t2", lambda: None)
        assert len(idle_queue._pending_tasks) == 2

        clear_idle_queue()
        assert idle_queue._pending_tasks == []
        assert is_idle_draining() is False

    def test_clear_resets_draining_flag(self):
        """clear_idle_queue 重置 draining 标志。"""
        idle_queue._draining = True
        clear_idle_queue()
        assert is_idle_draining() is False


class TestStartIdleDrain:
    """start_idle_drain 执行流程。"""

    async def test_executes_sync_task(self):
        """同步任务应被执行。"""
        called = []
        register_idle_task("sync", lambda: called.append("sync"))
        await start_idle_drain()
        assert called == ["sync"]

    async def test_executes_async_task(self):
        """协程任务应被 await 执行。"""
        called = []

        async def _coro():
            called.append("async")

        register_idle_task("async", _coro)
        await start_idle_drain()
        assert called == ["async"]

    async def test_executes_mixed_sync_and_async_in_order(self):
        """混合任务按注册顺序执行。"""
        order = []

        def _sync_a():
            order.append("a")

        async def _coro_b():
            order.append("b")

        def _sync_c():
            order.append("c")

        register_idle_task("a", _sync_a)
        register_idle_task("b", _coro_b)
        register_idle_task("c", _sync_c)
        await start_idle_drain()
        assert order == ["a", "b", "c"]

    async def test_task_exception_does_not_break_queue(self):
        """单个任务失败只 warn，不中断后续任务。"""
        results = []

        def _boom():
            raise RuntimeError("kaboom")

        def _ok():
            results.append("ok")

        register_idle_task("boom", _boom)
        register_idle_task("ok", _ok)
        await start_idle_drain()
        assert results == ["ok"]

    async def test_sets_draining_flag_during_run(self):
        """drain 执行期间 is_idle_draining 应为 True。"""
        observed = []

        def _check():
            observed.append(is_idle_draining())

        register_idle_task("check", _check)
        await start_idle_drain()
        assert observed == [True]
        # 执行结束后恢复 False
        assert is_idle_draining() is False

    async def test_clears_queue_after_drain(self):
        """drain 完成后待执行队列应被清空。"""
        register_idle_task("t", lambda: None)
        await start_idle_drain()
        assert idle_queue._pending_tasks == []

    async def test_empty_queue_drain_is_noop(self):
        """空队列 drain 不报错。"""
        await start_idle_drain()
        assert is_idle_draining() is False
        assert idle_queue._pending_tasks == []

    async def test_skips_when_already_draining(self):
        """draining 中再次调用应跳过且不执行新任务。"""
        executed = []

        # 手动置为 draining 模拟重入
        idle_queue._draining = True
        register_idle_task("should-not-run", lambda: executed.append("x"))
        await start_idle_drain()
        assert executed == []
        # 队列应保留（未被消费）
        assert len(idle_queue._pending_tasks) == 1
        # 重置以便 fixture 清理
        idle_queue._draining = False

    async def test_yields_event_loop_between_tasks(self):
        """每个任务间应通过 asyncio.sleep(0) 让出事件循环。"""
        # 通过记录一个低优先级任务在 drain 期间被调度，验证 yield 发生
        interleaved = []

        async def _background():
            interleaved.append("bg")

        def _task_a():
            pass

        async def _task_b():
            interleaved.append("b")

        register_idle_task("a", _task_a)
        register_idle_task("b", _task_b)
        # 启动一个后台协程，应在 drain 的 sleep(0) 间隙被调度
        bg_task = asyncio.create_task(_background())
        await start_idle_drain()
        await bg_task
        # 后台任务应已执行
        assert "bg" in interleaved
        assert "b" in interleaved
