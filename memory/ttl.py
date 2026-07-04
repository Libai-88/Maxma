"""TTL 遗忘机制 — 后台 asyncio 调度器。

周期性扫描所有 MemoryManager 实例，调用 ``purge_expired()`` 删除已过期条目，
并失效 narrative 缓存让前端能立即看到清理后的结果。

用法::

    from memory.ttl import schedule_purge, stop_purge

    schedule_purge(interval_seconds=300, mm_list=[mm1, mm2])
    # ...
    await stop_purge()
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable, Optional

from memory.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

# 全局调度状态（单例，进程内只允许一个调度任务）
_purge_task: Optional[asyncio.Task] = None
_purge_loop: Optional[asyncio.AbstractEventLoop] = None


def schedule_purge(
    interval_seconds: int,
    mm_list: Iterable[MemoryManager],
) -> asyncio.Task:
    """启动后台 TTL 清理任务。

    若已有任务在运行，先取消旧任务再启动新任务（幂等）。

    Args:
        interval_seconds: 执行间隔（秒）
        mm_list: 需要清理的 MemoryManager 实例列表

    Returns:
        已启动的 asyncio.Task
    """
    global _purge_task, _purge_loop
    # 取消已有任务（不 await，让旧任务自然结束）
    if _purge_task is not None and not _purge_task.done():
        _purge_task.cancel()
    _purge_loop = asyncio.get_event_loop()
    mm_tuple = tuple(mm_list)

    async def _run_purge():
        logger.info(
            "[ttl] purge task started, interval=%ds, managers=%d",
            interval_seconds, len(mm_tuple),
        )
        while True:
            try:
                await asyncio.sleep(interval_seconds)
                total_purged = 0
                for mm in mm_tuple:
                    try:
                        total_purged += mm.purge_expired()
                    except Exception as e:
                        logger.warning("[ttl] purge failed for %s: %s",
                                       getattr(mm, "_yaml_file", "?"), e)
                if total_purged > 0:
                    logger.info("[ttl] purged %d expired item(s)", total_purged)
                    # 失效 narrative 缓存（best-effort）
                    try:
                        from memory.narrative import invalidate_narrative_cache
                        invalidate_narrative_cache()
                    except Exception:
                        pass
                    # 4 层架构：失效系统提示词缓存（含语义记忆段）
                    try:
                        from agent.prompts import invalidate_prompt_cache
                        invalidate_prompt_cache()
                    except Exception:
                        pass
            except asyncio.CancelledError:
                logger.info("[ttl] purge task cancelled")
                raise
            except Exception as e:
                # 不让单次异常杀死整个调度循环
                logger.error("[ttl] purge loop error: %s", e, exc_info=True)

    _purge_task = _purge_loop.create_task(_run_purge())
    return _purge_task


async def stop_purge() -> None:
    """停止后台 TTL 清理任务（幂等）。"""
    global _purge_task
    if _purge_task is None:
        return
    if not _purge_task.done():
        _purge_task.cancel()
        try:
            await _purge_task
        except asyncio.CancelledError:
            pass
    _purge_task = None
    logger.info("[ttl] purge task stopped")


def is_running() -> bool:
    """调度任务是否正在运行。"""
    return _purge_task is not None and not _purge_task.done()
