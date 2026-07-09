"""事件钩子去重集成测试。"""
import pytest
from agent.hooks import HookManager
from platform.event_dedup import EventDedupCache


def test_file_change_hook_dedup_within_ttl():
    """同一文件短时间内多次变更只触发一次。"""
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    # 模拟同一文件变更
    key1 = manager._make_dedup_key("file_change", "/path/to/file.py")
    key2 = manager._make_dedup_key("file_change", "/path/to/file.py")

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is False  # 去重


def test_different_files_not_deduped():
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    key1 = manager._make_dedup_key("file_change", "/path/to/file1.py")
    key2 = manager._make_dedup_key("file_change", "/path/to/file2.py")

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is True  # 不同文件不去重


def test_webhook_dedup_by_payload_hash():
    """webhook 按 payload hash 去重。"""
    manager = HookManager()
    manager._dedup_cache = EventDedupCache(ttl_seconds=60, max_size=1000)

    payload = '{"event": "push", "ref": "main"}'
    key1 = manager._make_dedup_key("webhook", payload)
    key2 = manager._make_dedup_key("webhook", payload)

    assert manager._dedup_cache.is_new(key1) is True
    assert manager._dedup_cache.is_new(key2) is False
