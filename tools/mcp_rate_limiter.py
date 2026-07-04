"""MCP 调用速率限制 — per-server_id 令牌桶（阶段 4.4）。

与 HTTP 中间件限流（api/middleware/rate_limit.py）的区别：
- HTTP 限流按 IP/session 维度，在 ASGI 中间件层执行
- MCP 限流按 server_id 维度，在 tool 包装层执行（MCP 工具调用在 LangGraph
  ToolNode 内部，不经过 HTTP）

复用 `api/middleware/rate_limit.py` 的 `TokenBucket` 数据结构（线程安全、支持
capacity/refill_rate/try_take/peek/remaining），但限流逻辑独立。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from api.middleware.rate_limit import TokenBucket

logger = logging.getLogger(__name__)


class MCPRateLimiter:
    """per-server_id MCP 调用速率限制器。

    每个服务器一个独立的 TokenBucket：
    - capacity = mcp_rate_limit_burst（突发上限）
    - refill_rate = mcp_rate_limit_per_minute / 60（每秒补充的令牌数）

    线程安全。支持惰性创建和定期清理过期桶。

    Args:
        per_minute: 每分钟最大调用数
        burst: 突发上限（桶容量）
        enabled: 是否启用限流（False 时所有调用直接放行）
        idle_ttl: 超过此时间（秒）未访问的桶会被清理
    """

    def __init__(
        self,
        per_minute: int = 60,
        burst: int = 10,
        enabled: bool = True,
        idle_ttl: float = 600.0,
    ):
        self.per_minute = max(1, int(per_minute))
        self.burst = max(1, int(burst))
        self.enabled = bool(enabled)
        self.idle_ttl = idle_ttl
        self._buckets: dict[str, tuple[TokenBucket, float]] = {}
        self._lock = threading.Lock()

    def _get_bucket(self, server_id: str) -> TokenBucket:
        """获取（或惰性创建）指定 server_id 的 TokenBucket。"""
        now = time.monotonic()
        with self._lock:
            entry = self._buckets.get(server_id)
            if entry is None:
                bucket = TokenBucket(
                    capacity=self.burst,
                    refill_rate=self.per_minute / 60.0,
                )
                self._buckets[server_id] = (bucket, now)
                return bucket
            bucket, _ = entry
            self._buckets[server_id] = (bucket, now)
            return bucket

    def try_acquire(self, server_id: str) -> tuple[bool, Optional[dict]]:
        """尝试为 server_id 消耗 1 个令牌。

        Returns:
            (allowed, info)
            - allowed=True: 放行，info=None
            - allowed=False: 限流，info 含 retry_after/limit/remaining 详情
        """
        if not self.enabled:
            return True, None

        bucket = self._get_bucket(server_id)
        if bucket.try_take(1.0):
            return True, None

        remaining = bucket.remaining
        retry_after = max(
            1,
            int(round((1 - remaining) / bucket.refill_rate)),
        ) if remaining < 1 else 1

        return False, {
            "retry_after": retry_after,
            "limit": int(bucket.capacity),
            "remaining": int(bucket.remaining),
        }

    def cleanup(self) -> int:
        """清理长时间未访问的桶，返回清理数量。"""
        now = time.monotonic()
        with self._lock:
            expired = [
                k for k, (_, last) in self._buckets.items()
                if now - last > self.idle_ttl
            ]
            for k in expired:
                del self._buckets[k]
            return len(expired)

    def reset(self) -> None:
        """重置所有桶（用于测试）。"""
        with self._lock:
            self._buckets.clear()


# ── 全局单例 ───────────────────────────────────────────────────

_mcp_rate_limiter: Optional[MCPRateLimiter] = None
_mcp_rate_limiter_lock = threading.Lock()  # 保护单例初始化


def get_mcp_rate_limiter() -> MCPRateLimiter:
    """获取全局 MCP 限流器单例（从 settings 读取配置）。

    线程安全：通过 _mcp_rate_limiter_lock 双重检查，保证仅创建一个实例。
    """
    global _mcp_rate_limiter
    if _mcp_rate_limiter is not None:
        return _mcp_rate_limiter
    with _mcp_rate_limiter_lock:
        if _mcp_rate_limiter is not None:
            return _mcp_rate_limiter
        from config.settings import get_settings
        try:
            s = get_settings()
            _mcp_rate_limiter = MCPRateLimiter(
                per_minute=s.mcp_rate_limit_per_minute,
                burst=s.mcp_rate_limit_burst,
                enabled=s.mcp_rate_limit_enabled,
            )
        except Exception:
            _mcp_rate_limiter = MCPRateLimiter()  # 默认值
        return _mcp_rate_limiter


def reset_mcp_rate_limiter() -> None:
    """重置全局 MCP 限流器单例（用于测试/配置更新）。"""
    global _mcp_rate_limiter
    with _mcp_rate_limiter_lock:
        _mcp_rate_limiter = None
