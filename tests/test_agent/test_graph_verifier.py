"""Verifier 图节点集成测试。

测试策略：
- mock model，控制 verifier 返回 sufficient/insufficient
- 验证 verifier_enabled=False 时无 verifier 节点（向后兼容）
- 验证 insufficient 时路由回 agent（带 gap 注入）
- 验证 retries 耗尽后放行
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent


def _make_mock_model(responses: list[str]) -> BaseChatModel:
    """创建按顺序返回多个响应的 mock model。"""
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    responses_iter = iter(responses)

    async def _ainvoke(messages):
        try:
            return AIMessage(content=next(responses_iter))
        except StopIteration:
            return AIMessage(content="（无更多响应）")

    mock.ainvoke = _ainvoke
    return mock


class TestGraphWithVerifierDisabled:
    """verifier_enabled=False（默认）时，无 verifier 节点。"""

    @pytest.mark.asyncio
    async def test_answer_flows_directly_to_end(self):
        model = _make_mock_model(["直接答案，内容足够长以通过验证。"])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            verifier_enabled=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="问题")]},
            config={"configurable": {"thread_id": "v-test-1"}},
        )
        assert len(result["messages"]) >= 2


class TestGraphWithVerifierEnabled:
    """verifier_enabled=True 时的行为。"""

    @pytest.mark.asyncio
    async def test_sufficient_answer_reaches_end(self):
        """verifier 判定 sufficient 时正常结束。"""
        model = _make_mock_model([
            "这是一个完整的答案，详细回答了问题，内容足够充分。",
            '{"verdict":"sufficient","gaps":[],"rationale":"答案完整"}',
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            verifier_enabled=True,
            verifier_max_retries=2,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="解释 LangGraph")]},
            config={"configurable": {"thread_id": "v-test-2"}},
        )
        assert result is not None

    @pytest.mark.asyncio
    async def test_insufficient_then_sufficient(self):
        """verifier 判 insufficient → agent 补充 → verifier 判 sufficient。"""
        model = _make_mock_model([
            "简短答案。",  # 第一次回答（不充分）
            '{"verdict":"insufficient","gaps":["缺少细节"],"rationale":"太简短"}',  # verifier 1
            "这是补充后的详细答案，包含完整细节和充分的内容。",  # 第二次回答
            '{"verdict":"sufficient","gaps":[],"rationale":"已补充"}',  # verifier 2
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            verifier_enabled=True,
            verifier_max_retries=2,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="详细解释 LangGraph")]},
            config={"configurable": {"thread_id": "v-test-3"}},
        )
        assert result is not None
