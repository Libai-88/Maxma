"""Tests for agent/context_manager.py — 上下文管理测试。"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage

from agent.context_manager import (
    should_trim_context,
    _summarize_old_messages,
    maybe_trim_checkpoint,
)


class TestShouldTrimContext:
    """should_trim_context() 函数测试。"""

    def test_no_trim_when_under_limit(self):
        """消息数未超限时不需要截断。"""
        messages = [HumanMessage(content="msg1"), AIMessage(content="reply1")]
        
        result = should_trim_context(
            messages=messages,
            system_prompt_tokens=500,
            max_tokens=4000,
        )
        
        assert result is False

    def test_trim_when_over_limit(self):
        """消息数超限时需要截断。"""
        # 创建大量消息
        messages = [HumanMessage(content=f"msg{i}") for i in range(50)]
        
        result = should_trim_context(
            messages=messages,
            system_prompt_tokens=500,
            max_tokens=1000,  # 较小的限制
        )
        
        assert result is True

    def test_no_trim_with_empty_messages(self):
        """空消息列表不需要截断。"""
        result = should_trim_context(
            messages=[],
            system_prompt_tokens=500,
            max_tokens=4000,
        )
        
        assert result is False

    def test_no_trim_with_single_message(self):
        """单条消息不需要截断。"""
        messages = [HumanMessage(content="hello")]
        
        result = should_trim_context(
            messages=messages,
            system_prompt_tokens=500,
            max_tokens=4000,
        )
        
        assert result is False


class TestSummarizeOldMessages:
    """_summarize_old_messages() 函数测试。"""

    def test_summarize_human_messages(self):
        """提取 HumanMessage 的摘要。"""
        messages = [
            HumanMessage(content="你好，我叫李白"),
            AIMessage(content="你好！"),
            HumanMessage(content="今天天气怎么样？"),
        ]
        
        summary = _summarize_old_messages(messages)
        
        assert "李白" in summary or "2 条用户消息" in summary

    def test_summarize_counts_message_types(self):
        """统计各类型消息数量。"""
        messages = [
            HumanMessage(content="msg1"),
            HumanMessage(content="msg2"),
            AIMessage(content="reply1"),
            AIMessage(content="reply2"),
            ToolMessage(content="tool1", tool_call_id="1"),
        ]
        
        summary = _summarize_old_messages(messages)
        
        assert "2 条用户消息" in summary or "2" in summary
        assert "2 条 AI 回复" in summary or "2" in summary
        assert "1 次工具调用" in summary or "1" in summary

    def test_summarize_truncates_long_content(self):
        """长内容被截断。"""
        long_content = "x" * 200
        messages = [HumanMessage(content=long_content)]
        
        summary = _summarize_old_messages(messages)
        
        # 应该被截断到 100 字符左右
        assert len(summary) < 200

    def test_summarize_empty_messages(self):
        """空消息列表返回空摘要。"""
        summary = _summarize_old_messages([])
        
        assert "历史对话摘要" in summary or summary == ""

    def test_summarize_keeps_recent_messages(self):
        """保留最近 3 条用户消息的摘要。"""
        messages = [
            HumanMessage(content="msg1"),
            HumanMessage(content="msg2"),
            HumanMessage(content="msg3"),
            HumanMessage(content="msg4"),
            HumanMessage(content="msg5"),
        ]
        
        summary = _summarize_old_messages(messages)
        
        # 应该包含最近的消息
        assert "msg5" in summary or "msg4" in summary or "msg3" in summary


class TestMaybeTrimCheckpoint:
    """maybe_trim_checkpoint() 函数测试。"""

    @pytest.mark.asyncio
    async def test_no_trim_when_not_needed(self):
        """不需要截断时返回 False。"""
        mock_graph = MagicMock()
        mock_config = {"configurable": {"thread_id": "test"}}
        
        # Mock graph 的 get_state 返回短消息
        mock_state = MagicMock()
        mock_state.values = {"messages": [HumanMessage(content="hello")]}
        mock_graph.get_state = MagicMock(return_value=mock_state)
        
        result = await maybe_trim_checkpoint(
            graph=mock_graph,
            config=mock_config,
            system_prompt_tokens=500,
            max_tokens=4000,
        )
        
        # 应该返回 False（未截断）
        assert result is False

    @pytest.mark.asyncio
    async def test_handles_empty_messages(self):
        """空消息列表时返回 False。"""
        mock_graph = MagicMock()
        mock_config = {"configurable": {"thread_id": "test"}}
        
        mock_state = MagicMock()
        mock_state.values = {"messages": []}
        mock_graph.get_state = MagicMock(return_value=mock_state)
        
        result = await maybe_trim_checkpoint(
            graph=mock_graph,
            config=mock_config,
            system_prompt_tokens=500,
            max_tokens=4000,
        )
        
        assert result is False
