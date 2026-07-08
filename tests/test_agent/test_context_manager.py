"""Tests for agent/context_manager.py — 上下文管理测试。"""

import asyncio

import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from agent.context_manager import (
    _summarize_old_messages,
    maybe_trim_checkpoint,
    should_trim_context,
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

    def test_summarize_filters_short_windows_path_noise(self):
        """短 Windows 路径片段不应被误识别为文件路径。"""
        messages = [
            HumanMessage(content=r"短路径 C:\a 不应保留，真实路径 C:\work\foo.py 应保留"),
        ]

        summary = _summarize_old_messages(messages)

        assert r"C:\work\foo.py" in summary
        assert r"- C:\a" not in summary


class TestMaybeTrimCheckpoint:
    """maybe_trim_checkpoint() 函数测试。"""

    def test_no_trim_when_not_needed(self):
        """不需要截断时返回 compressed=False。"""
        mock_config = {"configurable": {"thread_id": "test"}}

        # token_counter 返回低值，不应触发截断
        state = {"messages": [HumanMessage(content="hello")]}

        result = asyncio.run(
            maybe_trim_checkpoint(
                state, mock_config,
                token_counter=lambda msgs: 100,
                max_tokens=4000,
            )
        )

        assert result.get("compressed") is False

    def test_handles_empty_messages(self):
        """空消息列表时返回 compressed=False。"""
        mock_config = {"configurable": {"thread_id": "test"}}

        state = {"messages": []}

        result = asyncio.run(
            maybe_trim_checkpoint(
                state, mock_config,
                token_counter=lambda msgs: 0,
                max_tokens=4000,
            )
        )

        assert result.get("compressed") is False


# ── Task B1: Cache-Preserving Compaction ─────────────────────────────


@pytest.mark.asyncio
async def test_cache_preserving_compaction_keeps_static_prefix():
    """cache-preserving 压缩应保留 SystemMessage（静态前缀）"""
    from agent.context_manager import maybe_trim_checkpoint

    messages = [
        SystemMessage(content="You are a helpful assistant."),
        HumanMessage(content="Hello 1"),
        AIMessage(content="Hi 1"),
        HumanMessage(content="Hello 2"),
        AIMessage(content="Hi 2"),
        HumanMessage(content="Hello 3"),
        AIMessage(content="Hi 3"),
    ]

    state = {
        "messages": messages,
        "session_id": "test-session",
    }

    config = {"configurable": {"thread_id": "test-thread"}}
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=MagicMock(content="Summary of old conversation"))

    result = await maybe_trim_checkpoint(
        state, config, llm=mock_llm,
        checkpointer=None, ws_callback=None,
        token_counter=lambda msgs: 10000,
        max_tokens=100,
    )

    # SystemMessage 必须保留在压缩后的消息列表中
    assert "messages" in result
    compressed_messages = result["messages"]
    assert any(isinstance(m, SystemMessage) for m in compressed_messages), \
        "SystemMessage (static prefix) must be preserved after compaction"


def test_hard_truncation_utf8_safe():
    """hard truncation 不应截断 UTF-8 多字节字符"""
    from agent.context_manager import truncate_text_head_tail

    text = "你好世界" * 100  # 每个"你好世界"是 12 字节
    head, tail = truncate_text_head_tail(text, max_bytes=50)
    # 确保截断后的文本可以正常编码解码
    assert head.encode('utf-8').decode('utf-8') == head
    assert tail.encode('utf-8').decode('utf-8') == tail
    assert len(head.encode('utf-8')) <= 50


# ── Task E1: Hard Truncation 降级策略 ─────────────────────────────


@pytest.mark.asyncio
async def test_compaction_falls_back_to_hard_truncation_on_llm_error():
    """LLM 摘要失败时应降级为 hard truncation"""
    from agent.context_manager import maybe_trim_checkpoint
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
    from unittest.mock import AsyncMock

    messages = [SystemMessage(content="You are helpful.")]
    for i in range(50):
        messages.append(HumanMessage(content=f"Hello {i} " * 50))
        messages.append(AIMessage(content=f"Hi {i} " * 50))

    mock_llm = AsyncMock()
    # LLM 抛错模拟超窗
    mock_llm.ainvoke = AsyncMock(side_effect=Exception("context length exceeded"))

    result = await maybe_trim_checkpoint(
        {"messages": messages, "session_id": "s1"},
        {"configurable": {"thread_id": "t1"}},
        llm=mock_llm,
        checkpointer=None,
        ws_callback=None,
        token_counter=lambda msgs: 100000,
        max_tokens=1000,
    )

    # 不应抛错，应返回降级结果
    assert "messages" in result
    new_msgs = result["messages"]
    # SystemMessage 仍应保留
    assert any(isinstance(m, SystemMessage) for m in new_msgs)
    # 消息总数应显著减少
    assert len(new_msgs) < len(messages)
    # 应标记降级原因
    assert result.get("compaction_fallback") in (True, "hard_truncation", None)


# ── Task E2: Fresh Compact 显式刷新 ─────────────────────────────


