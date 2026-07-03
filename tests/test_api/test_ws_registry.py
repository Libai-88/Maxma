"""Tests for api/ws_registry.py."""

import threading

import pytest

from api.ws_registry import WebSocketRegistry


class FakeWebSocket:
    """仅用于占位的假 WebSocket 对象。"""

    def __init__(self, session_id: str):
        self.session_id = session_id


@pytest.fixture
def registry():
    return WebSocketRegistry()


def test_register_and_get(registry):
    ws = FakeWebSocket("session-1")
    registry.register("session-1", ws)

    assert registry.get("session-1") is ws
    assert registry.get("session-2") is None


def test_unregister_removes_mapping(registry):
    ws = FakeWebSocket("session-1")
    registry.register("session-1", ws)
    registry.unregister("session-1")

    assert registry.get("session-1") is None


def test_unregister_unknown_session_does_not_raise(registry):
    registry.unregister("unknown-session")


def test_concurrent_register_unregister_and_get(registry):
    """多线程并发访问注册表不应抛出异常或产生不一致状态。"""
    errors = []

    def worker(thread_id: int, count: int):
        for i in range(count):
            sid = f"session-{thread_id}-{i % 3}"
            try:
                if i % 5 == 0:
                    registry.unregister(sid)
                elif i % 5 == 1:
                    _ = registry.get(sid)
                else:
                    registry.register(sid, FakeWebSocket(sid))
            except Exception as e:  # noqa: BLE001
                errors.append(e)

    threads = [
        threading.Thread(target=worker, args=(tid, 50))
        for tid in range(5)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    # 最终状态必须满足：每个存在的 session 映射到一个 FakeWebSocket
    for sid, ws in registry._sessions.items():
        assert isinstance(ws, FakeWebSocket)
        assert ws.session_id == sid
