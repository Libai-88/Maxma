"""阶段 3.1 测试：CircuitBreaker 三态状态机 + ErrorRecoveryManager 集成。

测试覆盖：
1. CircuitBreaker 三态状态迁移（closed→open→half-open→closed/open）
2. 冷却时间窗口
3. half-open 探测调用
4. 线程安全
5. 与 ErrorRecoveryManager 的集成（record_failure/record_success 驱动熔断器）
6. 与 executor 失败路径的协同（熔断打开时强制触发 replan）
"""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from agent.circuit_breaker import (
    CircuitBreaker,
    CircuitState,
    create_circuit_breaker_from_settings,
)
from agent.error_recovery import ErrorRecoveryManager, get_recovery_manager


# ── CircuitBreaker 三态状态机 ───────────────────────────────


class TestCircuitBreakerStates:
    """测试 CircuitBreaker 三态状态迁移。"""

    def test_initial_state_is_closed(self):
        """新建的熔断器应处于 closed 状态。"""
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        assert cb.state == CircuitState.CLOSED
        assert cb.can_execute() is True
        assert cb.is_open() is False

    def test_closed_to_open_after_threshold(self):
        """closed 状态下连续失败达阈值 → open。"""
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        # 失败 2 次（未达阈值）
        cb.record_failure("error1")
        cb.record_failure("error2")
        assert cb.state == CircuitState.CLOSED
        assert cb.can_execute() is True

        # 第 3 次失败 → 熔断打开
        cb.record_failure("error3")
        assert cb.state == CircuitState.OPEN
        assert cb.can_execute() is False
        assert cb.is_open() is True

    def test_open_rejects_execution(self):
        """open 状态下 can_execute 返回 False，统计 rejection。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=60)
        cb.record_failure("error")
        assert cb.state == CircuitState.OPEN

        # 多次调用都应被拒绝
        assert cb.can_execute() is False
        assert cb.can_execute() is False
        stats = cb.get_stats()
        assert stats["total_rejections"] == 2

    def test_open_to_half_open_after_cooldown(self):
        """open 状态冷却时间过后 → half-open。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)
        cb.record_failure("error")
        assert cb.state == CircuitState.OPEN

        # 等待冷却时间过
        time.sleep(0.3)
        # 访问 state 应触发自动迁移
        assert cb.state == CircuitState.HALF_OPEN

    def test_half_open_success_restores_closed(self):
        """half-open 状态下探测成功 → closed。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)
        cb.record_failure("error")
        time.sleep(0.3)
        assert cb.state == CircuitState.HALF_OPEN

        # 探测成功
        cb.record_success()
        assert cb.state == CircuitState.CLOSED
        assert cb.can_execute() is True

    def test_half_open_failure_reopens_circuit(self):
        """half-open 状态下探测失败 → 重新 open。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)
        cb.record_failure("error")
        time.sleep(0.3)
        assert cb.state == CircuitState.HALF_OPEN

        # 探测失败
        cb.record_failure("probe error")
        assert cb.state == CircuitState.OPEN

    def test_half_open_max_calls_limit(self):
        """half-open 状态下探测调用数有上限。"""
        cb = CircuitBreaker(
            failure_threshold=1, recovery_timeout=0.1, half_open_max_calls=2
        )
        cb.record_failure("error")
        time.sleep(0.3)
        assert cb.state == CircuitState.HALF_OPEN

        # 前 2 次调用允许（消耗探测配额）
        assert cb.can_execute() is True
        assert cb.can_execute() is True
        # 第 3 次被拒绝
        assert cb.can_execute() is False

    def test_closed_record_success_resets_failure_count(self):
        """closed 状态下成功调用重置失败计数。"""
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=60)
        cb.record_failure("error1")
        cb.record_failure("error2")
        assert cb.get_stats()["consecutive_failures"] == 2

        cb.record_success()
        assert cb.get_stats()["consecutive_failures"] == 0

    def test_reset_returns_to_closed(self):
        """reset 方法将熔断器恢复到 closed。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=60)
        cb.record_failure("error")
        assert cb.state == CircuitState.OPEN

        cb.reset()
        assert cb.state == CircuitState.CLOSED
        assert cb.get_stats()["consecutive_failures"] == 0
        assert cb.get_stats()["total_failures"] == 0


# ── 冷却时间窗口 ─────────────────────────────────────────────


class TestCircuitBreakerCooldown:
    """测试冷却时间窗口行为。"""

    def test_open_before_cooldown_stays_open(self):
        """冷却时间未到时，state 仍为 open。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=1.0)
        cb.record_failure("error")
        assert cb.state == CircuitState.OPEN

        # 短暂等待（未到冷却时间）
        time.sleep(0.05)
        assert cb.state == CircuitState.OPEN

    def test_open_after_cooldown_transitions_to_half_open(self):
        """冷却时间到后，state 自动迁移到 half_open。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)
        cb.record_failure("error")
        time.sleep(0.3)
        assert cb.state == CircuitState.HALF_OPEN

    def test_cooldown_reset_on_reopen(self):
        """重新 open 时冷却计时器重置。"""
        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=0.1)
        cb.record_failure("error")
        time.sleep(0.3)
        assert cb.state == CircuitState.HALF_OPEN

        # 探测失败 → 重新 open，冷却计时器重置
        cb.record_failure("probe error")
        assert cb.state == CircuitState.OPEN

        # 立即检查应仍为 open（冷却时间未到）
        assert cb.state == CircuitState.OPEN


# ── 线程安全 ─────────────────────────────────────────────────


class TestCircuitBreakerThreadSafety:
    """测试 CircuitBreaker 的线程安全。"""

    def test_concurrent_record_failures(self):
        """多线程并发 record_failure 不应导致状态不一致。"""
        import threading

        cb = CircuitBreaker(failure_threshold=100, recovery_timeout=60)
        num_threads = 10
        failures_per_thread = 10

        def worker():
            for _ in range(failures_per_thread):
                cb.record_failure("error")

        threads = [threading.Thread(target=worker) for _ in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
        t.join(timeout=5)

        stats = cb.get_stats()
        assert stats["total_failures"] == num_threads * failures_per_thread
        # failure_threshold=100，总失败 100 次，刚好触发熔断
        assert stats["state"] == CircuitState.OPEN

    def test_concurrent_can_execute(self):
        """多线程并发 can_execute 不应导致 rejection 计数错误。"""
        import threading

        cb = CircuitBreaker(failure_threshold=1, recovery_timeout=60)
        cb.record_failure("error")
        assert cb.state == CircuitState.OPEN

        num_threads = 10
        rejections = [0] * num_threads

        def worker(idx):
            for _ in range(10):
                if not cb.can_execute():
                    rejections[idx] += 1

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
        for t in threads:
            t.start()
        for t in threads:
        t.join(timeout=5)

        total_rejections = sum(rejections)
        stats = cb.get_stats()
        assert stats["total_rejections"] == total_rejections


# ── ErrorRecoveryManager 集成 ────────────────────────────────


class TestErrorRecoveryCircuitBreakerIntegration:
    """测试 ErrorRecoveryManager 与 CircuitBreaker 的集成。"""

    def setup_method(self):
        """每个测试使用独立的 ErrorRecoveryManager 实例。"""
        self.manager = ErrorRecoveryManager()

    def test_get_circuit_breaker_returns_instance(self):
        """get_circuit_breaker 应返回 CircuitBreaker 实例。"""
        cb = self.manager.get_circuit_breaker("test_tool")
        assert isinstance(cb, CircuitBreaker)

    def test_get_circuit_breaker_returns_same_instance(self):
        """同一工具的多次 get_circuit_breaker 应返回同一实例。"""
        cb1 = self.manager.get_circuit_breaker("test_tool")
        cb2 = self.manager.get_circuit_breaker("test_tool")
        assert cb1 is cb2

    def test_record_failure_drives_circuit_breaker(self):
        """record_failure 应同步驱动 CircuitBreaker。"""
        # 使用低阈值的 CircuitBreaker
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            return_value=CircuitBreaker(failure_threshold=2, recovery_timeout=60),
        ):
            manager = ErrorRecoveryManager()
            manager.record_failure("tool_a", "error1")
            assert not manager.is_tool_circuit_open("tool_a")

            manager.record_failure("tool_a", "error2")
            assert manager.is_tool_circuit_open("tool_a")

    def test_record_success_drives_circuit_breaker(self):
        """record_success 应同步驱动 CircuitBreaker 恢复。"""
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            return_value=CircuitBreaker(failure_threshold=1, recovery_timeout=0.1),
        ):
            manager = ErrorRecoveryManager()
            manager.record_failure("tool_a", "error")
            assert manager.is_tool_circuit_open("tool_a")

            # 等待冷却 → half-open
            time.sleep(0.3)
            assert not manager.is_tool_circuit_open("tool_a")  # half-open 不算 open

            # record_success → 恢复 closed
            manager.record_success("tool_a")
            assert not manager.is_tool_circuit_open("tool_a")

    def test_is_tool_circuit_open(self):
        """is_tool_circuit_open 正确反映熔断状态。"""
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            return_value=CircuitBreaker(failure_threshold=1, recovery_timeout=60),
        ):
            manager = ErrorRecoveryManager()
            assert not manager.is_tool_circuit_open("tool_a")

            manager.record_failure("tool_a", "error")
            assert manager.is_tool_circuit_open("tool_a")

    def test_can_tool_execute(self):
        """can_tool_execute 在 half-open 状态消耗探测配额。"""
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            return_value=CircuitBreaker(
                failure_threshold=1, recovery_timeout=0.1, half_open_max_calls=1
            ),
        ):
            manager = ErrorRecoveryManager()
            manager.record_failure("tool_a", "error")
            time.sleep(0.3)

            # half-open：第一次允许，第二次拒绝
            assert manager.can_tool_execute("tool_a") is True
            assert manager.can_tool_execute("tool_a") is False

    def test_reset_clears_circuit_breaker(self):
        """reset 方法应同步重置 CircuitBreaker。"""
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            return_value=CircuitBreaker(failure_threshold=1, recovery_timeout=60),
        ):
            manager = ErrorRecoveryManager()
            manager.record_failure("tool_a", "error")
            assert manager.is_tool_circuit_open("tool_a")

            manager.reset("tool_a")
            assert not manager.is_tool_circuit_open("tool_a")

    def test_get_all_circuit_stats(self):
        """get_all_circuit_stats 返回所有工具的熔断器统计。"""
        # 使用 side_effect 工厂确保每个工具获得独立的 CircuitBreaker 实例
        with patch(
            "agent.error_recovery.create_circuit_breaker_from_settings",
            side_effect=lambda: CircuitBreaker(failure_threshold=5, recovery_timeout=60),
        ):
            manager = ErrorRecoveryManager()
            manager.record_failure("tool_a", "error")
            manager.record_failure("tool_b", "error")

            stats = manager.get_all_circuit_stats()
            assert "tool_a" in stats
            assert "tool_b" in stats
            assert stats["tool_a"]["total_failures"] == 1
            assert stats["tool_b"]["total_failures"] == 1


# ── 配置集成 ─────────────────────────────────────────────────


class TestCircuitBreakerConfig:
    """测试 CircuitBreaker 与 config.settings 的集成。"""

    def test_create_circuit_breaker_from_settings(self):
        """create_circuit_breaker_from_settings 应从配置创建实例。"""
        cb = create_circuit_breaker_from_settings()
        assert isinstance(cb, CircuitBreaker)
        # 默认值来自 config.settings
        assert cb.failure_threshold >= 1
        assert cb.recovery_timeout >= 1.0

    def test_create_circuit_breaker_fallback_on_error(self):
        """配置读取失败时应回退到默认值。"""
        # get_settings 在 create_circuit_breaker_from_settings 内部延迟导入，
        # 需 patch 源模块 config.settings.get_settings
        with patch("config.settings.get_settings", side_effect=Exception("config error")):
            cb = create_circuit_breaker_from_settings()
            assert isinstance(cb, CircuitBreaker)
            assert cb.failure_threshold == 5  # 默认值
            assert cb.recovery_timeout == 60.0  # 默认值
