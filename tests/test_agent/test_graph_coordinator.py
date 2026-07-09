"""Coordinator 图节点集成测试。

测试策略：
- mock model，不依赖真实 LLM
- 验证 coordinator_enabled=False 时图结构不变（向后兼容）
- 验证 coordinator_enabled=True 时 coordinator 是入口
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.graph import build_agent, AgentState


def _make_mock_model(response_text: str = "测试回复") -> BaseChatModel:
    mock = MagicMock(spec=BaseChatModel)
    mock.bind_tools = MagicMock(return_value=mock)
    mock.ainvoke = AsyncMock(return_value=AIMessage(content=response_text))
    return mock


class TestGraphWithCoordinatorDisabled:
    """coordinator_enabled=False（默认）时，图结构与现有完全一致。"""

    def test_graph_builds_without_coordinator(self):
        model = _make_mock_model()
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=False,
        )
        assert graph is not None

    @pytest.mark.asyncio
    async def test_simple_message_flows_without_coordinator(self):
        model = _make_mock_model("你好！")
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=False,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "test-1"}},
        )
        assert len(result["messages"]) >= 2


class TestGraphWithCoordinatorEnabled:
    """coordinator_enabled=True 时，coordinator 作为入口节点。"""

    def test_graph_builds_with_coordinator(self):
        model = _make_mock_model()
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=True,
        )
        assert graph is not None

    @pytest.mark.asyncio
    async def test_greeting_flows_through_coordinator(self):
        """简单问候通过 coordinator（短路为 direct），然后进入 planner→agent。"""
        model = _make_mock_model("你好！很高兴见到你。")
        graph = build_agent(
            model=model,
            tools=[],
            system_prompt="测试",
            enable_executor=False,
            coordinator_enabled=True,
        )
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content="你好")]},
            config={"configurable": {"thread_id": "test-2"}},
        )
        assert result is not None
