"""CircuitBreaker — 工具熔断状态机（阶段 3.1）。

在阶段 2.3 已接入的 ErrorRecoveryManager 基础上，新增 CircuitBreaker 状态机，
让工具连续失败达到阈值后自动熔断，半开探测恢复。

三态状态机：
- **closed**：正常调用，记录失败次数；达阈值 → open
- **open**：短路返回降级响应，不真正调用工具；冷却时间到 → half-open
- **half-open**：允许少量探测调用；成功 → closed，失败 → open

与阶段 2.3 的协同：
- CircuitBreaker 在 ToolNode/executor 层短路（熔断打开时不真正调用工具）
- should_replan 在 executor 层重规划（熔断短路返回的 ToolMessage 仍会被
  detect_tool_failure 检测到，触发 replan）
- 两者共享 record_failure 的失败计数（CircuitBreaker 触发熔断后，
  executor 的 should_replan 也会因 failure_count 达阈值而触发 replan）

线程安全：使用 threading.Lock 保护所有共享状态（与 ErrorRecoveryManager 一致）。
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class CircuitState(str, Enum):
    """熔断器三态。"""
    CLOSED = "closed"      # 正常调用
    OPEN = "open"          # 熔断打开，短路返回
    HALF_OPEN = "half_open"  # 半开探测


@dataclass
class CircuitBreakerStats:
    """熔断器统计信息（用于监控/日志）。"""
    state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    total_failures: int = 0
    total_successes: int = 0
    total_rejections: int = 0  # 熔断打开时被短路的调用数
    last_failure_time: float = 0.0
    last_success_time: float = 0.0
    opened_at: float = 0.0  # 最近一次进入 open 状态的时间戳


class CircuitBreaker:
    """单个工具的熔断器。

    线程安全：所有状态修改都在 self._lock 内进行。

    Args:
        failure_threshold: 连续失败多少次后熔断（默认 5）
        recovery_timeout: 熔断后冷却时间（秒），过后进入 half-open（默认 60）
        half_open_max_calls: half-open 状态下允许的探测调用数（默认 1）
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        half_open_max_calls: int = 1,
    ):
        self.failure_threshold = max(1, failure_threshold)
        # 注意：不钳制 recovery_timeout 的上限为 1.0，允许测试使用小值加速验证；
        # 生产环境由 config.settings 保证合理值（默认 60s）
        self.recovery_timeout = max(0.0, float(recovery_timeout))
        self.half_open_max_calls = max(1, half_open_max_calls)
        self._lock = threading.Lock()
        self._stats = CircuitBreakerStats()
        self._half_open_calls = 0  # half-open 状态下已发出的探测调用数

    @property
    def state(self) -> CircuitState:
        """当前熔断状态（自动处理 open → half_open 的冷却迁移）。"""
        with self._lock:
            self._maybe_transition_to_half_open()
            return self._stats.state

    def can_execute(self) -> bool:
        """判断当前是否允许调用工具。

        - closed: 允许
        - open: 拒绝（除非冷却时间已过，自动迁移到 half-open）
        - half-open: 允许（如果探测调用数未达上限）

        Returns:
            True 如果允许调用，False 如果应短路返回降级响应
        """
        with self._lock:
            self._maybe_transition_to_half_open()

            if self._stats.state == CircuitState.CLOSED:
                return True

            if self._stats.state == CircuitState.OPEN:
                # 冷却时间未到，拒绝调用
                self._stats.total_rejections += 1
                return False

            if self._stats.state == CircuitState.HALF_OPEN:
                # half-open：允许有限探测
                if self._half_open_calls < self.half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                # 探测调用数已满，拒绝
                self._stats.total_rejections += 1
                return False

            return True  # 不可达

    def is_open(self) -> bool:
        """熔断器是否处于 open 状态（不含 half-open）。

        half-open 允许有限探测调用，不算"熔断打开"。
        使用 can_execute 判断是否允许调用；使用 is_open 判断是否硬熔断。
        """
        state = self.state  # 触发冷却迁移
        return state == CircuitState.OPEN

    def record_failure(self, error: str = "") -> None:
        """记录一次失败。

        - closed: 递增失败计数，达阈值 → open
        - open: 忽略（不应发生，因为 can_execute 应返回 False）
        - half-open: 失败 → 立即回到 open
        """
        with self._lock:
            self._stats.total_failures += 1
            self._stats.last_failure_time = time.time()

            if self._stats.state == CircuitState.CLOSED:
                self._stats.consecutive_failures += 1
                if self._stats.consecutive_failures >= self.failure_threshold:
                    self._open_circuit()
                    logger.warning(
                        "CircuitBreaker: 工具熔断打开（连续失败 %d 次 ≥ 阈值 %d）",
                        self._stats.consecutive_failures,
                        self.failure_threshold,
                    )

            elif self._stats.state == CircuitState.HALF_OPEN:
                # 探测失败 → 重新熔断
                self._open_circuit()
                logger.warning(
                    "CircuitBreaker: half-open 探测失败，重新熔断打开"
                )

            # open 状态下不应调用 record_failure（can_execute 应返回 False）
            # 但如果被调用了，忽略即可

    def record_success(self) -> None:
        """记录一次成功。

        - closed: 重置失败计数
        - open: 忽略（不应发生）
        - half-open: 成功 → 恢复到 closed
        """
        with self._lock:
            self._stats.total_successes += 1
            self._stats.last_success_time = time.time()

            if self._stats.state == CircuitState.CLOSED:
                self._stats.consecutive_failures = 0

            elif self._stats.state == CircuitState.HALF_OPEN:
                # 探测成功 → 恢复 closed
                self._stats.state = CircuitState.CLOSED
                self._stats.consecutive_failures = 0
                self._stats.opened_at = 0.0
                self._half_open_calls = 0
                logger.info("CircuitBreaker: half-open 探测成功，熔断恢复 closed")

    def get_stats(self) -> dict:
        """获取熔断器统计信息（用于监控/前端展示）。"""
        with self._lock:
            self._maybe_transition_to_half_open()
            return {
                "state": self._stats.state.value,
                "consecutive_failures": self._stats.consecutive_failures,
                "total_failures": self._stats.total_failures,
                "total_successes": self._stats.total_successes,
                "total_rejections": self._stats.total_rejections,
                "failure_threshold": self.failure_threshold,
                "recovery_timeout": self.recovery_timeout,
                "last_failure_time": self._stats.last_failure_time,
                "last_success_time": self._stats.last_success_time,
                "opened_at": self._stats.opened_at,
            }

    def reset(self) -> None:
        """重置熔断器到 closed 状态（用于手动恢复或测试）。"""
        with self._lock:
            self._stats = CircuitBreakerStats()
            self._half_open_calls = 0

    # ── 内部方法（调用前必须持有 self._lock）──────────────────

    def _maybe_transition_to_half_open(self) -> None:
        """检查冷却时间是否已过，如果是则从 open 迁移到 half_open。

        必须在持有 self._lock 时调用。
        """
        if self._stats.state != CircuitState.OPEN:
            return
        if self._stats.opened_at <= 0:
            return
        elapsed = time.time() - self._stats.opened_at
        if elapsed >= self.recovery_timeout:
            self._stats.state = CircuitState.HALF_OPEN
            self._half_open_calls = 0
            logger.info(
                "CircuitBreaker: 冷却 %ds 已过，open → half_open（允许探测调用）",
                int(elapsed),
            )

    def _open_circuit(self) -> None:
        """将熔断器切换到 open 状态。

        必须在持有 self._lock 时调用。
        """
        self._stats.state = CircuitState.OPEN
        self._stats.opened_at = time.time()
        self._half_open_calls = 0


# ── 工具函数 ──────────────────────────────────────────────────


def create_circuit_breaker_from_settings() -> CircuitBreaker:
    """从 config.settings 创建 CircuitBreaker 实例。"""
    try:
        from config.settings import get_settings
        s = get_settings()
        return CircuitBreaker(
            failure_threshold=s.circuit_breaker_failure_threshold,
            recovery_timeout=s.circuit_breaker_recovery_timeout,
            half_open_max_calls=s.circuit_breaker_half_open_max_calls,
        )
    except Exception:
        # 配置读取失败时使用默认值
        return CircuitBreaker()
