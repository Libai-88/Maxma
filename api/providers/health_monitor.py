"""Provider 健康监控后台任务（阶段 3.3）。

周期性调用每个 provider 的 check_health，根据结果调用 mark_healthy /
mark_unhealthy / mark_degraded。同时负责"恢复探测"：unhealthy 的 provider
经过 recovery_interval 后重新探测，恢复则标记 healthy。

启动方式：在 server.py 的 lifespan 中调用 start_health_monitor(provider_manager)，
关闭时调用 stop_health_monitor()。
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from api.providers.manager import ProviderManager
from api.runtime_status import reason_code_for

logger = logging.getLogger(__name__)


# 全局监控任务句柄
_monitor_task: Optional[asyncio.Task] = None
_monitor_stop_event: Optional[asyncio.Event] = None


async def _check_provider_health(provider_manager: ProviderManager, provider_id: str) -> None:
    """检查单个 provider 的健康状态并更新标记。

    健康检查超时则标记 degraded（非 error，避免完全禁用）。
    健康检查异常则标记 error。
    """
    import copy

    try:
        provider = copy.deepcopy(provider_manager.get(provider_id))
    except KeyError:
        return

    try:
        # 5s 超时，避免长时间阻塞监控循环
        result = await asyncio.wait_for(provider.check_health(), timeout=5.0)
    except asyncio.TimeoutError:
        provider_manager.mark_degraded(provider_id, detail="health check timeout")
        logger.warning("[health_monitor] %s 健康检查超时（标记 degraded）", provider_id)
        return
    except Exception as e:
        provider_manager.mark_unhealthy(provider_id, detail=f"health check error: {e}")
        logger.warning("[health_monitor] %s 健康检查异常: %s", provider_id, e)
        return

    if result.status == "ok":
        provider_manager.mark_healthy(provider_id, latency_ms=result.latency_ms)
    elif result.status == "degraded":
        provider_manager.mark_degraded(provider_id, detail=result.detail or "degraded")
    else:
        provider_manager.mark_unhealthy(provider_id, detail=result.detail or "error")


async def _health_check_loop(
    provider_manager: ProviderManager,
    check_interval: int,
    recovery_interval: int,
    unhealthy_threshold: int,
    stop_event: asyncio.Event,
) -> None:
    """健康检查主循环。

    Args:
        provider_manager: Provider 管理器
        check_interval: 健康检查间隔（秒）
        recovery_interval: unhealthy provider 的恢复探测间隔（秒）
        unhealthy_threshold: 连续失败次数达此值才标记 error（避免单次抖动）
        stop_event: 停止信号
    """
    logger.info(
        "[health_monitor] 健康监控后台任务已启动（check=%ds, recovery=%ds, threshold=%d）",
        check_interval,
        recovery_interval,
        unhealthy_threshold,
    )

    last_check_time: dict[str, float] = {}  # provider_id -> last check timestamp

    while not stop_event.is_set():
        try:
            now = time.time()
            for provider in list(provider_manager.iter_all()):
                pid = provider.config.id
                last = last_check_time.get(pid, 0)

                # 健康 provider 按 check_interval 检查
                # unhealthy provider 按 recovery_interval 重新探测
                if provider.is_unhealthy:
                    interval = recovery_interval
                else:
                    interval = check_interval

                if now - last < interval:
                    continue

                last_check_time[pid] = now
                await _check_provider_health(provider_manager, pid)

                # 阈值判断：连续失败未达 unhealthy_threshold 时降级为 degraded
                # 修复 Bug 1.5：原实现直接读 provider.consecutive_failures 和
                # provider.health_status，与 mark_unhealthy/mark_healthy 的写入
                # 不在同一个锁内，可能读到中间状态。改用 get_failure_snapshot
                # 在 ProviderManager._lock 内原子读取这两个字段。
                failures, hs = provider_manager.get_failure_snapshot(pid)
                if failures > 0 and failures < unhealthy_threshold:
                    reason_code = (
                        reason_code_for(hs.status, hs.detail)
                        if hs is not None
                        else None
                    )
                    # Invalid credentials/configuration cannot recover through
                    # a transient-failure threshold. Preserve the concrete
                    # diagnosis for the provider card and fallback selection.
                    if (
                        hs is not None
                        and hs.status == "error"
                        and reason_code
                        not in {"authentication_failed", "invalid_configuration"}
                    ):
                        provider_manager.mark_degraded(
                            pid,
                            detail=f"consecutive_failures={failures} < threshold={unhealthy_threshold}",
                        )

        except Exception as e:
            logger.warning("[health_monitor] 健康检查循环异常: %s", e)

        # 等待下一次检查（每秒检查一次 stop_event）
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass

    logger.info("[health_monitor] 健康监控后台任务已停止")


def start_health_monitor(
    provider_manager: ProviderManager,
    check_interval: int = 60,
    recovery_interval: int = 300,
    unhealthy_threshold: int = 3,
) -> None:
    """启动 provider 健康监控后台任务（幂等 — 不会重复启动）。

    Args:
        provider_manager: Provider 管理器
        check_interval: 健康检查间隔（秒），默认 60s
        recovery_interval: unhealthy provider 的恢复探测间隔（秒），默认 300s
        unhealthy_threshold: 连续失败次数达此值才标记 error，默认 3
    """
    global _monitor_task, _monitor_stop_event
    if _monitor_task is not None and not _monitor_task.done():
        return

    _monitor_stop_event = asyncio.Event()
    _monitor_task = asyncio.create_task(
        _health_check_loop(
            provider_manager,
            check_interval=check_interval,
            recovery_interval=recovery_interval,
            unhealthy_threshold=unhealthy_threshold,
            stop_event=_monitor_stop_event,
        )
    )


async def stop_health_monitor() -> None:
    """停止健康监控后台任务。"""
    global _monitor_task, _monitor_stop_event
    if _monitor_stop_event is not None:
        _monitor_stop_event.set()
    if _monitor_task is not None and not _monitor_task.done():
        try:
            await asyncio.wait_for(_monitor_task, timeout=5.0)
        except asyncio.TimeoutError:
            _monitor_task.cancel()
            try:
                await _monitor_task
            except asyncio.CancelledError:
                pass
        except asyncio.CancelledError:
            pass
    _monitor_task = None
    _monitor_stop_event = None
    logger.info("[health_monitor] 已停止")
