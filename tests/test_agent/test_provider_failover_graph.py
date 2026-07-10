"""Provider failover integration tests for the agent model node.

The tests intentionally exercise the compiled graph so the safety boundary is
verified where it matters: no model replay after a tool result exists.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

from agent.graph import build_agent
from api.providers import Provider, ProviderConfig
from api.providers.manager import ProviderManager


class _Store:
    def load_all(self):
        return []


class _Provider(Provider):
    def __init__(self, config: ProviderConfig, llm):
        super().__init__(config)
        self._llm = llm

    def create_llm(self, model: str, **kwargs):
        assert model == self.default_model
        return self._llm

    async def check_health(self):  # pragma: no cover - not used by this graph test
        raise AssertionError("health checks are outside this test")


def _config(provider_id: str, priority: int) -> ProviderConfig:
    return ProviderConfig(
        id=provider_id,
        provider_type="openai",
        label=provider_id,
        api_key="test-key",
        base_url=f"https://{provider_id}.example.test/v1",
        models=[f"{provider_id}-model"],
        priority=priority,
    )


def _model(model_name: str, responses) -> MagicMock:
    llm = MagicMock()
    llm.model_name = model_name
    llm.bind_tools = MagicMock(return_value=llm)
    if isinstance(responses, BaseException) or isinstance(responses, list):
        llm.ainvoke = AsyncMock(side_effect=responses)
    else:
        llm.ainvoke = AsyncMock(return_value=responses)
    return llm


def _manager(primary_llm, fallback_llm) -> ProviderManager:
    manager = ProviderManager(_Store())
    primary = _Provider(_config("primary", 0), primary_llm)
    fallback = _Provider(_config("fallback", 10), fallback_llm)
    manager._providers = {"primary": primary, "fallback": fallback}
    return manager


def _ws_with_manager(manager: ProviderManager):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(provider_manager=manager)))


async def _run_graph(model, manager, *, tools=None):
    graph = build_agent(
        model=model,
        tools=tools or [],
        system_prompt="test",
        ws=_ws_with_manager(manager),
        enable_executor=False,
        verifier_enabled=False,
    )
    return await graph.ainvoke(
        {"messages": [HumanMessage(content="hello")]},
        config={"configurable": {"thread_id": "provider-failover-test"}},
    )


@pytest.mark.asyncio
async def test_retryable_model_error_fails_over_and_audits_actual_provider():
    primary_llm = _model("primary-model", httpx.ConnectError("upstream unavailable"))
    fallback_llm = _model("fallback-model", AIMessage(content="fallback answer"))
    manager = _manager(primary_llm, fallback_llm)

    result = await _run_graph(primary_llm, manager)

    assert result["messages"][-1].content == "fallback answer"
    assert primary_llm.ainvoke.await_count == 1
    assert fallback_llm.ainvoke.await_count == 1
    assert manager.get("primary").is_unhealthy is True
    assert manager.get("fallback").is_healthy is True
    assert result["llm_provider_id"] == "fallback"
    assert result["llm_model_name"] == "fallback-model"
    assert result["llm_failover_trace"] == [
        {
            "provider_id": "primary",
            "model_name": "primary-model",
            "outcome": "retryable_error",
            "error_type": "ConnectError",
        },
        {
            "provider_id": "fallback",
            "model_name": "fallback-model",
            "outcome": "success",
        },
    ]


@pytest.mark.asyncio
async def test_non_retryable_error_does_not_hide_programming_failure_with_fallback():
    primary_llm = _model("primary-model", ValueError("invalid request"))
    fallback_llm = _model("fallback-model", AIMessage(content="must not run"))
    manager = _manager(primary_llm, fallback_llm)

    result = await _run_graph(primary_llm, manager)

    assert "ValueError" in result["messages"][-1].content
    assert fallback_llm.ainvoke.await_count == 0
    assert manager.get("primary").health_status is None
    assert result["llm_failover_trace"][-1]["outcome"] == "error"


@pytest.mark.asyncio
async def test_does_not_fail_over_after_tool_result_to_avoid_replaying_side_effects():
    @tool
    def write_marker(value: str) -> str:
        """Simulate a side-effecting tool."""
        return f"wrote {value}"

    primary_llm = _model(
        "primary-model",
        [
            AIMessage(
                content="",
                tool_calls=[{"name": "write_marker", "args": {"value": "x"}, "id": "call-1"}],
            ),
            httpx.ConnectError("upstream unavailable"),
        ],
    )
    fallback_llm = _model("fallback-model", AIMessage(content="must not run"))
    manager = _manager(primary_llm, fallback_llm)

    result = await _run_graph(primary_llm, manager, tools=[write_marker])

    assert primary_llm.ainvoke.await_count == 2
    assert fallback_llm.ainvoke.await_count == 0
    assert manager.get("primary").is_unhealthy is True
    assert "ConnectError" in result["messages"][-1].content
    assert result["llm_failover_trace"][-1]["outcome"] == "retryable_error"


@pytest.mark.asyncio
async def test_fallback_provider_remains_selected_after_its_tool_call():
    @tool
    def write_marker(value: str) -> str:
        """Simulate a side-effecting tool."""
        return f"wrote {value}"

    primary_llm = _model("primary-model", httpx.ConnectError("upstream unavailable"))
    fallback_llm = _model(
        "fallback-model",
        [
            AIMessage(
                content="",
                tool_calls=[{"name": "write_marker", "args": {"value": "x"}, "id": "call-1"}],
            ),
            AIMessage(content="fallback final answer"),
        ],
    )
    manager = _manager(primary_llm, fallback_llm)

    result = await _run_graph(primary_llm, manager, tools=[write_marker])

    assert result["messages"][-1].content == "fallback final answer"
    assert primary_llm.ainvoke.await_count == 1
    assert fallback_llm.ainvoke.await_count == 2
    assert result["llm_provider_id"] == "fallback"
    assert result["llm_selected_provider_id"] == "fallback"


@pytest.mark.asyncio
async def test_selected_provider_does_not_leak_into_the_next_user_turn():
    primary_llm = _model(
        "primary-model",
        [
            httpx.ConnectError("upstream unavailable"),
            AIMessage(content="primary fresh-turn answer"),
        ],
    )
    fallback_llm = _model("fallback-model", AIMessage(content="fallback first-turn answer"))
    manager = _manager(primary_llm, fallback_llm)
    graph = build_agent(
        model=primary_llm,
        tools=[],
        system_prompt="test",
        ws=_ws_with_manager(manager),
        enable_executor=False,
        verifier_enabled=False,
    )
    config = {"configurable": {"thread_id": "provider-selection-reset-test"}}

    await graph.ainvoke({"messages": [HumanMessage(content="first")]}, config=config)
    manager.mark_healthy("primary")
    result = await graph.ainvoke({"messages": [HumanMessage(content="second")]}, config=config)

    assert result["messages"][-1].content == "primary fresh-turn answer"
    assert primary_llm.ainvoke.await_count == 2
    assert fallback_llm.ainvoke.await_count == 1
    assert result["llm_selected_provider_id"] == "primary"
