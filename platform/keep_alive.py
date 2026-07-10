"""Keep-alive TTL 安全网 — 防止调用方崩溃留下永久残留的后台任务。

设计参考 Halo keep-alive.ts：
- register(reason) 返回 Disposer，正常路径主动调用释放
- 崩溃安全网：每个 reason 带时间戳，惰性剪枝超 24h 的孤儿 reason
- 不用定时器，在 should_keep_alive() 调用时触发剪枝

适用场景：
- 自治调度器、事件钩子、健康监控等后台任务的生命周期管理
- 防止调用方崩溃或漏调清理导致进程无法退出
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, List

logger = logging.getLogger(__name__)

# 默认 TTL 24 小时
DEFAULT_TTL_SECONDS = 24 * 60 * 60


class KeepAliveManager:
    """Keep-alive 管理器。

    Args:
        ttl_seconds: reason 的存活时间（过期后被剪枝）
    """

    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS):
        # 注意：不要用 max(1.0, ...) 钳制，测试需要用小 TTL（如 0.05s）验证超时
        self._ttl = float(ttl_seconds)
        self._reasons: dict[str, float] = {}  # reason -> registered_at
        self._lock = threading.Lock()

    def register(self, reason: str) -> Callable[[], None]:
        """注册一个 keep-alive reason。

        重复注册刷新时间戳（续期）。

        Args:
            reason: reason 描述（如 "autonomy-scheduler-active"）

        Returns:
            Disposer 函数，调用后释放此 reason（幂等）
        """
        with self._lock:
            self._reasons[reason] = time.monotonic()
        logger.debug("[keep_alive] 注册 reason: %s", reason)

        disposed = [False]

        def _dispose():
            if disposed[0]:
                return
            disposed[0] = True
            with self._lock:
                self._reasons.pop(reason, None)
            logger.debug("[keep_alive] 释放 reason: %s", reason)

        return _dispose

    def _prune_expired(self) -> None:
        """剪枝过期的 reason（惰性调用，需持有锁）。"""
        now = time.monotonic()
        cutoff = now - self._ttl
        expired = [r for r, t in self._reasons.items() if t < cutoff]
        for r in expired:
            del self._reasons[r]
            logger.warning(
                "[keep_alive] 自动剪枝过期 reason: %s (TTL=%ds)",
                r, self._ttl,
            )

    def should_keep_alive(self) -> bool:
        """是否有活跃的 reason（触发惰性剪枝）。"""
        with self._lock:
            self._prune_expired()
            return len(self._reasons) > 0

    def get_active_reasons(self) -> List[str]:
        """获取活跃 reason 列表（触发惰性剪枝）。"""
        with self._lock:
            self._prune_expired()
            return list(self._reasons.keys())

    def get_active_count(self) -> int:
        """活跃 reason 数量。"""
        with self._lock:
            self._prune_expired()
            return len(self._reasons)

    def clear_all(self) -> None:
        """清空所有 reason。"""
        with self._lock:
            count = len(self._reasons)
            self._reasons.clear()
        logger.info("[keep_alive] 清空所有 reason (%d 个)", count)


# 全局单例
_keep_alive_manager: KeepAliveManager | None = None


def get_keep_alive_manager() -> KeepAliveManager:
    """获取全局 KeepAliveManager 单例。"""
    global _keep_alive_manager
    if _keep_alive_manager is None:
        _keep_alive_manager = KeepAliveManager()
    return _keep_alive_manager
