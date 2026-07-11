"""自治调度器指数退避 + 自动禁用测试。"""
import pytest
from agent.autonomy.scheduler import (
    BACKOFF_LEVELS_SECONDS,
    BackoffState,
    compute_next_interval,
    compute_anchor_grid_delay,
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
    """第二档延迟不会早于第一档，并限制在五档表内。"""
    state = BackoffState(base_interval=3600)
    state.record_failure()
    i1 = compute_next_interval(state)
    state.record_failure()
    i2 = compute_next_interval(state, random_uniform=lambda _low, high: high)
    assert i1 == BACKOFF_LEVELS_SECONDS[0]
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


def test_backoff_honors_a_custom_cap_below_the_first_level():
    """保留旧调用方自定义小上限时，抖动范围仍然有效。"""
    state = BackoffState(max_interval=10)
    state.record_failure()
    assert compute_next_interval(state) == 10
    state.record_failure()
    assert compute_next_interval(state, random_uniform=lambda _low, high: high) == 10


def test_all_five_backoff_levels_are_available():
    """每个失败档都有文档规定的最大退避值。"""
    for failure_count, expected in enumerate(BACKOFF_LEVELS_SECONDS, start=1):
        state = BackoffState()
        for _ in range(failure_count):
            state.record_failure()
        # 首次计算该档时不引入随机性，因此可以精确检验档位。
        assert compute_next_interval(state) == expected


def test_decorrelated_jitter_uses_prior_delay_and_current_level_cap():
    """重试抖动使用上一延迟，且不会越过当前失败档位。"""
    state = BackoffState()
    state.record_failure()
    assert compute_next_interval(state) == 30

    state.record_failure()
    observed_bounds = []

    def choose_upper(low: float, high: float) -> float:
        observed_bounds.append((low, high))
        return high

    assert compute_next_interval(state, random_uniform=choose_upper) == 60
    assert observed_bounds == [(30.0, 60.0)]

    state.record_failure()
    assert compute_next_interval(state, random_uniform=choose_upper) == 180
    assert observed_bounds[-1] == (30.0, 180.0)


def test_anchor_grid_skips_missed_offline_periods():
    """离线多个周期后只定位到下一个未来网格点。"""
    assert compute_anchor_grid_delay(100.0, 60.0, 100.0) == 60.0
    # 100, 160, 220, 280 已经错过；下一个网格点是 340。
    assert compute_anchor_grid_delay(100.0, 60.0, 281.0) == 59.0


def test_anchor_grid_handles_future_anchor_and_rejects_zero_interval():
    assert compute_anchor_grid_delay(100.0, 60.0, 70.0) == 30.0
    with pytest.raises(ValueError, match="positive"):
        compute_anchor_grid_delay(100.0, 0.0, 100.0)
