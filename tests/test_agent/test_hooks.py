"""Tests for agent/hooks.py — 事件钩子停止与回收测试。"""

from agent.hooks import HookConfig, HookManager


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
