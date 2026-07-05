"""性能监控 — Agent 回合延迟追踪与慢查询告警。

记录每次 Agent 回合的关键性能指标：
- LLM 调用延迟
- 工具执行时间
- 总回合时间
- 上下文 token 使用量

慢查询告警：单回合超过阈值时通过 WebSocket 通知前端。

线程安全（修复 Bug 1.7）：所有共享状态读写通过 threading.Lock 保护。

并发 Turn 支持（修复审核报告 CRITICAL #5）：使用 contextvars.ContextVar
让每个协程/线程有自己的 current turn，多个并发请求的指标互不覆盖。
共享的 _turn_history 仍由 _lock 保护。

单例初始化（修复 Bug 1.8）：get_performance_monitor() 通过 _init_lock
保证仅创建一个实例，避免双检查锁失效。
"""

import contextvars
import logging
import threading
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

logger = logging.getLogger(__name__)

# 慢查询阈值（秒）
SLOW_TURN_THRESHOLD = 30.0
SLOW_TOOL_THRESHOLD = 10.0

# 历史记录上限
MAX_HISTORY = 200


@dataclass
class TurnMetrics:
    """单次 Agent 回合的性能指标。"""
    session_id: str
    turn_id: str = ""
    start_time: float = 0.0
    end_time: float = 0.0
    total_duration: float = 0.0
    llm_call_count: int = 0
    llm_total_duration: float = 0.0
    tool_call_count: int = 0
    tool_total_duration: float = 0.0
    context_tokens: int = 0
    context_max_tokens: int = 0
    context_usage_percent: float = 0.0
    is_slow: bool = False
    slow_tools: list[str] = field(default_factory=list)
    user_message_preview: str = ""


@dataclass
class ToolCallMetric:
    """单次工具调用的性能指标。"""
    tool_name: str
    duration: float = 0.0
    is_slow: bool = False
    success: bool = True


