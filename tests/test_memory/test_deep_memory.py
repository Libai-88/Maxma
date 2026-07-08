# tests/test_memory/test_deep_memory.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from memory.deep_memory import extract_facts_from_diff, DeepMemoryProcessor

def test_extract_facts_from_new_info():
    """从 diff 中提取新事实"""
    old_summary = "用户喜欢Python"
    new_summary = "用户喜欢Python，正在学习Rust"
    facts = extract_facts_from_diff(old_summary, new_summary)
    assert len(facts) >= 1
    assert any("Rust" in f for f in facts)

def test_no_new_facts_when_unchanged():
    old_summary = "用户喜欢Python"
    new_summary = "用户喜欢Python"
    facts = extract_facts_from_diff(old_summary, new_summary)
    assert len(facts) == 0

@pytest.mark.asyncio
async def test_deep_memory_processor():
    """Deep Memory 处理器端到端"""
    mock_llm = AsyncMock()
    mock_llm.ainvoke = AsyncMock(return_value=MagicMock(
        content='{"facts": ["用户擅长后端开发", "用户使用Vue3"], "timeline": ["讨论了技术栈"]}'
    ))
    mock_fact_store = MagicMock()

    processor = DeepMemoryProcessor(llm=mock_llm, fact_store=mock_fact_store)
    await processor.process_session_diff(
        session_id="sess-1",
        old_summary="旧摘要",
        new_summary="新摘要：用户擅长后端开发，使用Vue3",
    )
    # 应该调用了 fact_store.add 至少 2 次
    assert mock_fact_store.add.call_count >= 2
