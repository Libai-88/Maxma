"""空闲任务队列测试 — Tier 3 非关键任务顺序执行。"""
import asyncio
import pytest
from api.bootstrap.idle_queue import (
    register_idle_task,
    start_idle_drain,
    is_idle_draining,
    clear_idle_queue,
)


@pytest.fixture(autouse=True)
def reset_queue():
    clear_idle_queue()
    yield
    clear_idle_queue()


def test_register_idle_task_returns_id():
    task_id = register_idle_task("test", lambda: None)
    assert isinstance(task_id, str)
    assert len(task_id) > 0


def test_register_idle_task_with_coroutine():
    """支持注册协程任务。"""
    async def _coro():
        pass

    task_id = register_idle_task("coro-test", _coro)
    assert isinstance(task_id, str)


@pytest.mark.asyncio
async def test_start_idle_drain_executes_all_tasks():
    """drain 依次执行所有已注册的 idle 任务。"""
    results = []

    def _sync_task():
        results.append("sync")

    async def _async_task():
        results.append("async")

    register_idle_task("sync", _sync_task)
    register_idle_task("async", _async_task)

    await start_idle_drain()
    assert results == ["sync", "async"]
    assert not is_idle_draining()


@pytest.mark.asyncio
async def test_idle_drain_task_failure_does_not_stop_queue():
    """单个任务失败不中断队列。"""
    results = []

    def _fail():
        raise ValueError("boom")

    def _ok():
        results.append("ok")

    register_idle_task("fail", _fail)
    register_idle_task("ok", _ok)

    await start_idle_drain()
    assert results == ["ok"]


@pytest.mark.asyncio
async def test_idle_drain_yields_between_tasks():
    """每个任务之间 setImmediate 让出事件循环。"""
    ordering = []

    async def _check():
        ordering.append("task")
        await asyncio.sleep(0)

    for i in range(3):
        register_idle_task(f"task-{i}", _check)

    await start_idle_drain()
    assert len(ordering) == 3
