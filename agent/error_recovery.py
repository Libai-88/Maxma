"""错误恢复模块 — 工具连续失败时自动切换策略。

机制：
- 追踪每个工具的连续失败次数
- 连续失败 2 次后触发恢复策略
- 恢复策略：换参数建议 / 换替代工具 / 请求用户帮助
- 网络错误自动重试（指数退避，最多 3 次）
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

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


class ErrorRecoveryManager:
    """错误恢复管理器（线程安全，使用 threading.Lock 保护所有共享状态）。"""

    def __init__(self):
        self._records: dict[str, ToolFailureRecord] = {}
        self._recovery_history: list[RecoverySuggestion] = []
        self._lock = threading.Lock()

    def record_failure(self, tool_name: str, error: str) -> Optional[RecoverySuggestion]:
        """记录一次工具失败。如果连续失败达到阈值，返回恢复建议。"""
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
                return suggestion

            return None

    def record_success(self, tool_name: str) -> None:
        """记录一次工具成功，重置连续失败计数。"""
        with self._lock:
            if tool_name in self._records:
                self._records[tool_name].consecutive_failures = 0
                self._records[tool_name].recovery_suggested = False

    def get_failure_count(self, tool_name: str) -> int:
        """获取工具的连续失败次数。"""
        with self._lock:
            record = self._records.get(tool_name)
            return record.consecutive_failures if record else 0

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
        """重置失败计数。如果指定工具名，只重置该工具；否则重置全部。"""
        with self._lock:
            if tool_name:
                if tool_name in self._records:
                    self._records[tool_name].consecutive_failures = 0
                    self._records[tool_name].recovery_suggested = False
            else:
                for record in self._records.values():
                    record.consecutive_failures = 0
                    record.recovery_suggested = False

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
        """根据工具名建议替代工具。"""
        alternatives_map = {
            "file_read": ["file_search"],
            "file_edit": ["file_write"],
            "browser_browse": ["tavily_search", "tavily_extract"],
            "browser_extract": ["tavily_extract"],
            "analyze_image": ["browser_screenshot"],
            "git_commit": ["run_python"],
            "git_push": ["run_python"],
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


def get_recovery_manager() -> ErrorRecoveryManager:
    """获取全局 ErrorRecoveryManager 实例。"""
    global _recovery_manager
    if _recovery_manager is None:
        _recovery_manager = ErrorRecoveryManager()
    return _recovery_manager