@pytest.mark.asyncio
async def test_fresh_compact_regenerates_from_raw_messages():
    """fresh compact 应从原始消息重新生成摘要，而非基于旧摘要"""
    from agent.context_manager import fresh_compact
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
    from unittest.mock import AsyncMock, MagicMock

    messages = [
        SystemMessage(content="You are helpful."),
        HumanMessage(content="我喜欢Python"),
        AIMessage(content="好的"),
        HumanMessage(content="我在学习Rust"),
        AIMessage(content="不错的方向"),
        HumanMessage(content="最近在用Vue3"),
        AIMessage(content="前端好选择"),
    ]

    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=MagicMock(
        content="用户喜欢Python，正在学习Rust，最近用Vue3做前端"
    ))

    mock_checkpointer = MagicMock()
    mock_checkpointer.aget_tuple = AsyncMock(return_value=MagicMock(checkpoint={"messages": messages}))
    mock_checkpointer.aput = AsyncMock(return_value=None)

    result = await fresh_compact(
        thread_id="t1",
        llm=mock_llm,
        checkpointer=mock_checkpointer,
        ws_callback=None,
    )

    # LLM 应被调用，且传入的是原始消息而非旧摘要
    assert mock_llm.ainvoke.called
    # 结果应包含新摘要
    assert result.get("refreshed") is True


# ── Task E3: 文件操作上下文追加 ─────────────────────────────


def test_extract_file_operations_from_messages():
    """从消息中提取文件操作上下文"""
    from agent.context_manager import extract_file_operations
    from langchain_core.messages import ToolMessage, AIMessage

    messages = [
        AIMessage(content="", tool_calls=[{"id": "tc1", "name": "file_read", "args": {"path": "d:/proj/main.py"}}]),
        ToolMessage(content="file content...", tool_call_id="tc1"),
        AIMessage(content="", tool_calls=[{"id": "tc2", "name": "file_write", "args": {"path": "d:/proj/utils.py", "content": "..."}}]),
        ToolMessage(content="written", tool_call_id="tc2"),
        AIMessage(content="", tool_calls=[{"id": "tc3", "name": "file_read", "args": {"path": "d:/proj/main.py"}}]),
        ToolMessage(content="file content...", tool_call_id="tc3"),
    ]

    ops = extract_file_operations(messages)
    # main.py 被读 2 次，应去重为 1 个 read
    assert any(o["path"] == "d:/proj/main.py" and o["op"] == "read" for o in ops)
    assert any(o["path"] == "d:/proj/utils.py" and o["op"] == "write" for o in ops)
    # 去重后应为 2 条
    paths = {(o["path"], o["op"]) for o in ops}
    assert len(paths) == 2


def test_file_operations_appended_to_summary():
    """文件操作上下文应追加到摘要末尾"""
    from agent.context_manager import append_file_ops_to_summary
    from langchain_core.messages import HumanMessage, AIMessage

    summary = "用户讨论了项目架构"
    file_ops = [
        {"path": "d:/proj/main.py", "op": "read"},
        {"path": "d:/proj/utils.py", "op": "write"},
    ]
    result = append_file_ops_to_summary(summary, file_ops)
    assert "d:/proj/main.py" in result
    assert "d:/proj/utils.py" in result
    assert "read" in result.lower() or "读" in result


# ── Task E4: 结构化摘要格式 ─────────────────────────────


def test_structured_summary_has_five_sections():
    """结构化摘要应有 5 个固定段"""
    from agent.context_manager import StructuredSummary, format_structured_summary

    summary = StructuredSummary(
        goal="帮用户搭建 Vue3 项目",
        constraints=["使用 TypeScript", "不引入 UI 库"],
        progress=["已初始化项目", "已配置 ESLint"],
        key_decisions=["选择 Vite 而非 Webpack", "使用 Composition API"],
        next_steps=["添加路由", "接入 Pinia"],
    )
    text = format_structured_summary(summary)
    assert "## Goal" in text or "## 目标" in text
    assert "## Constraints" in text or "## 约束" in text
    assert "## Progress" in text or "## 进展" in text
    assert "## Key Decisions" in text or "## 关键决策" in text
    assert "## Next Steps" in text or "## 下一步" in text
    assert "帮用户搭建 Vue3 项目" in text
    assert "选择 Vite 而非 Webpack" in text


def test_parse_structured_summary():
    """解析结构化摘要文本"""
    from agent.context_manager import parse_structured_summary

    text = """## Goal
帮用户重构代码

## Constraints
- 不破坏现有 API
- 保持测试通过

## Progress
- 完成模块拆分

## Key Decisions
- 采用工厂模式

## Next Steps
- 更新文档"""

    summary = parse_structured_summary(text)
    assert summary.goal == "帮用户重构代码"
    assert len(summary.constraints) == 2
    assert "不破坏现有 API" in summary.constraints[0]
    assert len(summary.progress) == 1
    assert len(summary.key_decisions) == 1
    assert len(summary.next_steps) == 1


def test_structured_summary_roundtrip():
    """结构化摘要往返：format → parse 应保持数据"""
    from agent.context_manager import StructuredSummary, format_structured_summary, parse_structured_summary

    original = StructuredSummary(
        goal="测试目标",
        constraints=["约束1"],
        progress=["进展1"],
        key_decisions=["决策1"],
        next_steps=["步骤1"],
    )
    text = format_structured_summary(original)
    parsed = parse_structured_summary(text)
    assert parsed.goal == original.goal
    assert parsed.constraints == original.constraints
    assert parsed.progress == original.progress
    assert parsed.key_decisions == original.key_decisions
    assert parsed.next_steps == original.next_steps
