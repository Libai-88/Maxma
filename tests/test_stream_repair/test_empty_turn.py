# tests/test_stream_repair/test_empty_turn.py
"""空 turn 占位注入测试 — 修复 GLM-4.7/5.1 等 model 的空响应导致 agent 循环中止。"""
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from agent.stream_repair.empty_turn import (
    is_empty_turn,
    inject_placeholder_if_needed,
)


def test_detects_empty_turn_no_content_no_tool_calls():
    """无内容无 tool 调用的 AIMessage 是空 turn。"""
    msg = AIMessage(content="")
    assert is_empty_turn(msg) is True


def test_detects_empty_turn_whitespace_only():
    """纯空白内容也视为空 turn（无实质内容）。"""
    msg = AIMessage(content="   \n  \t  ")
    assert is_empty_turn(msg) is True


def test_not_empty_turn_with_text_content():
    """有实质文本内容不是空 turn。"""
    msg = AIMessage(content="我来帮你处理这个问题")
    assert is_empty_turn(msg) is False


def test_not_empty_turn_with_tool_calls():
    """有 tool 调用不是空 turn（即使文本为空）。"""
    msg = AIMessage(
        content="",
        tool_calls=[{"name": "file_read", "args": {"path": "/tmp"}, "id": "tc1"}],
    )
    assert is_empty_turn(msg) is False


def test_inject_placeholder_replaces_empty_content():
    """空 turn 被注入占位空格内容。"""
    msg = AIMessage(content="")
    result = inject_placeholder_if_needed(msg)
    assert result.content == " "
    assert result.content != ""  # 必须非空


def test_inject_placeholder_preserves_tool_calls():
    """有 tool 调用的消息不被修改。"""
    msg = AIMessage(
        content="",
        tool_calls=[{"name": "file_read", "args": {}, "id": "tc1"}],
    )
    result = inject_placeholder_if_needed(msg)
    assert result.content == ""  # 未修改
    assert len(result.tool_calls) == 1


def test_inject_placeholder_preserves_real_content():
    """有实质内容的消息不被修改。"""
    msg = AIMessage(content="实际回复内容")
    result = inject_placeholder_if_needed(msg)
    assert result.content == "实际回复内容"  # 未修改


def test_inject_placeholder_idempotent():
    """已注入占位的消息再次调用不重复处理。"""
    msg = AIMessage(content=" ")
    result = inject_placeholder_if_needed(msg)
    assert result.content == " "  # 已是占位，不变
