"""Halo 功能性增强集成验证测试。"""
import asyncio
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from agent.stream_repair.pipeline import apply_stream_repairs
from agent.stream_repair.empty_turn import is_empty_turn, inject_placeholder_if_needed
from agent.stream_repair.tool_json_repair import repair_tool_calls_json, is_valid_json
from agent.stream_repair.usage_backfill import estimate_tokens, backfill_usage_if_missing
from agent.autonomy.completion_signal import (
    detect_completion_signal,
    should_auto_continue,
    build_auto_continue_message,
    MAX_AUTO_CONTINUES,
    RunOutcome,
)
from agent.autonomy.escalation import EscalationStore, ESCALATION_TIMEOUT_HOURS
from agent.memory.working_memory import WorkingMemoryStore
from maxma_platform.keep_alive import KeepAliveManager


@pytest.fixture(autouse=True)
def enable_stream_repair(monkeypatch):
    """为所有测试启用流式修复 feature flag。

    Maxma 的 settings 是自定义单例（_settings + get_settings()），
    通过 monkeypatch.setattr patch 实例属性即可。
    """
    from config.settings import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "stream_repair_enabled", True)


def test_all_functional_modules_importable():
    """所有新增功能模块可正常导入。"""
    import agent.stream_repair
    import agent.stream_repair.pipeline
    import agent.autonomy.completion_signal
    import agent.autonomy.escalation
    import agent.memory.working_memory
    import maxma_platform.keep_alive


def test_stream_repair_pipeline_fixes_glm_empty_turn():
    """端到端：GLM 空 turn 被修复。"""
    # 模拟 GLM-4.7 的空 turn
    glm_response = AIMessage(content="")
    input_msgs = [HumanMessage(content="帮我查一下天气")]

    result = apply_stream_repairs(glm_response, input_msgs)
    assert result.content == " "  # 占位空格（非空，避免历史回放 content: null 污染）
    assert result.content != ""  # 修复后不再是空字符串


def test_completion_signal_with_escalation_flow():
    """端到端：escalation 流程。"""
    # AI 调用 report_to_user(type="escalation")
    ai_msg = AIMessage(
        content="",
        tool_calls=[{
            "name": "report_to_user",
            "args": {
                "type": "escalation",
                "message": "需要确认是否执行此操作",
                "choices": ["确认", "取消"],
            },
            "id": "tc1",
        }],
    )
    outcome = detect_completion_signal([ai_msg])
    assert outcome.signal_detected is True
    assert outcome.report_type == "escalation"


def test_working_memory_snapshot_injection(tmp_path):
    """端到端：工作记忆 Push 注入。"""
    store = WorkingMemoryStore(tmp_path / "wm.md")
    store.ensure_created()
    store.write_content(
        "# now\n\n## State | 测试中\n- runs: 1\n\n# History\n\n## 2026-07-10-1200 | test\n"
    )
    snapshot = store.build_snapshot()
    assert "测试中" in snapshot
    assert "runs: 1" in snapshot


def test_keep_alive_protects_background_task():
    """端到端：keep-alive 保护后台任务。"""
    mgr = KeepAliveManager(ttl_seconds=86400)
    disposer = mgr.register("autonomy-scheduler")
    assert mgr.should_keep_alive() is True
    disposer()
    assert mgr.should_keep_alive() is False


def test_auto_continue_message_contains_guidance():
    """自动 continue 消息包含 report_to_user 指引。"""
    msg = build_auto_continue_message(1, 10)
    assert "report_to_user" in msg
    assert "1/10" in msg
