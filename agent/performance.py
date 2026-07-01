"""性能监控 — Agent 回合延迟追踪与慢查询告警。

记录每次 Agent 回合的关键性能指标：
- LLM 调用延迟
- 工具执行时间
- 总回合时间
- 上下文 token 使用量

慢查询告警：单回合超过阈值时通过 WebSocket 通知前端。
"""

import logging
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
    """性能监控器。"""

    def __init__(self):
        self._turn_history: list[TurnMetrics] = []
        self._current_turn: Optional[TurnMetrics] = None
        self._tool_calls: list[ToolCallMetric] = []

    def start_turn(self, session_id: str, turn_id: str = "", user_message: str = "") -> TurnMetrics:
        """开始追踪一个新的 Agent 回合。"""
        metrics = TurnMetrics(
            session_id=session_id,
            turn_id=turn_id,
            start_time=time.time(),
            user_message_preview=user_message[:80],
        )
        self._current_turn = metrics
        self._tool_calls = []
        return metrics

    def record_llm_call(self, duration: float) -> None:
        """记录一次 LLM 调用。"""
        if self._current_turn:
            self._current_turn.llm_call_count += 1
            self._current_turn.llm_total_duration += duration

    def record_tool_call(self, tool_name: str, duration: float, success: bool = True) -> None:
        """记录一次工具调用。"""
        metric = ToolCallMetric(
            tool_name=tool_name,
            duration=duration,
            is_slow=duration > SLOW_TOOL_THRESHOLD,
            success=success,
        )
        self._tool_calls.append(metric)

        if self._current_turn:
            self._current_turn.tool_call_count += 1
            self._current_turn.tool_total_duration += duration
            if metric.is_slow:
                self._current_turn.slow_tools.append(
                    f"{tool_name} ({duration:.1f}s)"
                )

    def record_context_usage(self, tokens: int, max_tokens: int) -> None:
        """记录上下文 token 使用量。"""
        if self._current_turn:
            self._current_turn.context_tokens = tokens
            self._current_turn.context_max_tokens = max_tokens
            self._current_turn.context_usage_percent = (
                (tokens / max_tokens * 100) if max_tokens > 0 else 0
            )

    def end_turn(self) -> TurnMetrics:
        """结束当前回合追踪，返回性能指标。"""
        if not self._current_turn:
            return TurnMetrics(session_id="")

        self._current_turn.end_time = time.time()
        self._current_turn.total_duration = (
            self._current_turn.end_time - self._current_turn.start_time
        )
        self._current_turn.is_slow = (
            self._current_turn.total_duration > SLOW_TURN_THRESHOLD
        )

        # 存入历史
        self._turn_history.append(self._current_turn)
        if len(self._turn_history) > MAX_HISTORY:
            self._turn_history = self._turn_history[-MAX_HISTORY:]

        result = self._current_turn
        self._current_turn = None
        self._tool_calls = []

        if result.is_slow:
            logger.warning(
                f"Slow turn detected: {result.total_duration:.1f}s "
                f"(LLM: {result.llm_total_duration:.1f}s, "
                f"Tools: {result.tool_total_duration:.1f}s, "
                f"session={result.session_id[:8]})"
            )

        return result

    def get_current_turn(self) -> Optional[TurnMetrics]:
        """获取当前正在追踪的回合。"""
        return self._current_turn

    def get_history(self, limit: int = 50) -> list[dict]:
        """获取回合性能历史。"""
        records = self._turn_history[-limit:]
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
        if not self._turn_history:
            return {
                "total_turns": 0,
                "avg_duration": 0,
                "slow_turns": 0,
                "avg_llm_duration": 0,
                "avg_tool_duration": 0,
            }

        durations = [m.total_duration for m in self._turn_history]
        slow_count = sum(1 for m in self._turn_history if m.is_slow)

        return {
            "total_turns": len(self._turn_history),
            "avg_duration": round(sum(durations) / len(durations), 2),
            "max_duration": round(max(durations), 2),
            "slow_turns": slow_count,
            "avg_llm_duration": round(
                sum(m.llm_total_duration for m in self._turn_history) / len(self._turn_history), 2
            ),
            "avg_tool_duration": round(
                sum(m.tool_total_duration for m in self._turn_history) / len(self._turn_history), 2
            ),
        }


# 全局单例
_monitor: PerformanceMonitor | None = None


def get_performance_monitor() -> PerformanceMonitor:
    """获取全局 PerformanceMonitor 实例。"""
    global _monitor
    if _monitor is None:
        _monitor = PerformanceMonitor()
    return _monitor
