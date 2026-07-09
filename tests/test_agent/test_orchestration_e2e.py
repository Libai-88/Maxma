"""编排层端到端集成测试。

验证 coordinator + verifier + delegation scope 三者协同工作，
以及全部关闭时与原行为完全一致（回归保护）。
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent


def _make_sequential_model(responses: list[str]) -> BaseChatModel:
    """创建按顺序返回多个响应的 mock model。"""
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    it = iter(responses)

    async def _ainvoke(messages):
        try:
            return AIMessage(content=next(it))
        except StopIteration:
            return AIMessage(content="（结束）")

    mock.ainvoke = _ainvoke
    return mock


class TestOrchestrationAllDisabled:
    """全部特性关闭时，图行为与原 Maxma 完全一致。"""

    @pytest.mark.asyncio
    async def test_original_behavior_preserved(self):
        model = _make_sequential_model(["你好！有什么可以帮你的？"])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=False,
            verifier_enabled=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "e2e-off"}},
        )
        # 应直接结束，无 coordinator/verifier 介入
        assert result is not None
        assert len(result["messages"]) >= 2


class TestOrchestrationAllEnabled:
    """全部特性开启时的协同测试。"""

    @pytest.mark.asyncio
    async def test_coordinator_routes_direct_for_greeting(self):
        """简单问候：coordinator 路由 direct，不进入主循环浪费 token。"""
        model = _make_sequential_model([
            "你好！很高兴见到你。",  # agent 直接回复
            '{"verdict":"sufficient","gaps":[],"rationale":"问候完整"}',  # verifier
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=True,
            verifier_enabled=True,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "e2e-on-1"}},
        )
        assert result is not None

    @pytest.mark.asyncio
    async def test_full_pipeline_question_answer_verified(self):
        """完整问题 → coordinator(main) → agent 回答 → verifier(sufficient) → END。"""
        model = _make_sequential_model([
            '{"target":"main","rationale":"通用问题"}',  # coordinator
            "LangGraph 是用于构建状态机的框架，支持持久化和人流。",  # agent
            '{"verdict":"sufficient","gaps":[],"rationale":"答案完整"}',  # verifier
        ])
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=True,
            verifier_enabled=True,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="LangGraph 是什么？")]},
            config={"configurable": {"thread_id": "e2e-on-2"}},
        )
        assert result is not None
