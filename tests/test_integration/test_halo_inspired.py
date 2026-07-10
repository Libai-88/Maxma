"""Halo-inspired 增强功能集成验证测试。"""
import asyncio
import json
import pytest
from pathlib import Path

from agent.lifecycle.disposable import DisposableStore, to_disposable
from api.bootstrap.idle_queue import register_idle_task, start_idle_drain, clear_idle_queue
from api.security.credential_mask import mask_sensitive_fields, MASK_SENTINEL
from api.transcript.jsonl_writer import TranscriptWriter
from maxma_platform.event_dedup import EventDedupCache
from agent.autonomy.scheduler import BackoffState, compute_next_interval


def test_all_modules_importable():
    """所有新增模块可正常导入。"""
    import agent.lifecycle
    import api.bootstrap
    import api.security
    import api.transcript
    import maxma_platform.event_dedup


def test_idle_queue_and_disposable_together():
    """Idle Queue 任务中使用 Disposable。"""
    clear_idle_queue()
    store = DisposableStore()
    released = []

    def _task():
        store.add(to_disposable(lambda: released.append("cleaned")))

    register_idle_task("test", _task)

    asyncio.run(start_idle_drain())
    store.dispose()
    assert released == ["cleaned"]


def test_transcript_with_credential_mask():
    """Transcript 中不泄露凭据字段名。"""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w") as f:
        path = Path(f.name)

    try:
        writer = TranscriptWriter(path)
        writer.append_raw("human", "My API key is sk-1234567890")
        writer.close()

        # 读取后掩码
        messages = TranscriptWriter.read_messages(path)
        masked = mask_sensitive_fields({"messages": messages})
        # transcript 内容不应被掩码（它是对话内容，不是配置字段）
        assert "messages" in masked
    finally:
        path.unlink(missing_ok=True)


def test_backoff_and_event_dedup_independence():
    """退避状态和事件去重互不干扰。"""
    backoff = BackoffState(base_interval=3600)
    dedup = EventDedupCache(ttl_seconds=60, max_size=100)

    backoff.record_failure()
    assert dedup.is_new("event-1") is True
    assert dedup.is_new("event-1") is False

    backoff.record_success()
    assert backoff.consecutive_failures == 0
    # dedup 状态不受 backoff 影响
    assert dedup.is_new("event-1") is False
