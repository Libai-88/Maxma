"""Coverage push tests for api/middleware/rate_limit.py.

Targets previously uncovered lines:
- Line 57: _refill early return when elapsed <= 0
- Line 123: start_cleanup_task idempotent (already running)
- Lines 135-140: _run async cleanup loop body
- Lines 146-150: stop_cleanup_task body
- Line 246: WebSocket scope passthrough in RateLimitMiddleware
- Line 396: second return in double-checked locking (get_ws_rate_limiter)

Note: Line 130 (`if loop is None: return`) is dead code —
asyncio.get_running_loop() either returns a loop or raises RuntimeError.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest

from api.middleware import rate_limit as rl_mod
from api.middleware.rate_limit import (
    RateLimitMiddleware,
    TokenBucket,
    TokenBucketRegistry,
    WsSessionRateLimiter,
    get_ws_rate_limiter,
    reset_ws_rate_limiter,
)


@pytest.fixture(autouse=True)
def reset_ws_singleton():
    """Reset the global WS rate limiter singleton before and after each test."""
    reset_ws_rate_limiter()
    yield
    reset_ws_rate_limiter()


# ── Line 57: _refill early return when elapsed <= 0 ────────────────


def test_refill_no_op_when_elapsed_zero(monkeypatch):
    """Line 57: when time.monotonic() returns the same value, elapsed is 0
    and _refill returns early without adding tokens."""
    fixed_time = 12345.0
    monkeypatch.setattr(time, "monotonic", lambda: fixed_time)

    bucket = TokenBucket(capacity=10, refill_rate=1.0, initial_tokens=5.0)
    # _last_refill was set to fixed_time during init.
    # Now peek() calls _refill(), which computes elapsed = 0 → return early.
    tokens = bucket.peek()
    assert tokens == 5.0  # unchanged — no refill happened


# ── Line 123: start_cleanup_task idempotent ────────────────────────


@pytest.mark.asyncio
async def test_start_cleanup_task_idempotent():
    """Line 123: calling start_cleanup_task twice does not create a second task."""
    registry = TokenBucketRegistry(capacity=10, refill_rate=1.0)
    registry.start_cleanup_task(interval=999)
    first_task = registry._cleanup_task
    assert first_task is not None

    # Second call should return early (line 123)
    registry.start_cleanup_task(interval=999)
    assert registry._cleanup_task is first_task

    # Cleanup
    await registry.stop_cleanup_task()


# ── Lines 135-140: _run async cleanup loop ─────────────────────────


@pytest.mark.asyncio
async def test_cleanup_task_runs_and_removes_idle_buckets():
    """Lines 135-140: the _run coroutine periodically cleans up idle buckets."""
    registry = TokenBucketRegistry(capacity=10, refill_rate=1.0, idle_ttl=0.01)
    # Add a bucket — it will be immediately "idle" because idle_ttl is tiny
    registry.get("idle-key")
    assert "idle-key" in registry._buckets

    # Start cleanup with a very short interval
    registry.start_cleanup_task(interval=0.05)

    # Wait long enough for at least one cleanup cycle
    await asyncio.sleep(0.15)

    # The idle bucket should have been removed by the _run loop
    assert "idle-key" not in registry._buckets

    await registry.stop_cleanup_task()


@pytest.mark.asyncio
async def test_cleanup_task_handles_exception_in_loop():
    """Lines 139-140: if cleanup() raises an exception inside _run, it is
    caught and logged without crashing the loop."""
    registry = TokenBucketRegistry(capacity=10, refill_rate=1.0, idle_ttl=0.01)

    # Patch cleanup to raise on first call, then work normally
    call_count = {"n": 0}
    original_cleanup = registry.cleanup

    def _cleanup_boom():
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("cleanup exploded")
        return original_cleanup()

    registry.cleanup = _cleanup_boom

    registry.start_cleanup_task(interval=0.02)
    await asyncio.sleep(0.08)

    # The task should still be running (exception was caught)
    assert not registry._cleanup_task.done()

    await registry.stop_cleanup_task()


# ── Lines 146-150: stop_cleanup_task ───────────────────────────────


@pytest.mark.asyncio
async def test_stop_cleanup_task_cancels_running():
    """Lines 146-150: stop_cleanup_task cancels a running cleanup task."""
    registry = TokenBucketRegistry(capacity=10, refill_rate=1.0)
    registry.start_cleanup_task(interval=999)
    assert registry._cleanup_task is not None
    assert not registry._cleanup_task.done()

    await registry.stop_cleanup_task()
    assert registry._cleanup_task is None


@pytest.mark.asyncio
async def test_stop_cleanup_task_when_already_done():
    """Lines 146-150: stop_cleanup_task handles an already-done task gracefully."""
    registry = TokenBucketRegistry(capacity=10, refill_rate=1.0)
    registry.start_cleanup_task(interval=999)
    # Manually cancel and await to mark as done
    registry._cleanup_task.cancel()
    try:
        await registry._cleanup_task
    except asyncio.CancelledError:
        pass
    assert registry._cleanup_task.done()

    # stop should handle the done task without error
    await registry.stop_cleanup_task()
    assert registry._cleanup_task is None


# ── Line 246: WebSocket scope passthrough ──────────────────────────


@pytest.mark.asyncio
async def test_rate_limit_middleware_passthrough_websocket():
    """Line 246: a WebSocket scope is passed through without rate limiting."""
    received_scopes = []

    class MockApp:
        async def __call__(self, scope, receive, send):
            received_scopes.append(scope["type"])

    middleware = RateLimitMiddleware(MockApp())
    # WebSocket scope — should be passed through directly
    await middleware({"type": "websocket", "path": "/ws/test"}, None, None)
    assert received_scopes == ["websocket"]


# ── Line 396: double-checked locking second return ─────────────────


def test_get_ws_rate_limiter_double_checked_locking(monkeypatch):
    """Line 396: when the singleton is set between the first check (line 392)
    and the locked second check (line 395), the second return is reached.

    This simulates a race condition where another thread creates the singleton
    between the two checks.
    """
    # Ensure singleton is None
    rl_mod._ws_rate_limiter = None

    # Create a fake limiter that "another thread" set
    fake_limiter = WsSessionRateLimiter()

    # Fake lock context manager that sets the singleton on __enter__,
    # simulating another thread creating it between the two checks
    class FakeLock:
        def __enter__(self):
            rl_mod._ws_rate_limiter = fake_limiter
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(rl_mod, "_ws_rate_limiter_lock", FakeLock())

    result = get_ws_rate_limiter()
    assert result is fake_limiter  # line 396 reached
