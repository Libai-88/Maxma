"""错误恢复模块 — 工具连续失败时自动切换策略。

机制：
- 追踪每个工具的连续失败次数
- 连续失败 2 次后触发恢复策略
- 恢复策略：换参数建议 / 换替代工具 / 请求用户帮助
- 网络错误自动重试（指数退避，最多 3 次）

阶段 2.3 接入：
- `record_failure` 由 executor_node 在检测到 ToolMessage 失败时调用
- `should_replan` 判断是否应触发重规划（替代 executor 内置阈值判断的补充）
- `ReplanTrigger` 携带失败上下文，用于 executor → planner 路由
- `_suggest_alternatives` 扩充并行/sub_agent 场景的替代工具映射

阶段 3.1 增强：
- 集成 CircuitBreaker 三态状态机（closed/open/half-open）
- `record_failure` 同步驱动 CircuitBreaker（达阈值自动熔断）
- `record_success` 同步驱动 CircuitBreaker（half-open 探测成功恢复）
- `is_tool_circuit_open(tool_name)` 供 executor 检查熔断状态
- `get_circuit_breaker(tool_name)` 获取单个工具的熔断器实例
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from agent.circuit_breaker import (
    CircuitBreaker,
    CircuitState,
    create_circuit_breaker_from_settings,
)

logger = logging.getLogger(__name__)

# 连续失败阈值
FAILURE_THRESHOLD = 2

# 网络重试配置
MAX_NETWORK_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # 秒
RETRY_MAX_DELAY = 10.0  # 秒


@dataclass
class ToolFailureRecord:
    """单个工具的失败记录。"""
    tool_name: str
    consecutive_failures: int = 0
    total_failures: int = 0
    last_error: str = ""
    last_error_time: float = 0.0
    recovery_suggested: bool = False


@dataclass
class RecoverySuggestion:
    """恢复建议。"""
    tool_name: str
    strategy: str  # "retry_different_params" / "alternative_tool" / "ask_user"
    message: str
    alternative_tools: list[str] = field(default_factory=list)


@dataclass
class ReplanTrigger:
    """重规划触发器 — 携带失败上下文供 executor 注入 planner。

    阶段 2.3 新增：当工具连续失败达到阈值且未超过 max_replans 时，
    ErrorRecoveryManager 触发 ReplanTrigger，executor 据此构造
    [重规划请求] SystemMessage 路由回 planner。
    """
    tool_name: str
    failed_step_description: str
    error_message: str
    completed_steps: str  # 已成功步骤的文本描述
    alternative_tools: list[str] = field(default_factory=list)
    suggestion_message: str = ""  # 来自 RecoverySuggestion.message
    timestamp: float = field(default_factory=time.time)


class ErrorRecoveryManager:
    """错误恢复管理器（线程安全，使用 threading.Lock 保护所有共享状态）。

    阶段 3.1 增强：集成 CircuitBreaker，每个工具独立一个熔断器实例。
    """

    def __init__(self):
        self._records: dict[str, ToolFailureRecord] = {}
        self._recovery_history: list[RecoverySuggestion] = []
        self._circuit_breakers: dict[str, CircuitBreaker] = {}
        self._lock = threading.Lock()

    # ── 阶段 3.1：CircuitBreaker 集成 ──────────────────────

    def get_circuit_breaker(self, tool_name: str) -> CircuitBreaker:
        """获取（或创建）指定工具的熔断器实例。

        每个工具独立一个 CircuitBreaker，首次访问时按 settings 配置创建。
        """
        with self._lock:
            if tool_name not in self._circuit_breakers:
                self._circuit_breakers[tool_name] = create_circuit_breaker_from_settings()
            return self._circuit_breakers[tool_name]

    def is_tool_circuit_open(self, tool_name: str) -> bool:
        """检查工具的熔断器是否处于 open 状态（硬熔断，不含 half-open）。

        executor 在工具失败后调用此方法，若返回 True 则强制触发重规划
        （继续调用该工具无意义）。half-open 状态允许探测调用，不算硬熔断。
        如需判断是否允许调用，使用 can_tool_execute。
        """
        cb = self.get_circuit_breaker(tool_name)
        return cb.is_open()

    def can_tool_execute(self, tool_name: str) -> bool:
        """检查工具是否可执行（熔断器允许调用）。

        与 is_tool_circuit_open 的区别：此方法在 half-open 状态下会消耗探测配额。
        executor 在调用工具前应使用此方法。
        """
        cb = self.get_circuit_breaker(tool_name)
        return cb.can_execute()

    def get_all_circuit_stats(self) -> dict[str, dict]:
        """获取所有工具的熔断器统计（用于监控/前端展示）。"""
        with self._lock:
            return {
                name: cb.get_stats()
                for name, cb in self._circuit_breakers.items()
            }

    def record_failure(self, tool_name: str, error: str) -> Optional[RecoverySuggestion]:
        """记录一次工具失败。如果连续失败达到阈值，返回恢复建议。

        阶段 3.1：同步驱动 CircuitBreaker.record_failure（在自身锁外调用，
        避免 ErrorRecoveryManager._lock 与 CircuitBreaker._lock 嵌套）。
        """
        suggestion: Optional[RecoverySuggestion] = None
        with self._lock:
            if tool_name not in self._records:
                self._records[tool_name] = ToolFailureRecord(tool_name=tool_name)

            record = self._records[tool_name]
            record.consecutive_failures += 1
            record.total_failures += 1
            record.last_error = error
            record.last_error_time = time.time()

            if record.consecutive_failures >= FAILURE_THRESHOLD and not record.recovery_suggested:
                record.recovery_suggested = True
                suggestion = self._generate_suggestion(tool_name, error, record)
                self._recovery_history.append(suggestion)
                # 限制历史记录数
                if len(self._recovery_history) > 200:
                    self._recovery_history = self._recovery_history[-200:]

        # 阶段 3.1：同步驱动 CircuitBreaker（在锁外调用避免嵌套锁）
        cb = self.get_circuit_breaker(tool_name)
        cb.record_failure(error)

        return suggestion

    def record_success(self, tool_name: str) -> None:
        """记录一次工具成功，重置连续失败计数。

        阶段 3.1：同步驱动 CircuitBreaker.record_success。
        """
        with self._lock:
            if tool_name in self._records:
                self._records[tool_name].consecutive_failures = 0
                self._records[tool_name].recovery_suggested = False

        # 阶段 3.1：同步驱动 CircuitBreaker（在锁外调用避免嵌套锁）
        cb = self.get_circuit_breaker(tool_name)
        cb.record_success()

    def get_failure_count(self, tool_name: str) -> int:
        """获取工具的连续失败次数。"""
        with self._lock:
            record = self._records.get(tool_name)
            return record.consecutive_failures if record else 0

    def should_replan(
        self,
        tool_name: str,
        failure_count: int | None = None,
        threshold: int = FAILURE_THRESHOLD,
    ) -> bool:
        """判断是否应触发重规划。

        阶段 2.3 新增：executor 调用以决定路由回 planner 还是跳过步骤。
        优先使用显式传入的 failure_count（来自 AgentState.failure_count，
        跨步骤累计），否则回退到该工具的连续失败次数。

        Args:
            tool_name: 工具名（用于查询连续失败记录）
            failure_count: 显式失败计数（来自 state.failure_count，跨步骤累计）
            threshold: 触发阈值（默认 FAILURE_THRESHOLD=2）
        """
        if failure_count is not None:
            return failure_count >= threshold
        with self._lock:
            record = self._records.get(tool_name)
            return record is not None and record.consecutive_failures >= threshold

    def build_replan_trigger(
        self,
        tool_name: str,
        failed_step_description: str,
        error_message: str,
        completed_steps: str = "",
    ) -> ReplanTrigger:
        """构造 ReplanTrigger 携带失败上下文（不修改内部状态）。

        executor 在决定触发重规划后调用，将失败上下文打包传给 planner。
        会附带该工具的替代工具建议（来自 _suggest_alternatives）和
        最近一次 RecoverySuggestion.message（若有）。
        """
        alternatives = self._suggest_alternatives(tool_name)
        with self._lock:
            last_suggestion = self._recovery_history[-1] if self._recovery_history else None
        suggestion_msg = last_suggestion.message if (
            last_suggestion and last_suggestion.tool_name == tool_name
        ) else ""
        return ReplanTrigger(
            tool_name=tool_name,
            failed_step_description=failed_step_description,
            error_message=error_message,
            completed_steps=completed_steps,
            alternative_tools=alternatives,
            suggestion_message=suggestion_msg,
        )

    def get_stats(self) -> dict:
        """获取所有工具的失败统计。"""
        with self._lock:
            return {
                name: {
                    "consecutive_failures": r.consecutive_failures,
                    "total_failures": r.total_failures,
                    "last_error": r.last_error[:100],
                    "last_error_time": r.last_error_time,
                }
                for name, r in self._records.items()
                if r.total_failures > 0
            }

    def get_recovery_history(self, limit: int = 20) -> list[dict]:
        """获取恢复建议历史。"""
        with self._lock:
            return [
                {
                    "tool_name": s.tool_name,
                    "strategy": s.strategy,
                    "message": s.message,
                    "alternative_tools": s.alternative_tools,
                }
                for s in self._recovery_history[-limit:]
            ]

    def reset(self, tool_name: str = "") -> None:
        """重置失败计数。如果指定工具名，只重置该工具；否则重置全部。

        阶段 3.1：同步重置对应工具的 CircuitBreaker。
        """
        with self._lock:
            if tool_name:
                if tool_name in self._records:
                    self._records[tool_name].consecutive_failures = 0
                    self._records[tool_name].recovery_suggested = False
            else:
                for record in self._records.values():
                    record.consecutive_failures = 0
                    record.recovery_suggested = False

        # 阶段 3.1：同步重置 CircuitBreaker
        if tool_name:
            cb = self.get_circuit_breaker(tool_name)
            cb.reset()
        else:
            with self._lock:
                cbs = list(self._circuit_breakers.values())
            for cb in cbs:
                cb.reset()

    def _generate_suggestion(
        self, tool_name: str, error: str, record: ToolFailureRecord
    ) -> RecoverySuggestion:
        """根据错误类型生成恢复建议。"""
        error_lower = error.lower()

        # 网络错误 → 建议重试
        if any(kw in error_lower for kw in ("timeout", "connection", "network", "dns", "ssl")):
            return RecoverySuggestion(
                tool_name=tool_name,
                strategy="retry_different_params",
                message=f"工具 {tool_name} 遇到网络错误（连续 {record.consecutive_failures} 次失败）。"
                        f"建议：等待几秒后重试，或检查网络连接。错误详情：{error[:100]}",
            )

        # 权限错误 → 建议换路径或请求用户
        if any(kw in error_lower for kw in ("permission", "denied", "blocked", "whitelist", "forbidden")):
            return RecoverySuggestion(
                tool_name=tool_name,
                strategy="ask_user",
                message=f"工具 {tool_name} 遇到权限问题（连续 {record.consecutive_failures} 次失败）。"
                        f"建议：请用户确认路径是否在白名单中，或选择其他路径。错误详情：{error[:100]}",
            )

        # 文件不存在 → 建议换路径
        if any(kw in error_lower for kw in ("not found", "不存在", "no such file")):
            return RecoverySuggestion(
                tool_name=tool_name,
                strategy="retry_different_params",
                message=f"工具 {tool_name} 找不到目标文件（连续 {record.consecutive_failures} 次失败）。"
                        f"建议：确认文件路径是否正确，或尝试搜索文件。错误详情：{error[:100]}",
            )

        # 通用错误 → 建议换工具
        alternatives = self._suggest_alternatives(tool_name)
        return RecoverySuggestion(
            tool_name=tool_name,
            strategy="alternative_tool" if alternatives else "ask_user",
            message=f"工具 {tool_name} 连续 {record.consecutive_failures} 次失败。"
                    f"错误详情：{error[:100]}",
            alternative_tools=alternatives,
        )

    def _suggest_alternatives(self, tool_name: str) -> list[str]:
        """根据工具名建议替代工具。

        阶段 2.3 扩充：覆盖并行/sub_agent 场景。
        - parallel_execute 失败 → 退化为 call_sub_agent 串行执行
        - call_sub_agent 失败 → 退化为单轮 LLM 推理（无独立上下文）
        - 文件/搜索/浏览器类工具保持原有映射
        """
        alternatives_map = {
            # 文件操作类
            "file_read": ["file_search", "run_python"],
            "file_edit": ["file_write", "run_python"],
            "file_write": ["file_edit", "run_python"],
            # 浏览器/搜索类
            "browser_browse": ["tavily_search", "tavily_extract"],
            "browser_extract": ["tavily_extract", "browser_browse"],
            "browser_screenshot": ["analyze_image"],
            "tavily_search": ["browser_browse", "tavily_extract"],
            "tavily_extract": ["browser_browse", "browser_extract"],
            # 图像分析
            "analyze_image": ["browser_screenshot"],
            # Git 类（回退到通用 run_python 执行 shell）
            "git_commit": ["run_python"],
            "git_push": ["run_python"],
            "git_status": ["run_python"],
            # 子 Agent 类（阶段 2.3 新增）
            "parallel_execute": ["call_sub_agent"],  # 串行退化为单子 Agent
            "call_sub_agent": [],  # 无替代工具，建议直接 LLM 推理
        }
        return alternatives_map.get(tool_name, [])


# 网络重试装饰器
async def retry_network_call(coro_func, *args, max_retries: int = MAX_NETWORK_RETRIES, **kwargs):
    """带指数退避的网络重试包装器。

    Usage:
        result = await retry_network_call(some_async_function, arg1, arg2)
    """
    import asyncio

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return await coro_func(*args, **kwargs)
        except Exception as e:
            last_error = e
            error_str = str(e).lower()
            # 只对网络相关错误重试
            is_network = any(kw in error_str for kw in (
                "timeout", "connection", "network", "dns", "ssl",
                "remote end closed", "broken pipe", "reset by peer",
            ))
            if not is_network or attempt >= max_retries:
                raise
            delay = min(RETRY_BASE_DELAY * (2 ** attempt), RETRY_MAX_DELAY)
            logger.warning(
                f"Network error on attempt {attempt + 1}/{max_retries + 1}, "
                f"retrying in {delay:.1f}s: {e}"
            )
            await asyncio.sleep(delay)

    raise last_error


# 全局单例
_recovery_manager: ErrorRecoveryManager | None = None
_recovery_manager_lock = threading.Lock()  # 保护单例初始化


def get_recovery_manager() -> ErrorRecoveryManager:
    """获取全局 ErrorRecoveryManager 实例。

    线程安全：通过 _recovery_manager_lock 双重检查，保证仅创建一个实例。
    """
    global _recovery_manager
    if _recovery_manager is not None:
        return _recovery_manager
    with _recovery_manager_lock:
        if _recovery_manager is None:
            _recovery_manager = ErrorRecoveryManager()
        return _recovery_manager
