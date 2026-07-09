"""自治层诊断数据收集 — 从现有错误收集器和健康检查中提取诊断信息。

职责：收集错误摘要 + 健康状态 → 生成结构化诊断报告 → 按优先级排序问题。
纯函数，不修改任何状态。调度器（scheduler.py）负责调用本模块并据结果决定是否触发自改进。

来源：
- api/diagnostics.py 的 ErrorCollector — 收集所有运行时错误
- api/health.py 的 HealthResponse — 四部件健康状态
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# 诊断报告类型别名（供调度器/Runner 类型提示用）
DiagnosticReport = dict


def _get_err_field(err, name, default=""):
    """从 dict 或 dataclass 错误记录中提取字段。"""
    if isinstance(err, dict):
        return err.get(name, default)
    return getattr(err, name, default)


@dataclass
class ErrorSummary:
    """错误摘要。"""
    total: int
    by_category: dict[str, int]
    recent_messages: list[str]


@dataclass
class HealthSummary:
    """健康摘要。"""
    overall_status: str
    degraded_components: list[str]


def collect_error_summary(
    error_collector: Any,
    max_recent: int = 10,
) -> ErrorSummary:
    """从 ErrorCollector 收集错误摘要。

    Args:
        error_collector: api/diagnostics.py 的 ErrorCollector 单例
        max_recent: 最多收集的最近消息数

    Returns:
        ErrorSummary
    """
    try:
        errors = error_collector.get_all()
    except Exception as e:
        logger.warning("[autonomy:diagnostics] 收集错误失败: %s", e)
        return ErrorSummary(total=0, by_category={}, recent_messages=[])

    if not errors:
        return ErrorSummary(total=0, by_category={}, recent_messages=[])

    by_category: dict[str, int] = {}
    for err in errors:
        cat = _get_err_field(err, "category", "unknown")
        by_category[cat] = by_category.get(cat, 0) + 1

    # 最近消息（最新在前）
    recent = [
        _get_err_field(err, "message", "")
        for err in reversed(errors[-max_recent:])
    ]

    return ErrorSummary(
        total=len(errors),
        by_category=by_category,
        recent_messages=recent,
    )


def collect_health_summary(health_data: dict) -> HealthSummary:
    """从健康检查数据提取健康摘要。

    Args:
        health_data: api/health.py HealthResponse 的 dict 表示

    Returns:
        HealthSummary
    """
    overall = health_data.get("status", "unknown")
    degraded = []

    for component in ("llm", "memory", "native_tools", "mcp_tools"):
        comp_data = health_data.get(component, {})
        if isinstance(comp_data, dict) and comp_data.get("status") == "degraded":
            degraded.append(component)

    return HealthSummary(
        overall_status=overall,
        degraded_components=degraded,
    )


def prioritize_issues(
    error_summary: ErrorSummary,
    health_summary: HealthSummary,
) -> list[dict]:
    """按优先级排序问题列表。

    优先级规则：
    - high: LLM/memory 降级（影响核心功能）
    - medium: 重复工具错误（>=3 次）或 native_tools/mcp_tools 降级
    - low: 少量错误（<3 次）且无降级

    Returns:
        问题列表，每项 {priority, component, category, description}
    """
    issues: list[dict] = []

    # 高优先级：核心组件降级
    for component in health_summary.degraded_components:
        priority = "high" if component in ("llm", "memory") else "medium"
        issues.append({
            "priority": priority,
            "component": component,
            "category": "degraded",
            "description": f"组件 {component} 状态降级",
        })

    # 中/低优先级：重复错误
    for category, count in error_summary.by_category.items():
        if count >= 3:
            issues.append({
                "priority": "medium",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })
        elif count > 0 and not any(i["component"] == "tools" for i in issues):
            issues.append({
                "priority": "low",
                "component": "tools",
                "category": category,
                "description": f"类别 {category} 出现 {count} 次错误",
            })

    # 按优先级排序
    priority_order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda x: priority_order.get(x["priority"], 3))

    return issues


def build_diagnostic_report(
    error_summary: ErrorSummary,
    health_summary: HealthSummary,
) -> dict:
    """构建完整诊断报告。

    Args:
        error_summary: 错误摘要
        health_summary: 健康摘要

    Returns:
        诊断报告 dict，包含 error_summary、health_summary、issues、generated_at
    """
    issues = prioritize_issues(error_summary, health_summary)

    return {
        "generated_at": datetime.now().isoformat(),
        "error_summary": {
            "total": error_summary.total,
            "by_category": error_summary.by_category,
            "recent_messages": error_summary.recent_messages,
        },
        "health_summary": {
            "overall_status": health_summary.overall_status,
            "degraded_components": health_summary.degraded_components,
        },
        "issues": issues,
    }
