# tests/test_tools/test_report_to_user.py
"""report_to_user 工具测试。"""
import pytest
try:
    from tools.system.tool_report_to_user import ReportToUserTool
except ImportError:
    ReportToUserTool = None


def test_tool_name():
    tool = ReportToUserTool()
    assert tool.name == "report_to_user"


def test_tool_run_complete():
    """run_complete 类型。"""
    tool = ReportToUserTool()
    result = tool._run(
        type="run_complete",
        message="任务完成",
    )
    assert "任务完成" in result


def test_tool_run_skipped():
    """run_skipped 类型。"""
    tool = ReportToUserTool()
    result = tool._run(
        type="run_skipped",
        message="无事可做",
    )
    assert "无事可做" in result


def test_tool_escalation():
    """escalation 类型。"""
    tool = ReportToUserTool()
    result = tool._run(
        type="escalation",
        message="需要确认：是否执行？",
        choices=["确认", "取消"],
    )
    assert "确认" in result
    assert "取消" in result


def test_tool_milestone():
    """milestone 类型。"""
    tool = ReportToUserTool()
    result = tool._run(
        type="milestone",
        message="发现重要信息",
    )
    assert "重要信息" in result
