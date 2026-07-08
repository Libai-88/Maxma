# tests/test_agent/test_llm_reviewer.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from agent.llm_reviewer import LLMReviewer, ReviewResult, ReviewAction

@pytest.mark.asyncio
async def test_small_reviewer_allows_low_risk():
    """小模型审查器允许低风险操作"""
    small_llm = AsyncMock()
    small_llm.ainvoke = AsyncMock(return_value=MagicMock(
        content='{"action":"allow","reason":"low risk","risk":"low"}'
    ))
    reviewer = LLMReviewer(small_llm=small_llm, large_llm=None)
    result = await reviewer.review(
        tool_name="file_read",
        tool_input={"path": "test.txt"},
        session_id="s1",
    )
    assert result.action == ReviewAction.ALLOW
    assert result.risk == "low"

@pytest.mark.asyncio
async def test_small_reviewer_escalates_high_risk():
    """小模型审查器遇到高风险升级到大模型"""
    small_llm = AsyncMock()
    small_llm.ainvoke = AsyncMock(return_value=MagicMock(
        content='{"action":"escalate","reason":"high risk operation","risk":"high"}'
    ))
    large_llm = AsyncMock()
    large_llm.ainvoke = AsyncMock(return_value=MagicMock(
        content='{"action":"allow","reason":"verified safe","risk":"medium"}'
    ))
    reviewer = LLMReviewer(small_llm=small_llm, large_llm=large_llm)
    result = await reviewer.review(
        tool_name="run_python",
        tool_input={"code": "import os; os.listdir('.')"},
        session_id="s1",
    )
    assert small_llm.ainvoke.called
    assert large_llm.ainvoke.called
    assert result.action == ReviewAction.ALLOW

@pytest.mark.asyncio
async def test_fallback_to_ask_user():
    """两个审查器都不可用时 fallback 到 ask_user"""
    reviewer = LLMReviewer(small_llm=None, large_llm=None)
    result = await reviewer.review(
        tool_name="file_write",
        tool_input={"path": "test.txt"},
        session_id="s1",
    )
    assert result.action == ReviewAction.ASK_USER
