"""事件去重缓存 — 应对 webhook 重试/文件监听爆发。

设计参考 Halo 的 event-dedup.ts：
- TTL 60s + maxSize 1000
- Map 插入序淘汰（FIFO）
- 线程安全（threading.Lock）

适用场景：
- webhook 重试导致同一事件被多次触发
- watchdog 文件监听短时间内多次回调
- 事件钩子重复触发保护
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict


class EventDedupCache:
    """事件去重缓存。

    Args:
        ttl_seconds: 事件指纹的存活时间（过期后同一事件视为新事件）
        max_size: 缓存最大条目数（FIFO 淘汰）
    """

    def __init__(self, ttl_seconds: float = 60.0, max_size: int = 1000):
        self._ttl = float(ttl_seconds)
        self._max_size = int(max_size)
        self._cache: OrderedDict[str, float] = OrderedDict()
        self._lock = threading.Lock()

    def is_new(self, event_key: str) -> bool:
        """检查事件是否为新的（未被去重）。

        如果是第一次见到此 key，返回 True 并缓存。
        如果在 TTL 内重复，返回 False（已去重）。
        如果超过 TTL，视为新事件，刷新时间戳。

        Args:
            event_key: 事件唯一指纹（如 hash(payload) 或 path+event_type）

        Returns:
            True 如果是新事件
        """
        now = time.monotonic()
        with self._lock:
            # 检查是否已存在且未过期
            if event_key in self._cache:
                last_seen = self._cache[event_key]
                if now - last_seen < self._ttl:
                    return False  # 去重
                # 已过期，刷新
                del self._cache[event_key]

            # 新事件：插入并检查容量
            self._cache[event_key] = now
            if len(self._cache) > self._max_size:
                # FIFO 淘汰最早插入的
                self._cache.popitem(last=False)
            return True

    def clear(self) -> None:
        """清空缓存。"""
        with self._lock:
            self._cache.clear()

    def size(self) -> int:
        """当前缓存条目数。"""
        with self._lock:
            return len(self._cache)
