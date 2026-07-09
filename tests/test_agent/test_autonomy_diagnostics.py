"""自治层诊断函数单元测试 — agent/autonomy/diagnostics.py。

测试策略：
- mock ErrorCollector 和 health 数据
- 覆盖：错误汇总、健康状态分类、诊断报告生成、优先级排序
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from agent.autonomy.diagnostics import (
    DiagnosticReport,
    ErrorSummary,
    HealthSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
    prioritize_issues,
)


class TestErrorSummary:
    def test_empty_errors(self):
        """无错误时返回空摘要。"""
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = []
        summary = collect_error_summary(mock_collector)
        assert summary.total == 0
        assert summary.by_category == {}

    def test_categorizes_errors(self):
        """按类别分类错误。"""
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = [
            {"category": "tool_error", "message": "kb_search failed", "timestamp": "2026-07-09T10:00:00"},
            {"category": "tool_error", "message": "run_python failed", "timestamp": "2026-07-09T10:01:00"},
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:02:00"},
        ]
        summary = collect_error_summary(mock_collector)
        assert summary.total == 3
        assert summary.by_category.get("tool_error") == 2
        assert summary.by_category.get("llm_error") == 1

    def test_collects_recent_messages(self):
        """收集最近 N 条错误消息。"""
        errors = [
            {"category": "tool_error", "message": f"error {i}", "timestamp": f"2026-07-09T1{i}:00:00"}
            for i in range(10)
        ]
        mock_collector = MagicMock()
        mock_collector.get_errors.return_value = errors
        summary = collect_error_summary(mock_collector, max_recent=5)
        assert len(summary.recent_messages) == 5
        assert summary.recent_messages[0] == "error 9"  # 最新在前


class TestHealthSummary:
    def test_all_healthy(self):
        """全部组件健康。"""
        health_data = {
            "status": "ok",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }
        summary = collect_health_summary(health_data)
        assert summary.overall_status == "ok"
        assert len(summary.degraded_components) == 0

    def test_degraded_components(self):
        """检测到降级组件。"""
        health_data = {
            "status": "degraded",
            "llm": {"status": "degraded"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "degraded"},
        }
        summary = collect_health_summary(health_data)
        assert summary.overall_status == "degraded"
        assert "llm" in summary.degraded_components
        assert "mcp_tools" in summary.degraded_components


class TestBuildDiagnosticReport:
    def test_report_contains_sections(self):
        """诊断报告包含错误摘要和健康摘要。"""
        error_summary = ErrorSummary(total=2, by_category={"tool_error": 2}, recent_messages=["err1", "err2"])
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])

        report = build_diagnostic_report(error_summary, health_summary)

        assert "error_summary" in report
        assert "health_summary" in report
        assert report["error_summary"]["total"] == 2
        assert report["health_summary"]["overall_status"] == "ok"
        assert "generated_at" in report

    def test_report_includes_issues_list(self):
        """报告包含问题列表。"""
        error_summary = ErrorSummary(total=1, by_category={"llm_error": 1}, recent_messages=["API timeout"])
        health_summary = HealthSummary(overall_status="degraded", degraded_components=["llm"])

        report = build_diagnostic_report(error_summary, health_summary)

        assert "issues" in report
        assert len(report["issues"]) >= 1


class TestPrioritizeIssues:
    def test_empty_when_no_issues(self):
        """无问题时返回空列表。"""
        error_summary = ErrorSummary(total=0, by_category={}, recent_messages=[])
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        assert issues == []

    def test_llm_degraded_is_high_priority(self):
        """LLM 降级是高优先级。"""
        error_summary = ErrorSummary(total=0, by_category={}, recent_messages=[])
        health_summary = HealthSummary(overall_status="degraded", degraded_components=["llm"])
        issues = prioritize_issues(error_summary, health_summary)
        assert len(issues) == 1
        assert issues[0]["priority"] == "high"
        assert "llm" in issues[0]["component"]

    def test_repeated_tool_errors_are_medium_priority(self):
        """重复工具错误是中优先级。"""
        error_summary = ErrorSummary(total=5, by_category={"tool_error": 5}, recent_messages=["err"] * 5)
        health_summary = HealthSummary(overall_status="ok", degraded_components=[])
        issues = prioritize_issues(error_summary, health_summary)
        assert len(issues) == 1
        assert issues[0]["priority"] == "medium"
        assert issues[0]["category"] == "tool_error"
