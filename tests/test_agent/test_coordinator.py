"""Coordinator 路由决策单元测试 — agent/coordinator.py。

测试策略：
- mock BaseChatModel，不依赖真实 LLM
- 覆盖三种路由：direct / specialist / main
- 覆盖 JSON 解析失败回退
- 覆盖 planner-skip 短路输入
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from agent.coordinator import (
    RoutingDecision,
    RouteTarget,
    classify_intent,
    _should_skip_coordinator,
)


class TestRoutingDecision:
    def test_direct_route(self):
        d = RoutingDecision(target=RouteTarget.DIRECT, rationale="简单问候")
        assert d.target == RouteTarget.DIRECT
        assert d.specialist is None
        assert d.rationale == "简单问候"

    def test_specialist_route(self):
        d = RoutingDecision(
            target=RouteTarget.SPECIALIST,
            specialist="research",
            rationale="需要深度研究",
        )
        assert d.target == RouteTarget.SPECIALIST
        assert d.specialist == "research"

    def test_main_route(self):
        d = RoutingDecision(target=RouteTarget.MAIN, rationale="通用任务")
        assert d.target == RouteTarget.MAIN
        assert d.specialist is None


class TestShouldSkipCoordinator:
    def test_empty_message_skips(self):
        assert _should_skip_coordinator("") is True
        assert _should_skip_coordinator("   ") is True

    def test_simple_greeting_skips(self):
        assert _should_skip_coordinator("你好") is True
        assert _should_skip_coordinator("hi") is True
        assert _should_skip_coordinator("谢谢") is True

    def test_complex_request_does_not_skip(self):
        assert _should_skip_coordinator("帮我研究一下 LangGraph 的最新特性并写一份报告") is False
        assert _should_skip_coordinator("分析这个项目的架构问题") is False


class TestClassifyIntent:
    """classify_intent 的 LLM 调用测试（mock model）。"""

    @pytest.mark.asyncio
    async def test_direct_route_from_llm_json(self):
        """LLM 返回 direct 路由的 JSON，正确解析。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"target":"direct","rationale":"简单问候"}')
        )
        decision = await classify_intent(mock_model, "你好呀")
        assert decision.target == RouteTarget.DIRECT
        assert decision.specialist is None

    @pytest.mark.asyncio
    async def test_specialist_route_from_llm_json(self):
        """LLM 返回 specialist 路由的 JSON，正确解析 specialist 字段。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(
                content='{"target":"specialist","specialist":"research","rationale":"需要深度研究"}'
            )
        )
        decision = await classify_intent(mock_model, "帮我深度研究 LangGraph")
        assert decision.target == RouteTarget.SPECIALIST
        assert decision.specialist == "research"

    @pytest.mark.asyncio
    async def test_main_route_from_llm_json(self):
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content='{"target":"main","rationale":"通用任务"}')
        )
        decision = await classify_intent(mock_model, "读一下这个文件")
        assert decision.target == RouteTarget.MAIN

    @pytest.mark.asyncio
    async def test_invalid_json_falls_back_to_main(self):
        """LLM 返回非法 JSON 时，安全回退到 MAIN（不阻塞主流程）。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(
            return_value=AIMessage(content="抱歉，我不太理解。")
        )
        decision = await classify_intent(mock_model, "复杂的请求")
        assert decision.target == RouteTarget.MAIN
        assert "fallback" in decision.rationale.lower() or "回退" in decision.rationale

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_main(self):
        """LLM 调用异常时，安全回退到 MAIN。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock(side_effect=RuntimeError("API 超时"))
        decision = await classify_intent(mock_model, "任何请求")
        assert decision.target == RouteTarget.MAIN

    @pytest.mark.asyncio
    async def test_skip_input_returns_direct_without_llm_call(self):
        """简单输入短路，不调用 LLM。"""
        mock_model = MagicMock(spec=BaseChatModel)
        mock_model.ainvoke = AsyncMock()
        decision = await classify_intent(mock_model, "你好")
        assert decision.target == RouteTarget.DIRECT
        mock_model.ainvoke.assert_not_called()
