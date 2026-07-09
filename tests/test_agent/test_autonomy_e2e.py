"""自治层端到端集成测试。

验证完整流程：诊断收集 → 报告生成 → 调度器 tick → 自改进 Runner（mocked），
以及全部关闭时不执行任何操作。
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agent.autonomy.diagnostics import (
    ErrorSummary,
    HealthSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
    prioritize_issues,
)
from agent.autonomy.scheduler import _run_tick


@pytest.fixture(autouse=True)
def _reset_scheduler():
    from agent.autonomy import scheduler
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    yield
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None


class TestAutonomyFullPipeline:
    """完整流程测试。"""

    @pytest.mark.asyncio
    async def test_diagnostics_to_runner_full_flow(self):
        """诊断 → 报告 → 有问题 → 触发 runner。"""
        # 准备 mock
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()
        mock_app.state.session_manager = MagicMock()
        mock_app.state.session_manager.create = AsyncMock()
        mock_app.state.session_manager.delete = AsyncMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = [
            {"category": "tool_error", "message": "kb_search failed", "timestamp": "2026-07-09T10:00:00"},
            {"category": "tool_error", "message": "run_python failed", "timestamp": "2026-07-09T10:01:00"},
            {"category": "tool_error", "message": "file_read failed", "timestamp": "2026-07-09T10:02:00"},
        ]

        mock_health = {
            "status": "degraded",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "degraded"},
        }

        # 执行 tick
        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    # 验证报告
                    assert report["error_summary"]["total"] == 3
                    assert report["health_summary"]["overall_status"] == "degraded"
                    assert len(report["issues"]) >= 1

                    # 验证 runner 被触发
                    mock_improve.assert_called_once()
                    call_args = mock_improve.call_args
                    # 传入的 report 应该包含 issues
                    assert "issues" in call_args[0][1] or "issues" in call_args[1].get("report", {})

    @pytest.mark.asyncio
    async def test_no_issues_no_runner(self):
        """无问题时不触发 runner。"""
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = []

        mock_health = {
            "status": "ok",
            "llm": {"status": "ok"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    assert len(report["issues"]) == 0
                    mock_improve.assert_not_called()

    @pytest.mark.asyncio
    async def test_self_improve_disabled_no_runner(self):
        """self_improve_enabled=False 时不触发 runner，即使有问题。"""
        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = [
            {"category": "llm_error", "message": "timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health = {
            "status": "degraded",
            "llm": {"status": "degraded"},
            "memory": {"status": "ok"},
            "native_tools": {"status": "ok"},
            "mcp_tools": {"status": "ok"},
        }

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=False)

                    assert len(report["issues"]) >= 1
                    mock_improve.assert_not_called()


class TestAutonomyPriorityOrdering:
    """优先级排序测试。"""

    def test_high_before_medium_before_low(self):
        """high 优先级排在 medium 和 low 之前。"""
        error_summary = ErrorSummary(
            total=5,
            by_category={"tool_error": 4, "llm_error": 1},
            recent_messages=["err"] * 5,
        )
        health_summary = HealthSummary(
            overall_status="degraded",
            degraded_components=["llm", "mcp_tools"],
        )

        issues = prioritize_issues(error_summary, health_summary)

        # llm 降级 → high
        # mcp_tools 降级 → medium
        # tool_error 4次 → medium
        # llm_error 1次 → low (但 llm 已在 degraded 中)
        assert issues[0]["priority"] == "high"
        assert "llm" in issues[0]["component"]
