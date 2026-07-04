"""Tests for agent/loop_detector.py — 死循环检测器单元测试。"""

import pytest
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from agent.loop_detector import (
    detect_loop,
    get_loop_break_messages,
    tool_call_signature,
)


# ── tool_call_signature ────────────────────────────────────────


class TestToolCallSignature:
    def test_empty_tool_calls_returns_empty_frozenset(self):
        assert tool_call_signature(None) == frozenset()
        assert tool_call_signature([]) == frozenset()

    def test_single_tool_call_signature(self):
        sig = tool_call_signature([
            {"name": "search", "args": {"query": "hello"}, "id": "1", "type": "tool_call"},
        ])
        assert sig == frozenset({("search", '{"query": "hello"}')})

    def test_multiple_tool_calls_signature(self):
        sig = tool_call_signature([
            {"name": "search", "args": {"q": "a"}, "id": "1"},
            {"name": "calc", "args": {"x": 1}, "id": "2"},
        ])
        assert len(sig) == 2
        assert ("search", '{"q": "a"}') in sig
        assert ("calc", '{"x": 1}') in sig

    def test_signature_ignores_id_and_order(self):
        """签名应忽略 tool_call_id 和顺序差异。"""
        sig_a = tool_call_signature([
            {"name": "search", "args": {"q": "a"}, "id": "id-1"},
            {"name": "calc", "args": {"x": 1}, "id": "id-2"},
        ])
        sig_b = tool_call_signature([
            {"name": "calc", "args": {"x": 1}, "id": "id-X"},
            {"name": "search", "args": {"q": "a"}, "id": "id-Y"},
        ])
        assert sig_a == sig_b

    def test_signature_normalizes_arg_key_order(self):
        """args 字段顺序不同应产生相同签名（sort_keys）。"""
        sig_a = tool_call_signature([
            {"name": "f", "args": {"a": 1, "b": 2}},
        ])
        sig_b = tool_call_signature([
            {"name": "f", "args": {"b": 2, "a": 1}},
        ])
        assert sig_a == sig_b

    def test_signature_handles_unserializable_args(self):
        """不可序列化的 args 应回退到 str 表示，不抛异常。"""

        class Unserializable:
            def __repr__(self):
                return "<unserializable>"

        sig = tool_call_signature([
            {"name": "f", "args": {"obj": Unserializable()}},
        ])
        assert len(sig) == 1
        name, _ = next(iter(sig))
        assert name == "f"


# ── detect_loop ────────────────────────────────────────────────


class TestDetectLoop:
    def test_threshold_below_two_never_loops(self):
        messages: list[BaseMessage] = [AIMessage(content="", tool_calls=[{
            "name": "t", "args": {}, "id": "1",
        }])]
        assert detect_loop(messages, threshold=1) is False
        assert detect_loop(messages, threshold=0) is False

    def test_insufficient_messages_no_loop(self):
        messages: list[BaseMessage] = [
            AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "1"}]),
            AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "2"}]),
        ]
        # 阈值 3，但只有 2 条带 tool_calls 的 AIMessage
        assert detect_loop(messages, threshold=3) is False

    def test_three_identical_signatures_detected(self):
        tc = [{"name": "search", "args": {"q": "x"}, "id": "1"}]
        messages: list[BaseMessage] = [
            HumanMessage(content="hi"),
            AIMessage(content="", tool_calls=tc),
            AIMessage(content="", tool_calls=tc),
            AIMessage(content="", tool_calls=tc),
        ]
        assert detect_loop(messages, threshold=3) is True

    def test_different_signatures_not_loop(self):
        messages: list[BaseMessage] = [
            AIMessage(content="", tool_calls=[{"name": "a", "args": {}, "id": "1"}]),
            AIMessage(content="", tool_calls=[{"name": "b", "args": {}, "id": "2"}]),
            AIMessage(content="", tool_calls=[{"name": "c", "args": {}, "id": "3"}]),
        ]
        assert detect_loop(messages, threshold=3) is False

    def test_only_recent_window_checked(self):
        """只检查最近 N 条，更早的不同签名不影响判定。"""
        tc_same = [{"name": "search", "args": {"q": "x"}, "id": "1"}]
        tc_diff = [{"name": "other", "args": {}, "id": "2"}]
        messages: list[BaseMessage] = [
            AIMessage(content="", tool_calls=tc_diff),  # 不计入最近 3 条
            AIMessage(content="", tool_calls=tc_same),
            AIMessage(content="", tool_calls=tc_same),
            AIMessage(content="", tool_calls=tc_same),
        ]
        assert detect_loop(messages, threshold=3) is True

    def test_ignores_ai_messages_without_tool_calls(self):
        """无 tool_calls 的 AIMessage 不参与计数。"""
        tc = [{"name": "search", "args": {}, "id": "1"}]
        messages: list[BaseMessage] = [
            AIMessage(content="thinking"),  # 无 tool_calls，跳过
            AIMessage(content="", tool_calls=tc),
            AIMessage(content=""),  # 无 tool_calls，跳过
            AIMessage(content="", tool_calls=tc),
            AIMessage(content="", tool_calls=tc),
        ]
        # 只有 3 条带 tool_calls，但签名相同
        assert detect_loop(messages, threshold=3) is True

    def test_empty_signature_not_loop(self):
        """空签名（无 tool_calls 的 AIMessage）不应误判为循环。"""
        messages: list[BaseMessage] = [
            AIMessage(content=""),
            AIMessage(content=""),
            AIMessage(content=""),
        ]
        assert detect_loop(messages, threshold=3) is False


# ── get_loop_break_messages ────────────────────────────────────


class TestGetLoopBreakMessages:
    def test_returns_tool_message_for_each_tool_call(self):
        ai_msg = AIMessage(content="", tool_calls=[
            {"name": "search", "args": {"q": "x"}, "id": "call-1"},
            {"name": "calc", "args": {}, "id": "call-2"},
        ])
        msgs = get_loop_break_messages(ai_msg)
        # 2 条 ToolMessage + 1 条 SystemMessage
        assert len(msgs) == 3
        tool_msgs = [m for m in msgs if isinstance(m, ToolMessage)]
        sys_msgs = [m for m in msgs if isinstance(m, SystemMessage)]
        assert len(tool_msgs) == 2
        assert len(sys_msgs) == 1
        assert tool_msgs[0].tool_call_id == "call-1"
        assert tool_msgs[1].tool_call_id == "call-2"

    def test_tool_message_name_matches_tool_call(self):
        ai_msg = AIMessage(content="", tool_calls=[
            {"name": "search", "args": {}, "id": "call-1"},
        ])
        msgs = get_loop_break_messages(ai_msg)
        tool_msg = next(m for m in msgs if isinstance(m, ToolMessage))
        assert tool_msg.name == "search"

    def test_system_message_includes_loop_break_notice(self):
        ai_msg = AIMessage(content="", tool_calls=[
            {"name": "search", "args": {}, "id": "call-1"},
        ])
        msgs = get_loop_break_messages(ai_msg)
        sys_msg = next(m for m in msgs if isinstance(m, SystemMessage))
        assert "循环检测" in sys_msg.content
        assert "search" in sys_msg.content

    def test_no_tool_calls_returns_only_system_message(self):
        ai_msg = AIMessage(content="done")
        msgs = get_loop_break_messages(ai_msg)
        # 无 tool_calls 时只返回 SystemMessage
        assert len(msgs) == 1
        assert isinstance(msgs[0], SystemMessage)
