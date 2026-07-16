# GUARD: agent.autonomy.completion_signal
try:
    import agent.autonomy.completion_signal
except ImportError:
    import pytest
    pytest.skip("agent.autonomy.completion_signal module removed — OMP replaces it", allow_module_level=True)

# tests/test_agent/test_completion_signal.py
"""report_to_user 完成信号测试。"""
import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from agent.autonomy.completion_signal import (
    detect_completion_signal,
    RunOutcome,
    should_auto_continue,
    build_auto_continue_message,
    MAX_AUTO_CONTINUES,
)


def test_detect_completion_signal_with_report_tool_call():
    """调用了 report_to_user 工具 → detected=True。"""

import pytest
try:
    import agent.autonomy
except ImportError:
    pytest.skip("agent.autonomy module removed — OMP replaces it", allow_module_level=True)

    ai_msg = AIMessage(
        content="",
        tool_calls=[{
            "name": "report_to_user",
            "args": {"type": "run_complete", "message": "done"},
            "id": "tc1",
        }],
    )
    result = detect_completion_signal([ai_msg])
    assert result.signal_detected is True
    assert result.report_type == "run_complete"


def test_detect_completion_signal_no_report_tool_call():
    """未调用 report_to_user → detected=False。"""
    ai_msg = AIMessage(
        content="",
        tool_calls=[{
            "name": "file_read",
            "args": {"path": "/tmp"},
            "id": "tc1",
        }],
    )
    result = detect_completion_signal([ai_msg])
    assert result.signal_detected is False


def test_detect_completion_signal_silent_stop():
    """silent stop（无 tool 调用，有文本）→ detected=False。"""
    ai_msg = AIMessage(content="我完成了")
    result = detect_completion_signal([ai_msg])
    assert result.signal_detected is False


def test_should_auto_continue_when_not_detected():
    """未检测到完成信号 → 应该自动 continue。"""
    result = RunOutcome(signal_detected=False, auto_continue_count=0)
    assert should_auto_continue(result) is True


def test_should_not_auto_continue_when_detected():
    """检测到完成信号 → 不应自动 continue。"""
    result = RunOutcome(signal_detected=True, auto_continue_count=0)
    assert should_auto_continue(result) is False


def test_should_not_auto_continue_when_max_reached():
    """达到最大 continue 次数 → 不应自动 continue。"""
    result = RunOutcome(
        signal_detected=False,
        auto_continue_count=MAX_AUTO_CONTINUES,
    )
    assert should_auto_continue(result) is False


def test_build_auto_continue_message():
    """自动 continue 消息包含提示。"""
    msg = build_auto_continue_message(count=1, max_count=10)
    assert "report_to_user" in msg
    assert "1" in msg
    assert "10" in msg


def test_run_outcome_determines_final_status():
    """RunOutcome 判定最终状态。"""
    # 完成信号检测到 → ok
    outcome = RunOutcome(signal_detected=True, auto_continue_count=0)
    assert outcome.final_status == "ok"

    # 未检测到 + 达到最大次数 → error
    outcome = RunOutcome(
        signal_detected=False,
        auto_continue_count=MAX_AUTO_CONTINUES,
    )
    assert outcome.final_status == "error"

    # 未检测到 + 未达到最大 → pending（应 continue）
    outcome = RunOutcome(signal_detected=False, auto_continue_count=3)
    assert outcome.final_status == "pending"
