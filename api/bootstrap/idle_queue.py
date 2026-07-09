"""空闲任务队列 — Tier 3 非关键任务。

设计参考 Halo 的 idle-queue.ts：
- register_idle_task(name, fn_or_coro) 注册非关键任务
- start_idle_drain() 依次执行所有已注册任务
- 每个任务之间用 asyncio.sleep(0) 让出事件循环
- 单个任务失败不中断队列（只 log warning）
- 任务支持同步函数和协程函数
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import uuid
from typing import Callable, List, Union

logger = logging.getLogger(__name__)

# 任务类型：同步函数或协程函数
IdleTaskFn = Union[Callable[[], None], Callable[[], "asyncio.Coroutine"]]

# 全局状态（进程内单例）
_pending_tasks: List[tuple[str, str, IdleTaskFn]] = []
_draining: bool = False


def register_idle_task(
    name: str,
    fn: IdleTaskFn,
) -> str:
    """注册一个空闲任务。

    Args:
        name: 任务名称（用于日志）
        fn: 同步函数或协程函数（无参数）

    Returns:
        任务 ID
    """
    task_id = str(uuid.uuid4())
    _pending_tasks.append((task_id, name, fn))
    return task_id


def is_idle_draining() -> bool:
    """是否正在执行 drain。"""
    return _draining


def clear_idle_queue() -> None:
    """清空待执行队列（用于测试）。"""
    global _pending_tasks, _draining
    _pending_tasks = []
    _draining = False


async def start_idle_drain() -> None:
    """依次执行所有已注册的空闲任务。

    每个任务之间用 asyncio.sleep(0) 让出事件循环。
    单个任务失败只 log warning，不中断队列。
    """
    global _pending_tasks, _draining

    if _draining:
        logger.warning("[idle-queue] drain already in progress, skipping")
        return

    _draining = True
    tasks = _pending_tasks
    _pending_tasks = []

    for task_id, name, fn in tasks:
        try:
            result = fn()
            if inspect.isawaitable(result):
                await result
        except Exception as e:
            logger.warning("[idle-queue] task '%s' failed: %s", name, e)
        # 让出事件循环，不阻塞高优先级任务
        await asyncio.sleep(0)

    _draining = False
    logger.info("[idle-queue] drained %d task(s)", len(tasks))
