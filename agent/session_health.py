# agent/session_health.py
"""会话健康评估 + 孤儿 toolResult 修复。"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class HealthStatus(Enum):
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


@dataclass
class HealthReport:
    status: HealthStatus
    error_count: int = 0
    total_messages: int = 0
    last_error: str | None = None


def evaluate_session_health(
    messages: list[dict[str, Any]],
    *,
    check_last_n: int = 10,
    error_threshold: int = 3,
) -> HealthReport:
    """评估会话是否持续报错。

    检查最后 N 条 assistant message，stop_reason=error 计数 >= threshold 视为 unhealthy。
    """
    if not messages:
        return HealthReport(status=HealthStatus.UNKNOWN)

    recent = [m for m in messages[-check_last_n:] if m.get("role") == "assistant"]
    if not recent:
        return HealthReport(status=HealthStatus.UNKNOWN, total_messages=len(messages))

    error_count = sum(1 for m in recent if m.get("stop_reason") == "error")
    last_error_msg = None
    for m in reversed(recent):
        if m.get("stop_reason") == "error":
            last_error_msg = m.get("content", "")[:200] if isinstance(m.get("content"), str) else None
            break

    status = HealthStatus.UNHEALTHY if error_count >= error_threshold else HealthStatus.HEALTHY
    return HealthReport(
        status=status,
        error_count=error_count,
        total_messages=len(messages),
        last_error=last_error_msg,
    )


def repair_orphan_tool_results(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """修复孤儿 toolResult（父 toolCall 被丢弃的）。

    删除没有对应 toolCall 的 toolResult entry，修复 parentId 链。
    """
    tool_call_ids: set[str] = set()
    for m in messages:
        if m.get("role") == "assistant" and m.get("tool_calls"):
            for tc in m["tool_calls"]:
                if isinstance(tc, dict) and "id" in tc:
                    tool_call_ids.add(tc["id"])

    repaired: list[dict[str, Any]] = []
    for m in messages:
        if m.get("role") == "tool" and m.get("tool_call_id"):
            if m["tool_call_id"] not in tool_call_ids:
                continue  # 跳过孤儿 toolResult
        repaired.append(m)

    return repaired
