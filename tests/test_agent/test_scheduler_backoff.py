"""自治调度器指数退避 + 自动禁用测试。"""
import asyncio
import pytest
from agent.autonomy.scheduler import (
    BackoffState,
    compute_next_interval,
    MAX_CONSECUTIVE_FAILURES,
)


def test_backoff_state_initial():
    state = BackoffState()
    assert state.consecutive_failures == 0
    assert state.is_disabled() is False


def test_backoff_increments_on_failure():
    state = BackoffState()
    state.record_failure()
    assert state.consecutive_failures == 1
    state.record_failure()
    assert state.consecutive_failures == 2


def test_backoff_resets_on_success():
    state = BackoffState()
    state.record_failure()
    state.record_failure()
    state.record_success()
    assert state.consecutive_failures == 0


def test_compute_next_interval_no_failures():
    """无失败时用基础间隔。"""
    state = BackoffState(base_interval=3600)
    assert compute_next_interval(state) == 3600


def test_compute_next_interval_with_backoff():
    """失败越多间隔越长（指数退避）。"""
    state = BackoffState(base_interval=3600)
    state.record_failure()
    i1 = compute_next_interval(state)
    state.record_failure()
    i2 = compute_next_interval(state)
    assert i1 > 3600
    assert i2 > i1


def test_auto_disable_after_max_failures():
    """连续失败达 MAX_CONSECUTIVE_FAILURES 次自动禁用。"""
    state = BackoffState(base_interval=3600)
    for _ in range(MAX_CONSECUTIVE_FAILURES):
        state.record_failure()
    assert state.is_disabled() is True


def test_backoff_capped_at_max():
    """退避间隔不超过上限。"""
    state = BackoffState(base_interval=3600, max_interval=7200)
    for _ in range(10):
        state.record_failure()
    interval = compute_next_interval(state)
    assert interval <= 7200