class PerformanceMonitor:
    """性能监控器。

    线程安全（修复 Bug 1.7）：所有共享状态读写通过 _lock 保护。

    并发 Turn 支持（修复审核报告 CRITICAL #5）：使用 ContextVar 让每个协程/
    线程有自己的 current turn 和 tool_calls，多个并发请求的指标互不覆盖。
    共享的 _turn_history 由 _lock 保护。
    """

    def __init__(self):
        self._turn_history: list[TurnMetrics] = []
        self._lock = threading.Lock()
        # 每协程/线程独立的 current turn 和 tool_calls（并发安全）
        self._current_turn_var: contextvars.ContextVar[Optional[TurnMetrics]] = (
            contextvars.ContextVar("perf_current_turn", default=None)
        )
        self._tool_calls_var: contextvars.ContextVar[list[ToolCallMetric]] = (
            contextvars.ContextVar("perf_tool_calls", default=None)
        )

    def start_turn(self, session_id: str, turn_id: str = "", user_message: str = "") -> TurnMetrics:
        """开始追踪一个新的 Agent 回合。

        在当前协程/线程上下文中设置 current turn，不影响其他并发请求。
        """
        metrics = TurnMetrics(
            session_id=session_id,
            turn_id=turn_id,
            start_time=time.time(),
            user_message_preview=user_message[:80],
        )
        self._current_turn_var.set(metrics)
        self._tool_calls_var.set([])
        return metrics

    def record_llm_call(self, duration: float) -> None:
        """记录一次 LLM 调用（写入当前协程的 turn）。"""
        turn = self._current_turn_var.get()
        if turn:
            turn.llm_call_count += 1
            turn.llm_total_duration += duration

    def record_tool_call(self, tool_name: str, duration: float, success: bool = True) -> None:
        """记录一次工具调用（写入当前协程的 tool_calls 和 turn 聚合字段）。"""
        metric = ToolCallMetric(
            tool_name=tool_name,
            duration=duration,
            is_slow=duration > SLOW_TOOL_THRESHOLD,
            success=success,
        )
        tool_calls = self._tool_calls_var.get()
        if tool_calls is not None:
            tool_calls.append(metric)

        turn = self._current_turn_var.get()
        if turn:
            turn.tool_call_count += 1
            turn.tool_total_duration += duration
            if metric.is_slow:
                turn.slow_tools.append(
                    f"{tool_name} ({duration:.1f}s)"
                )

    def record_context_usage(self, tokens: int, max_tokens: int) -> None:
        """记录上下文 token 使用量（写入当前协程的 turn）。"""
        turn = self._current_turn_var.get()
        if turn:
            turn.context_tokens = tokens
            turn.context_max_tokens = max_tokens
            turn.context_usage_percent = (
                (tokens / max_tokens * 100) if max_tokens > 0 else 0
            )

    def end_turn(self) -> TurnMetrics:
        """结束当前协程的回合追踪，返回性能指标。

        将 turn 写入共享 _turn_history（加锁），并清理当前协程的上下文。
        """
        turn = self._current_turn_var.get()
        if not turn:
            return TurnMetrics(session_id="")

        turn.end_time = time.time()
        turn.total_duration = turn.end_time - turn.start_time
        turn.is_slow = turn.total_duration > SLOW_TURN_THRESHOLD

        # 共享历史需要加锁
        with self._lock:
            self._turn_history.append(turn)
            if len(self._turn_history) > MAX_HISTORY:
                self._turn_history = self._turn_history[-MAX_HISTORY:]

        # 清理当前协程上下文
        self._current_turn_var.set(None)
        self._tool_calls_var.set(None)

        if turn.is_slow:
            logger.warning(
                f"Slow turn detected: {turn.total_duration:.1f}s "
                f"(LLM: {turn.llm_total_duration:.1f}s, "
                f"Tools: {turn.tool_total_duration:.1f}s, "
                f"session={turn.session_id[:8]})"
            )

        return turn

    def get_current_turn(self) -> Optional[TurnMetrics]:
        """获取当前协程正在追踪的回合。"""
        return self._current_turn_var.get()

    def get_history(self, limit: int = 50) -> list[dict]:
        """获取回合性能历史。"""
        with self._lock:
            records = list(self._turn_history[-limit:])
        return [
            {
                "session_id": m.session_id[:8],
                "turn_id": m.turn_id[:8] if m.turn_id else "",
                "total_duration": round(m.total_duration, 2),
                "llm_calls": m.llm_call_count,
                "llm_duration": round(m.llm_total_duration, 2),
                "tool_calls": m.tool_call_count,
                "tool_duration": round(m.tool_total_duration, 2),
                "context_usage": round(m.context_usage_percent, 1),
                "is_slow": m.is_slow,
                "slow_tools": m.slow_tools,
                "user_preview": m.user_message_preview,
            }
            for m in reversed(records)
        ]

    def get_summary(self) -> dict:
        """获取性能摘要统计。"""
        with self._lock:
            history = list(self._turn_history)
        if not history:
            return {
                "total_turns": 0,
                "avg_duration": 0,
                "slow_turns": 0,
                "avg_llm_duration": 0,
                "avg_tool_duration": 0,
            }

        durations = [m.total_duration for m in history]
        slow_count = sum(1 for m in history if m.is_slow)

        return {
            "total_turns": len(history),
            "avg_duration": round(sum(durations) / len(durations), 2),
            "max_duration": round(max(durations), 2),
            "slow_turns": slow_count,
            "avg_llm_duration": round(
                sum(m.llm_total_duration for m in history) / len(history), 2
            ),
            "avg_tool_duration": round(
                sum(m.tool_total_duration for m in history) / len(history), 2
            ),
        }


# 全局单例
_monitor: PerformanceMonitor | None = None
_monitor_lock = threading.Lock()  # 修复 Bug 1.8：保护单例初始化


def get_performance_monitor() -> PerformanceMonitor:
    """获取全局 PerformanceMonitor 实例。

    线程安全（修复 Bug 1.8）：通过 _monitor_lock 双重检查，保证仅创建一个实例。
    """
    global _monitor
    if _monitor is not None:
        return _monitor
    with _monitor_lock:
        if _monitor is None:
            _monitor = PerformanceMonitor()
        return _monitor
