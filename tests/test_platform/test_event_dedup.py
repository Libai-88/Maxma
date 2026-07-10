"""事件去重缓存测试 — 应对 webhook 重试/文件监听爆发。"""
import time
import pytest
from maxma_platform.event_dedup import EventDedupCache


def test_first_event_is_new():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    assert cache.is_new("event-1") is True


def test_duplicate_within_ttl_is_deduped():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("event-1")
    assert cache.is_new("event-1") is False


def test_expired_event_is_new_again():
    cache = EventDedupCache(ttl_seconds=0.05, max_size=1000)
    cache.is_new("event-1")
    time.sleep(0.06)
    assert cache.is_new("event-1") is True


def test_max_size_eviction():
    """超过 max_size 时淘汰最早插入的条目。"""
    cache = EventDedupCache(ttl_seconds=60, max_size=3)
    cache.is_new("a")
    cache.is_new("b")
    cache.is_new("c")
    cache.is_new("d")  # 触发淘汰 "a"
    assert cache.is_new("a") is True  # "a" 已被淘汰


def test_clear():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("event-1")
    cache.clear()
    assert cache.is_new("event-1") is True


def test_size_tracking():
    cache = EventDedupCache(ttl_seconds=60, max_size=1000)
    cache.is_new("a")
    cache.is_new("b")
    cache.is_new("b")  # 不增加
    assert cache.size() == 2
