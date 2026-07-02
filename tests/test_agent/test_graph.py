"""Tests for agent/graph.py planner interaction helpers."""

import asyncio

import pytest

from agent.graph import _request_plan_confirmation


class _FakeInteraction:
    def __init__(self):
        self._pending = {}
        self.cleaned: list[str] = []
        self._counter = 0

    def register(self):
        self._counter += 1
        interaction_id = f"interaction-{self._counter}"
        future = asyncio.Future()
        self._pending[interaction_id] = future
        return interaction_id, future

    def cleanup(self, interaction_id: str):
        self.cleaned.append(interaction_id)
        self._pending.pop(interaction_id, None)


class _FailingWebSocket:
    async def send_json(self, payload):
        raise RuntimeError("socket closed")


class _ResolvingWebSocket:
    def __init__(self, interaction: _FakeInteraction, response: str):
        self.interaction = interaction
        self.response = response
        self.payloads = []

    async def send_json(self, payload):
        self.payloads.append(payload)
        plan_id = payload["payload"]["plan_id"]
        self.interaction._pending[plan_id].set_result(self.response)


@pytest.mark.asyncio
async def test_request_plan_confirmation_cleans_pending_when_send_fails():
    interaction = _FakeInteraction()

    response = await _request_plan_confirmation(
        ws=_FailingWebSocket(),
        interaction=interaction,
        plan_id="plan-1",
        steps=["step"],
        plan="do it",
        timeout=0.01,
    )

    assert response is None
    assert interaction._pending == {}
    assert "plan-1" in interaction.cleaned
    assert "interaction-1" in interaction.cleaned


@pytest.mark.asyncio
async def test_request_plan_confirmation_returns_response_and_cleans_pending():
    interaction = _FakeInteraction()
    ws = _ResolvingWebSocket(interaction, "approve")

    response = await _request_plan_confirmation(
        ws=ws,
        interaction=interaction,
        plan_id="plan-2",
        steps=["step"],
        plan="do it",
        timeout=0.01,
    )

    assert response == "approve"
    assert ws.payloads[0]["type"] == "plan_proposed"
    assert interaction._pending == {}
