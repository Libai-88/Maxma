# GUARD: agent.hooks
try:
    import agent.hooks
except ImportError:
    import pytest
    pytest.skip("agent.hooks module removed — OMP replaces it", allow_module_level=True)

"""Tests for agent/hooks.py — 事件钩子停止、回收与触发状态测试。"""

import pytest

from agent.hooks import (
    HookConfig,
    HookManager,
    HookTriggerRecord,
    HookUnsupportedError,
)


class _FakeWatcher:
    def __init__(self, *, stop_raises: bool = False):
        self.stop_raises = stop_raises
        self.stop_calls = 0
        self.join_calls: list[float | None] = []
        self._alive = True

    def stop(self):
        self.stop_calls += 1
        if self.stop_raises:
            raise RuntimeError("stop failed")

    def join(self, timeout=None):
        self.join_calls.append(timeout)
        self._alive = False

    def is_alive(self):
        return self._alive


def _build_hook() -> HookConfig:
    return HookConfig(
        hook_id="hook-1",
        name="watch files",
        hook_type="file_change",
        config={"path": "."},
        action="do something",
    )


def test_stop_hook_joins_file_watcher():
    manager = HookManager()
    hook = _build_hook()
    watcher = _FakeWatcher()
    manager._watchers[hook.hook_id] = watcher

    manager._stop_hook(hook)

    assert watcher.stop_calls == 1
    assert watcher.join_calls == [5]
    assert hook.hook_id not in manager._watchers


def test_stop_hook_still_joins_when_stop_raises():
    manager = HookManager()
    hook = _build_hook()
    watcher = _FakeWatcher(stop_raises=True)
    manager._watchers[hook.hook_id] = watcher

    manager._stop_hook(hook)

    assert watcher.stop_calls == 1
    assert watcher.join_calls == [5]


def test_fire_trigger_without_callback_records_unsupported():
    manager = HookManager()
    manager.save = lambda: None
    hook = _build_hook()

    manager._fire_trigger(hook, "file_change", "modified: example.py")

    history = manager.get_history()
    assert len(history) == 1
    assert history[0]["status"] == "unsupported"
    assert "未注册触发回调" in history[0]["result"]
    assert hook.trigger_count == 1


@pytest.mark.asyncio
async def test_execute_trigger_marks_unsupported_error():
    manager = HookManager()
    hook = _build_hook()
    record = HookTriggerRecord(
        trigger_id="trigger-1",
        hook_id=hook.hook_id,
        timestamp=1.0,
        trigger_type="webhook",
        trigger_detail="payload",
        status="pending",
    )

    async def unsupported_callback(_hook, _detail):
        raise HookUnsupportedError("not available")

    await manager._execute_trigger(hook, record, unsupported_callback)

    history = manager.get_history()
    assert history[0]["status"] == "unsupported"
    assert history[0]["result"] == "not available"


import pytest
try:
    import agent.hooks
except ImportError:
    pytest.skip("agent.hooks module removed — OMP replaces it", allow_module_level=True)
