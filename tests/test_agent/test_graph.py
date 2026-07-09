"""Tests for agent/graph.py planner interaction helpers + executor HITL 链路。"""

import asyncio
import json

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END

from agent.executor import (
    detect_tool_failure,
    find_last_system_message_index,
    make_executor_node,
    make_executor_router,
    request_plan_confirmation,
    StepStateMachine,
)
from agent.graph import _request_plan_confirmation
from agent.step_state import ExecutionPlan, PlanStep, StepStatus


# ── 既有：_request_plan_confirmation 单测 ──────────────────────


class _FakeInteraction:
    def __init__(self):
        self._pending = {}
        self.cleaned: list[str] = []

    async def register(self, interaction_id: str | None = None):
        if interaction_id is None:
            interaction_id = "interaction-1"
        future = asyncio.Future()
        self._pending[interaction_id] = future
        return interaction_id, future

    async def resolve(self, interaction_id: str, response) -> bool:
        future = self._pending.get(interaction_id)
        if future and not future.done():
            future.set_result(response)
            return True
        return False

    async def cleanup(self, interaction_id: str):
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


# ── 阶段 2.4：executor 状态机 HITL 链路测试 ─────────────────────


class _CapturingWebSocket:
    """捕获所有推送事件的 WebSocket mock。"""

    def __init__(self):
        self.payloads: list[dict] = []

    async def send_json(self, payload):
        self.payloads.append(payload)


class _AutoApproveInteraction(_FakeInteraction):
    """支持 auto_approve 场景的 interaction mock。"""

    pass


def _make_plan(steps_data: list[dict], raw_text: str = "") -> ExecutionPlan:
    """构造 ExecutionPlan 测试辅助。"""
    return ExecutionPlan(
        steps=[PlanStep.from_dict(d) for d in steps_data],
        raw_text=raw_text,
    )


def _make_state(
    plan_steps: list[dict] | None = None,
    current_step_index: int = 0,
    step_status: dict | None = None,
    failure_count: int = 0,
    replan_count: int = 0,
    plan_confirmed: bool = False,
    messages: list | None = None,
    plan_text: str = "",
) -> dict:
    """构造 executor_node 输入 state。"""
    return {
        "plan_steps": plan_steps or [],
        "current_step_index": current_step_index,
        "step_status": step_status or {},
        "failure_count": failure_count,
        "replan_count": replan_count,
        "plan_confirmed": plan_confirmed,
        "plan_text": plan_text,
        "messages": messages or [],
    }


# ── StepStateMachine 单测 ──


class TestStepStateMachine:
    """StepStateMachine 状态机逻辑测试。"""

    def test_initial_state_is_pending(self):
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ])
        sm = StepStateMachine(plan)
        assert sm.current_index == 0
        assert not sm.is_complete
        assert sm.get_status(0) == StepStatus.PENDING

    def test_advance_moves_to_next_step(self):
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ])
        sm = StepStateMachine(plan)
        sm.mark_done()
        sm.advance()
        assert sm.current_index == 1

    def test_is_complete_when_all_steps_done(self):
        plan = _make_plan([{"description": "step1", "index": 0}])
        sm = StepStateMachine(plan)
        sm.mark_done()
        sm.advance()
        assert sm.is_complete

    def test_mark_failed_increments_failure_count(self):
        plan = _make_plan([{"description": "step1", "index": 0}])
        sm = StepStateMachine(plan)
        sm.mark_failed("network error")
        assert sm.failure_count == 1
        assert sm.last_failed_step == "step1"
        assert sm.get_status(0) == StepStatus.FAILED

    def test_should_replan_at_threshold(self):
        plan = _make_plan([{"description": "step1", "index": 0}])
        sm = StepStateMachine(plan)
        sm.mark_failed("err1")
        assert not sm.should_replan(threshold=2)
        sm.failure_count = 2
        assert sm.should_replan(threshold=2)

    def test_get_completed_steps(self):
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
            {"description": "step3", "index": 2},
        ])
        sm = StepStateMachine(plan)
        sm.mark_done()
        sm.advance()
        sm.mark_failed()
        completed = sm.get_completed_steps()
        assert len(completed) == 1
        assert completed[0].description == "step1"


# ── detect_tool_failure 单测 ──


class TestDetectToolFailure:
    """工具失败检测测试。"""

    def test_no_failure_when_no_tool_messages(self):
        messages = [HumanMessage(content="hi"), AIMessage(content="hello")]
        has_failure, error, tool_name = detect_tool_failure(messages)
        assert not has_failure
        assert error == ""
        assert tool_name == ""

    def test_detects_format_error_failure(self):
        messages = [
            HumanMessage(content="do something"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "工具执行失败"}),
                tool_call_id="call-1",
                name="file_read",
            ),
        ]
        has_failure, error, tool_name = detect_tool_failure(messages)
        assert has_failure
        assert "工具执行失败" in error
        assert tool_name == "file_read"

    def test_detects_compact_json_failure(self):
        messages = [
            ToolMessage(
                content='{"success":false,"error":"权限不足"}',
                tool_call_id="call-1",
                name="browser_browse",
            ),
        ]
        has_failure, error, tool_name = detect_tool_failure(messages)
        assert has_failure
        assert "权限不足" in error
        assert tool_name == "browser_browse"

    def test_ignores_successful_tool_messages(self):
        messages = [
            ToolMessage(
                content=json.dumps({"success": True, "data": "ok"}),
                tool_call_id="call-1",
                name="file_read",
            ),
        ]
        has_failure, error, tool_name = detect_tool_failure(messages)
        assert not has_failure
        assert tool_name == ""

    def test_respects_since_index(self):
        messages = [
            ToolMessage(
                content=json.dumps({"success": False, "error": "old error"}),
                tool_call_id="call-1",
                name="file_read",
            ),
            ToolMessage(
                content=json.dumps({"success": True}),
                tool_call_id="call-2",
                name="file_read",
            ),
        ]
        # 从索引 1 开始检查，应该没有失败
        has_failure, _, _ = detect_tool_failure(messages, since_index=1)
        assert not has_failure
        # 从头检查，应该有失败
        has_failure, _, tool_name = detect_tool_failure(messages, since_index=0)
        assert has_failure
        assert tool_name == "file_read"


# ── find_last_system_message_index 单测 ──


class TestFindLastSystemMessage:
    """executor 注入步骤消息定位测试。"""

    def test_returns_neg1_when_no_step_message(self):
        messages = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert find_last_system_message_index(messages) == -1

    def test_finds_last_step_message(self):
        messages = [
            SystemMessage(content="[当前步骤 1/3]\n第一步"),
            AIMessage(content="ok"),
            SystemMessage(content="[当前步骤 2/3]\n第二步"),
        ]
        idx = find_last_system_message_index(messages)
        assert idx == 2

    def test_ignores_non_step_system_messages(self):
        messages = [
            SystemMessage(content="系统提示词"),
            SystemMessage(content="[当前步骤 1/2]\n第一步"),
        ]
        idx = find_last_system_message_index(messages)
        assert idx == 1


# ── executor_node HITL 链路测试 ──


@pytest.mark.asyncio
async def test_executor_node_no_plan_passes_through():
    """无计划时 executor 直接返回空 dict（透传到 agent）。"""
    executor = make_executor_node(
        ws=None,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
    )
    state = _make_state(plan_steps=[])
    result = await executor(state)
    assert result == {}


@pytest.mark.asyncio
async def test_executor_node_skip_hitl_when_ws_is_none():
    """无 ws 时跳过 HITL，直接标记 confirmed 并注入第一步。"""
    executor = make_executor_node(
        ws=None,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=True,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
        {"description": "step3", "index": 2},
    ]
    state = _make_state(plan_steps=plan_steps, plan_text="1. step1\n2. step2\n3. step3")
    result = await executor(state)

    # 应该标记为已确认，且注入第一步
    assert result.get("plan_confirmed") is True
    assert "messages" in result
    assert len(result["messages"]) == 1
    assert isinstance(result["messages"][0], SystemMessage)
    assert "[当前步骤 1/3]" in result["messages"][0].content
    # step_status 应该将第 0 步标记为 RUNNING
    assert result.get("step_status", {}).get("0") == StepStatus.RUNNING.value


@pytest.mark.asyncio
async def test_executor_node_hitl_with_auto_approve_skips_confirmation():
    """auto_approve=True 时跳过 HITL 等待，直接执行。"""
    from api.interaction import set_session_auto_approve, current_session_id

    ws = _CapturingWebSocket()
    interaction = _FakeInteraction()

    # 设置 auto_approve
    session_id = "test-session-auto"
    set_session_auto_approve(session_id, True)
    token = current_session_id.set(session_id)

    try:
        executor = make_executor_node(
            ws=ws,
            interaction_module=interaction,
            system_prompt="sys",
            enable_hitl=True,
            plan_confirm_timeout=0.5,
        )
        plan_steps = [
            {"description": f"step{i}", "index": i} for i in range(4)
        ]
        state = _make_state(plan_steps=plan_steps, plan_text="plan")
        result = await executor(state)

        # 不应该推送 plan_proposed 事件
        plan_proposed_events = [p for p in ws.payloads if p.get("type") == "plan_proposed"]
        assert len(plan_proposed_events) == 0
        # 应该直接进入执行
        assert result.get("plan_confirmed") is True
        assert "messages" in result
    finally:
        current_session_id.reset(token)
        set_session_auto_approve(session_id, False)


@pytest.mark.asyncio
async def test_executor_node_hitl_user_approves_plan():
    """HITL 链路：用户 approve 计划后，executor 注入第一步。"""
    ws = _CapturingWebSocket()
    interaction = _FakeInteraction()

    # 包装 send_json 使其在推送 plan_proposed 后立即 resolve
    async def _auto_approve_send(payload):
        ws.payloads.append(payload)
        if payload.get("type") == "plan_proposed":
            plan_id = payload["payload"]["plan_id"]
            # 模拟用户立即 approve
            await interaction.resolve(plan_id, "approve")

    ws.send_json = _auto_approve_send

    executor = make_executor_node(
        ws=ws,
        interaction_module=interaction,
        system_prompt="sys",
        enable_hitl=True,
        plan_confirm_timeout=1.0,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
        {"description": "step3", "index": 2},
    ]
    state = _make_state(plan_steps=plan_steps, plan_text="1. step1\n2. step2\n3. step3")
    result = await executor(state)

    # 应该推送 plan_proposed
    plan_proposed_events = [p for p in ws.payloads if p.get("type") == "plan_proposed"]
    assert len(plan_proposed_events) == 1
    # 应该注入第一步
    assert result.get("plan_confirmed") is True
    assert "[当前步骤 1/3]" in result["messages"][0].content
    # plan_proposed 应该已清理
    assert "plan-1" not in interaction._pending or True  # plan_id 是随机的


@pytest.mark.asyncio
async def test_executor_node_hitl_user_rejects_plan():
    """HITL 链路：用户 reject 计划后，executor 注入拒绝消息并结束。"""
    ws = _CapturingWebSocket()
    interaction = _FakeInteraction()

    async def _auto_reject_send(payload):
        ws.payloads.append(payload)
        if payload.get("type") == "plan_proposed":
            plan_id = payload["payload"]["plan_id"]
            await interaction.resolve(plan_id, "reject")

    ws.send_json = _auto_reject_send

    executor = make_executor_node(
        ws=ws,
        interaction_module=interaction,
        system_prompt="sys",
        enable_hitl=True,
        plan_confirm_timeout=1.0,
    )
    plan_steps = [
        {"description": f"step{i}", "index": i} for i in range(4)
    ]
    state = _make_state(plan_steps=plan_steps, plan_text="plan")
    result = await executor(state)

    # 应该注入拒绝消息
    assert result.get("plan_confirmed") is True
    assert "messages" in result
    assert "用户已拒绝" in result["messages"][0].content


@pytest.mark.asyncio
async def test_executor_node_hitl_user_modifies_plan():
    """HITL 链路：用户 modify 计划后，executor 重新解析并注入新计划首步。"""
    ws = _CapturingWebSocket()
    interaction = _FakeInteraction()

    modified_plan = (
        "1. 修改后的第一步（建议工具：file_read）\n"
        "2. 修改后的第二步\n"
        "3. 修改后的第三步\n"
        "4. 修改后的第四步"
    )

    async def _auto_modify_send(payload):
        ws.payloads.append(payload)
        if payload.get("type") == "plan_proposed":
            plan_id = payload["payload"]["plan_id"]
            await interaction.resolve(plan_id, modified_plan)

    ws.send_json = _auto_modify_send

    executor = make_executor_node(
        ws=ws,
        interaction_module=interaction,
        system_prompt="sys",
        enable_hitl=True,
        plan_confirm_timeout=1.0,
    )
    # 原计划 5 步
    plan_steps = [
        {"description": f"orig-step{i}", "index": i} for i in range(5)
    ]
    state = _make_state(plan_steps=plan_steps, plan_text="original plan")
    result = await executor(state)

    # plan_steps 应该被替换为修改后的计划
    new_steps = result.get("plan_steps", [])
    assert len(new_steps) == 4
    assert "修改后的第一步" in new_steps[0]["description"]
    # 工具提示应该被提取
    assert new_steps[0]["tool_hint"] == "file_read"
    # 应该注入第一步
    assert "[当前步骤 1/4]" in result["messages"][0].content


@pytest.mark.asyncio
async def test_executor_node_hitl_timeout_proceeds_with_original_plan():
    """HITL 超时后按原计划继续执行。"""
    ws = _CapturingWebSocket()
    interaction = _FakeInteraction()

    # 不 resolve，让 future 超时
    async def _no_resolve_send(payload):
        ws.payloads.append(payload)

    ws.send_json = _no_resolve_send

    executor = make_executor_node(
        ws=ws,
        interaction_module=interaction,
        system_prompt="sys",
        enable_hitl=True,
        plan_confirm_timeout=0.05,  # 极短超时
    )
    plan_steps = [
        {"description": f"step{i}", "index": i} for i in range(3)
    ]
    state = _make_state(plan_steps=plan_steps, plan_text="plan")
    result = await executor(state)

    # 超时后应该按原计划继续
    assert result.get("plan_confirmed") is True
    assert "[当前步骤 1/3]" in result["messages"][0].content


# ── executor_node 步骤推进测试 ──


@pytest.mark.asyncio
async def test_executor_node_advances_step_on_success():
    """步骤成功完成后推进下一步。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    # 第 0 步已 RUNNING，agent 已返回（无 tool_calls，无失败）
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            AIMessage(content="step1 done"),
        ],
    )
    result = await executor(state)

    # 应该推送 plan_step_end 事件
    step_end_events = [p for p in ws.payloads if p.get("type") == "plan_step_end"]
    assert len(step_end_events) == 1
    # 应该推进到第 1 步
    assert result.get("current_step_index") == 1
    # 第 0 步标记为 DONE
    assert result.get("step_status", {}).get("0") == StepStatus.DONE.value
    # 注入第 1 步
    assert "[当前步骤 2/2]" in result["messages"][0].content


@pytest.mark.asyncio
async def test_executor_node_completes_after_all_steps():
    """全部步骤完成后推送 plan_completed 事件。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=2,  # 已超过最后一步
        step_status={"0": StepStatus.DONE.value, "1": StepStatus.DONE.value},
        plan_confirmed=True,
        messages=[],
    )
    result = await executor(state)

    # 应该推送 plan_completed
    completed_events = [p for p in ws.payloads if p.get("type") == "plan_completed"]
    assert len(completed_events) == 1
    assert completed_events[0]["payload"]["summary"]["is_complete"] is True
    # 应该返回空 dict（无更多更新）
    assert result == {}


# ── executor_node 失败重规划测试 ──


@pytest.mark.asyncio
async def test_executor_node_failure_triggers_replan_at_threshold():
    """步骤失败达阈值时触发重规划，注入 [重规划请求] 消息。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    # 第 0 步 RUNNING，已有 1 次失败，现在又失败 → 触发 replan
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=1,  # 已有 1 次，再加 1 次达阈值 2
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "工具失败"}),
                tool_call_id="call-1",
            ),
        ],
    )
    result = await executor(state)

    # 应该推送 plan_step_error 事件，标记 replanning
    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 1
    assert error_events[0]["payload"]["replanning"] is True

    # 应该注入 [重规划请求] SystemMessage
    messages = result.get("messages", [])
    assert len(messages) == 1
    assert "[重规划请求]" in messages[0].content
    # 失败计数累加
    assert result.get("failure_count") == 2
    # replan_count 累加
    assert result.get("replan_count") == 1
    # 重置步骤指针
    assert result.get("current_step_index") == 0
    assert result.get("plan_confirmed") is False


@pytest.mark.asyncio
async def test_executor_node_failure_below_threshold_skips_step():
    """失败未达阈值时跳过该步骤，不触发重规划。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=3,  # 阈值较高
        max_replans=2,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=0,
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "首次失败"}),
                tool_call_id="call-1",
            ),
        ],
    )
    result = await executor(state)

    # 应该推送 plan_step_error，但不 replanning
    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 1
    assert error_events[0]["payload"]["replanning"] is False
    assert error_events[0]["payload"]["skipped"] is True

    # 应该跳过该步骤，推进到下一步
    assert result.get("current_step_index") == 1
    # 步骤 0 标记为 SKIPPED，步骤 1 标记为 RUNNING
    assert result.get("step_status", {}).get("0") == StepStatus.SKIPPED.value
    assert result.get("step_status", {}).get("1") == StepStatus.RUNNING.value
    # 注入跳过消息 + 下一步消息
    messages = result.get("messages", [])
    assert len(messages) == 2
    assert "步骤跳过" in messages[0].content
    assert "[当前步骤 2/2]" in messages[1].content


@pytest.mark.asyncio
async def test_executor_node_no_replan_after_max_replans_exhausted():
    """达到 max_replans 后不再触发重规划，直接跳过失败步骤。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=1,
        max_replans=2,  # 已用完
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=1,  # 达阈值
        replan_count=2,  # 但重规划次数用完
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "再次失败"}),
                tool_call_id="call-1",
            ),
        ],
    )
    result = await executor(state)

    # 不应该触发重规划，而是跳过
    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 1
    assert error_events[0]["payload"]["replanning"] is False
    assert error_events[0]["payload"]["skipped"] is True
    # 推进到下一步
    assert result.get("current_step_index") == 1


# ── executor_router 路由测试 ──


class TestExecutorRouter:
    """executor 路由函数测试。"""

    def test_no_plan_routes_to_agent(self):
        router = make_executor_router()
        state = _make_state(plan_steps=[])
        assert router(state) == "agent"

    def test_complete_routes_to_end(self):
        router = make_executor_router()
        plan_steps = [{"description": "step1", "index": 0}]
        state = _make_state(plan_steps=plan_steps, current_step_index=1)
        assert router(state) == END

    def test_replan_request_routes_to_planner(self):
        router = make_executor_router()
        plan_steps = [
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ]
        state = _make_state(
            plan_steps=plan_steps,
            current_step_index=0,
            messages=[SystemMessage(content="[重规划请求]\n失败上下文")],
        )
        assert router(state) == "planner"

    def test_normal_step_routes_to_agent(self):
        router = make_executor_router()
        plan_steps = [
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ]
        state = _make_state(
            plan_steps=plan_steps,
            current_step_index=0,
            messages=[AIMessage(content="working")],
        )
        assert router(state) == "agent"


# ── parse_plan_to_steps 单测（验证 HITL 链路依赖的结构化解析）──


class TestParsePlanToSteps:
    """结构化计划解析测试，验证 executor 消费的步骤格式。"""

    def test_parses_numbered_steps(self):
        from agent.planner import parse_plan_to_steps
        plan = "1. 第一步\n2. 第二步\n3. 第三步"
        steps = parse_plan_to_steps(plan)
        assert len(steps) == 3
        assert steps[0].description == "第一步"
        assert steps[0].index == 0
        assert steps[2].index == 2

    def test_extracts_parallel_groups(self):
        from agent.planner import parse_plan_to_steps
        plan = (
            "1. [并行] 搜索 Python 新特性\n"
            "2. [并行] 分析项目架构\n"
            "3. 汇总结果"
        )
        steps = parse_plan_to_steps(plan)
        assert len(steps) == 3
        assert steps[0].is_parallel
        assert steps[1].is_parallel
        assert steps[0].parallel_group == steps[1].parallel_group
        assert not steps[2].is_parallel

    def test_extracts_tool_hint(self):
        from agent.planner import parse_plan_to_steps
        plan = "1. 读取配置文件（建议工具：file_read）"
        steps = parse_plan_to_steps(plan)
        assert len(steps) == 1
        assert steps[0].tool_hint == "file_read"
        assert "建议工具" not in steps[0].description

    def test_empty_plan_returns_empty_list(self):
        from agent.planner import parse_plan_to_steps
        assert parse_plan_to_steps("") == []
        assert parse_plan_to_steps(None) == []


# ── ExecutionPlan 并行组测试 ──


class TestExecutionPlanParallelGroups:
    """ExecutionPlan 并行组识别测试。"""

    def test_has_parallel_detection(self):
        plan = _make_plan([
            {"description": "s1", "parallel_group": 1, "index": 0},
            {"description": "s2", "parallel_group": 1, "index": 1},
            {"description": "s3", "parallel_group": 0, "index": 2},
        ])
        assert plan.has_parallel

    def test_no_parallel_when_all_zero(self):
        plan = _make_plan([
            {"description": "s1", "parallel_group": 0, "index": 0},
            {"description": "s2", "parallel_group": 0, "index": 1},
        ])
        assert not plan.has_parallel

    def test_get_parallel_groups(self):
        plan = _make_plan([
            {"description": "s1", "parallel_group": 1, "index": 0},
            {"description": "s2", "parallel_group": 1, "index": 1},
            {"description": "s3", "parallel_group": 2, "index": 2},
            {"description": "s4", "parallel_group": 2, "index": 3},
            {"description": "s5", "parallel_group": 0, "index": 4},
        ])
        groups = plan.get_parallel_groups()
        assert len(groups) == 2
        assert len(groups[0]) == 2  # group 1
        assert len(groups[1]) == 2  # group 2
        # 非并行步骤不在任何组中
        for step in groups[0] + groups[1]:
            assert step.is_parallel


# ── Task 2.2：executor 并行组执行测试 ──


@pytest.mark.asyncio
async def test_executor_injects_parallel_suggestion_for_parallel_group():
    """当当前步骤属于并行组时，executor 注入 parallel_execute 建议而非单步上下文。"""
    from agent.executor import _inject_parallel_step, _get_parallel_group_steps

    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
    )
    # 步骤 0、1 属于并行组 1，步骤 2 是非并行
    plan_steps = [
        {"description": "并行搜索A", "parallel_group": 1, "index": 0},
        {"description": "并行搜索B", "parallel_group": 1, "index": 1},
        {"description": "汇总结果", "parallel_group": 0, "index": 2},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        plan_confirmed=True,
        plan_text="1. [并行] 并行搜索A\n2. [并行] 并行搜索B\n3. 汇总结果",
    )
    result = await executor(state)

    # 应该注入并行执行建议消息
    messages = result.get("messages", [])
    assert len(messages) == 1
    assert "[并行执行建议]" in messages[0].content
    # 消息应包含 tasks JSON
    assert "parallel_execute" in messages[0].content
    assert "并行搜索A" in messages[0].content
    assert "并行搜索B" in messages[0].content
    # 步骤 0 和 1 都标记为 RUNNING
    step_status = result.get("step_status", {})
    assert step_status.get("0") == StepStatus.RUNNING.value
    assert step_status.get("1") == StepStatus.RUNNING.value


@pytest.mark.asyncio
async def test_executor_parallel_group_completes_all_steps_on_success():
    """并行组成功时，同组所有步骤一起标记 DONE，跳过到组后下一步。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
    )
    plan_steps = [
        {"description": "并行搜索A", "parallel_group": 1, "index": 0},
        {"description": "并行搜索B", "parallel_group": 1, "index": 1},
        {"description": "汇总结果", "parallel_group": 0, "index": 2},
    ]
    # 步骤 0、1 已 RUNNING，agent 已返回（无 tool_calls，无失败）
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value, "1": StepStatus.RUNNING.value},
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[并行执行建议] ..."),
            AIMessage(content="并行执行完成"),
        ],
    )
    result = await executor(state)

    # 步骤 0 和 1 都应标记为 DONE
    step_status = result.get("step_status", {})
    assert step_status.get("0") == StepStatus.DONE.value
    assert step_status.get("1") == StepStatus.DONE.value
    # 应该推进到步骤 2（组后下一步）
    assert result.get("current_step_index") == 2
    # 应该推送 2 个 plan_step_end 事件（步骤 0 和 1）
    step_end_events = [p for p in ws.payloads if p.get("type") == "plan_step_end"]
    assert len(step_end_events) == 2
    # 注入下一步（步骤 2，非并行）
    assert "[当前步骤 3/3]" in result["messages"][0].content


@pytest.mark.asyncio
async def test_executor_parallel_group_failure_skips_all_group_steps():
    """并行组失败时，同组所有步骤一起标记 SKIPPED，跳过到组后下一步。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=3,  # 高阈值，不触发 replan
    )
    plan_steps = [
        {"description": "并行搜索A", "parallel_group": 1, "index": 0},
        {"description": "并行搜索B", "parallel_group": 1, "index": 1},
        {"description": "汇总结果", "parallel_group": 0, "index": 2},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value, "1": StepStatus.RUNNING.value},
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[并行执行建议] ..."),
            ToolMessage(
                content=json.dumps({"success": False, "error": "并行执行失败"}),
                tool_call_id="call-1",
            ),
        ],
    )
    result = await executor(state)

    # 步骤 0 和 1 都应标记为 SKIPPED
    step_status = result.get("step_status", {})
    assert step_status.get("0") == StepStatus.SKIPPED.value
    assert step_status.get("1") == StepStatus.SKIPPED.value
    # 应该推进到步骤 2（组后下一步）
    assert result.get("current_step_index") == 2
    # 应该推送 2 个 plan_step_error 事件（步骤 0 和 1）
    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 2


@pytest.mark.asyncio
async def test_executor_parallel_group_replan_marks_all_failed():
    """并行组失败达阈值时，同组所有步骤一起标记 FAILED，触发 replan。"""
    ws = _CapturingWebSocket()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=1,
        max_replans=2,
    )
    plan_steps = [
        {"description": "并行搜索A", "parallel_group": 1, "index": 0},
        {"description": "并行搜索B", "parallel_group": 1, "index": 1},
        {"description": "汇总结果", "parallel_group": 0, "index": 2},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value, "1": StepStatus.RUNNING.value},
        failure_count=0,
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[并行执行建议] ..."),
            ToolMessage(
                content=json.dumps({"success": False, "error": "失败"}),
                tool_call_id="call-1",
            ),
        ],
    )
    result = await executor(state)

    # 步骤 0 和 1 都应标记为 FAILED
    step_status = result.get("step_status", {})
    assert step_status.get("0") == StepStatus.FAILED.value
    assert step_status.get("1") == StepStatus.FAILED.value
    # 应该注入 [重规划请求]
    assert "[重规划请求]" in result["messages"][0].content
    # replan_count 累加
    assert result.get("replan_count") == 1


def test_get_parallel_group_steps_returns_all_group_members():
    """_get_parallel_group_steps 返回同组所有步骤。"""
    from agent.executor import _get_parallel_group_steps
    plan = _make_plan([
        {"description": "s1", "parallel_group": 1, "index": 0},
        {"description": "s2", "parallel_group": 1, "index": 1},
        {"description": "s3", "parallel_group": 2, "index": 2},
        {"description": "s4", "parallel_group": 0, "index": 3},
    ])
    # 步骤 0 属于组 1，应返回步骤 0 和 1
    group = _get_parallel_group_steps(plan, plan.steps[0])
    assert len(group) == 2
    assert {s.index for s in group} == {0, 1}
    # 步骤 2 属于组 2，应只返回步骤 2
    group = _get_parallel_group_steps(plan, plan.steps[2])
    assert len(group) == 1
    assert group[0].index == 2
    # 步骤 3 非并行，应只返回自己
    group = _get_parallel_group_steps(plan, plan.steps[3])
    assert len(group) == 1
    assert group[0].index == 3


def test_inject_parallel_step_constructs_valid_tasks_json():
    """_inject_parallel_step 构造的 tasks JSON 可被 parallel_execute 工具解析。"""
    from agent.executor import _inject_parallel_step
    plan = _make_plan([
        {"description": "搜索A", "parallel_group": 1, "index": 0},
        {"description": "搜索B", "parallel_group": 1, "index": 1},
    ])
    result = _inject_parallel_step(plan, plan.steps[0], {}, lambda _: None)

    # 从消息中提取 tasks JSON
    msg_content = result["messages"][0].content
    # 找到 JSON 数组
    import re
    json_match = re.search(r'\[\s*\{.*\}\s*\]', msg_content, re.DOTALL)
    assert json_match, "tasks JSON not found in message"
    tasks = json.loads(json_match.group())
    assert len(tasks) == 2
    assert tasks[0]["task"] == "搜索A"
    assert tasks[1]["task"] == "搜索B"
    # 所有步骤标记为 RUNNING
    assert result["step_status"]["0"] == StepStatus.RUNNING.value
    assert result["step_status"]["1"] == StepStatus.RUNNING.value


# ── Task 2.3：error_recovery 接入测试 ──


class TestErrorRecoveryIntegration:
    """ErrorRecoveryManager 接入 executor 的失败记录 + 重规划判断。"""

    def test_record_failure_returns_suggestion_at_threshold(self):
        """连续失败达阈值后返回 RecoverySuggestion。"""
        from agent.error_recovery import ErrorRecoveryManager, FAILURE_THRESHOLD
        mgr = ErrorRecoveryManager()
        # 第 1 次失败：未达阈值（FAILURE_THRESHOLD=2），返回 None
        s1 = mgr.record_failure("file_read", "errno 1")
        assert s1 is None
        # 第 2 次失败：达阈值，返回 suggestion
        s2 = mgr.record_failure("file_read", "errno 2")
        assert s2 is not None
        assert s2.tool_name == "file_read"
        assert s2.strategy in ("retry_different_params", "alternative_tool", "ask_user")

    def test_record_success_resets_consecutive_failures(self):
        """record_success 重置连续失败计数。"""
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        mgr.record_failure("file_read", "err1")
        mgr.record_failure("file_read", "err2")
        assert mgr.get_failure_count("file_read") == 2
        # 成功一次 → 重置
        mgr.record_success("file_read")
        assert mgr.get_failure_count("file_read") == 0
        # 再失败一次 → 重新计数为 1，不应触发 suggestion
        s = mgr.record_failure("file_read", "err3")
        assert s is None

    def test_should_replan_with_explicit_failure_count(self):
        """should_replan 优先使用显式 failure_count。"""
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        # 显式传入 failure_count=2，threshold=2 → True
        assert mgr.should_replan("file_read", failure_count=2, threshold=2) is True
        # 显式传入 failure_count=1，threshold=2 → False
        assert mgr.should_replan("file_read", failure_count=1, threshold=2) is False

    def test_should_replan_falls_back_to_internal_count(self):
        """未传 failure_count 时回退到工具的连续失败记录。"""
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        # 未记录失败 → False
        assert mgr.should_replan("file_read", threshold=2) is False
        # 记录 2 次失败 → True
        mgr.record_failure("file_read", "err1")
        mgr.record_failure("file_read", "err2")
        assert mgr.should_replan("file_read", threshold=2) is True

    def test_build_replan_trigger_carries_context(self):
        """build_replan_trigger 携带失败上下文 + 替代工具建议。"""
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        # 先 record_failure 触发 suggestion（写入 _recovery_history）
        mgr.record_failure("parallel_execute", "err1")
        mgr.record_failure("parallel_execute", "err2")
        # 构造 trigger
        trigger = mgr.build_replan_trigger(
            tool_name="parallel_execute",
            failed_step_description="并行搜索",
            error_message="子 Agent 超时",
            completed_steps="  1. 准备阶段",
        )
        assert trigger.tool_name == "parallel_execute"
        assert trigger.failed_step_description == "并行搜索"
        assert "超时" in trigger.error_message
        assert "准备阶段" in trigger.completed_steps
        # parallel_execute 的替代工具：call_sub_agent
        assert "call_sub_agent" in trigger.alternative_tools
        # suggestion_message 来自最近一次 RecoverySuggestion
        assert trigger.suggestion_message  # 非空

    def test_build_replan_trigger_without_prior_suggestion(self):
        """无 prior suggestion 时 suggestion_message 为空，但仍返回替代工具。"""
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()  # 全新实例，无历史
        trigger = mgr.build_replan_trigger(
            tool_name="file_read",
            failed_step_description="读取文件",
            error_message="not found",
            completed_steps="",
        )
        assert trigger.tool_name == "file_read"
        assert trigger.suggestion_message == ""
        assert "file_search" in trigger.alternative_tools


class TestSuggestAlternativesExpanded:
    """_suggest_alternatives 阶段 2.3 扩充覆盖并行/sub_agent 场景。"""

    def test_parallel_execute_suggests_call_sub_agent(self):
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        assert mgr._suggest_alternatives("parallel_execute") == ["call_sub_agent"]

    def test_call_sub_agent_has_no_alternatives(self):
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        assert mgr._suggest_alternatives("call_sub_agent") == []

    def test_file_read_suggests_file_search_and_run_python(self):
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        alts = mgr._suggest_alternatives("file_read")
        assert "file_search" in alts
        assert "run_python" in alts

    def test_unknown_tool_returns_empty(self):
        from agent.error_recovery import ErrorRecoveryManager
        mgr = ErrorRecoveryManager()
        assert mgr._suggest_alternatives("nonexistent_tool") == []


@pytest.mark.asyncio
async def test_executor_calls_record_failure_on_tool_failure():
    """executor 检测到工具失败时调用 recovery_manager.record_failure。"""
    from agent.error_recovery import ErrorRecoveryManager
    ws = _CapturingWebSocket()
    recovery = ErrorRecoveryManager()
    performance = _RecordingPerformanceMonitor()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
        recovery_manager=recovery,
        performance_monitor=performance,
    )
    plan_steps = [{"description": "step1", "index": 0}]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=0,
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/1]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "权限不足"}),
                tool_call_id="call-1",
                name="file_read",
            ),
        ],
    )
    await executor(state)

    # recovery_manager 应记录 file_read 的失败
    assert recovery.get_failure_count("file_read") == 1
    # performance_monitor 应记录一次失败工具调用
    assert len(performance.recorded_calls) == 1
    assert performance.recorded_calls[0]["tool_name"] == "file_read"
    assert performance.recorded_calls[0]["success"] is False


@pytest.mark.asyncio
async def test_executor_includes_alternative_tools_in_replan_event():
    """触发重规划时 plan_step_error 事件包含 alternative_tools 字段。"""
    from agent.error_recovery import ErrorRecoveryManager
    ws = _CapturingWebSocket()
    recovery = ErrorRecoveryManager()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
        recovery_manager=recovery,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=1,  # 已有 1 次，再 1 次达阈值
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "失败"}),
                tool_call_id="call-1",
                name="parallel_execute",
            ),
        ],
    )
    await executor(state)

    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 1
    payload = error_events[0]["payload"]
    assert payload["replanning"] is True
    assert payload["tool_name"] == "parallel_execute"
    # parallel_execute 的替代工具：call_sub_agent
    assert "call_sub_agent" in payload["alternative_tools"]


@pytest.mark.asyncio
async def test_executor_replan_message_includes_alternative_tools_hint():
    """[重规划请求] SystemMessage 包含替代工具建议。"""
    from agent.error_recovery import ErrorRecoveryManager
    ws = _CapturingWebSocket()
    recovery = ErrorRecoveryManager()
    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
        recovery_manager=recovery,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=1,
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "失败"}),
                tool_call_id="call-1",
                name="browser_browse",
            ),
        ],
    )
    result = await executor(state)
    replan_msg = result["messages"][0]
    # [重规划请求] 包含失败工具名
    assert "browser_browse" in replan_msg.content
    # 包含替代工具建议（tavily_search / tavily_extract）
    assert "tavily_search" in replan_msg.content or "tavily_extract" in replan_msg.content


@pytest.mark.asyncio
async def test_executor_recovery_manager_should_replan_consulted():
    """executor 调用 recovery_manager.should_replan 作为重规划判断的补充。

    正常路径：failure_count 达阈值 + recovery_manager 同意 → 触发 replan。
    此测试验证 recovery_manager 的 should_replan 方法在 executor 中被调用
    且其返回值（True）不阻断 replan 决策。
    """
    from agent.error_recovery import ErrorRecoveryManager
    ws = _CapturingWebSocket()
    recovery = ErrorRecoveryManager()
    # 预置 file_read 已有 1 次失败（达阈值后 recovery 内部同意 replan）
    recovery.record_failure("file_read", "prior err")

    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
        recovery_manager=recovery,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=1,  # 显式计数 1+1=2 达阈值
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": False, "error": "失败"}),
                tool_call_id="call-1",
                name="file_read",
            ),
        ],
    )
    result = await executor(state)

    # recovery_manager.record_failure 被调用 → file_read 内部连续失败=2
    assert recovery.get_failure_count("file_read") == 2
    # should_replan 内部判断为 True（consecutive_failures=2 >= threshold=2）
    assert recovery.should_replan("file_read", threshold=2) is True
    # executor 取交集 → 触发 replan
    error_events = [p for p in ws.payloads if p.get("type") == "plan_step_error"]
    assert len(error_events) == 1
    assert error_events[0]["payload"]["replanning"] is True
    # replan_count 累加
    assert result.get("replan_count") == 1


@pytest.mark.asyncio
async def test_executor_records_success_resets_failure_count():
    """步骤成功完成时调用 recovery_manager.record_success 重置失败计数。"""
    from agent.error_recovery import ErrorRecoveryManager
    ws = _CapturingWebSocket()
    recovery = ErrorRecoveryManager()
    # 预置 file_read 有 1 次失败（未达阈值）
    recovery.record_failure("file_read", "prior err")
    assert recovery.get_failure_count("file_read") == 1

    executor = make_executor_node(
        ws=ws,
        interaction_module=None,
        system_prompt="sys",
        enable_hitl=False,
        replan_threshold=2,
        max_replans=2,
        recovery_manager=recovery,
    )
    plan_steps = [
        {"description": "step1", "index": 0},
        {"description": "step2", "index": 1},
    ]
    # 当前步骤成功（ToolMessage success=True，无失败）
    state = _make_state(
        plan_steps=plan_steps,
        current_step_index=0,
        step_status={"0": StepStatus.RUNNING.value},
        failure_count=0,
        replan_count=0,
        plan_confirmed=True,
        messages=[
            SystemMessage(content="[当前步骤 1/2]\nstep1"),
            ToolMessage(
                content=json.dumps({"success": True, "data": "ok"}),
                tool_call_id="call-1",
                name="file_read",
            ),
        ],
    )
    await executor(state)

    # file_read 的连续失败计数应被重置
    assert recovery.get_failure_count("file_read") == 0


class _RecordingPerformanceMonitor:
    """记录 record_tool_call 调用的测试桩。"""

    def __init__(self):
        self.recorded_calls: list[dict] = []

    def record_tool_call(self, tool_name: str, duration: float, success: bool = True) -> None:
        self.recorded_calls.append({
            "tool_name": tool_name,
            "duration": duration,
            "success": success,
        })


# ── Task 2.3：ReplanTrigger 数据类测试 ──


class TestReplanTrigger:
    """ReplanTrigger 数据类测试。"""

    def test_default_fields(self):
        from agent.error_recovery import ReplanTrigger
        trigger = ReplanTrigger(
            tool_name="file_read",
            failed_step_description="step",
            error_message="err",
            completed_steps="",
        )
        assert trigger.tool_name == "file_read"
        assert trigger.alternative_tools == []
        assert trigger.suggestion_message == ""
        assert trigger.timestamp > 0  # 自动填充

    def test_with_alternatives_and_suggestion(self):
        from agent.error_recovery import ReplanTrigger
        trigger = ReplanTrigger(
            tool_name="parallel_execute",
            failed_step_description="并行步骤",
            error_message="子 Agent 超时",
            completed_steps="  1. 准备",
            alternative_tools=["call_sub_agent"],
            suggestion_message="建议串行退化",
        )
        assert trigger.alternative_tools == ["call_sub_agent"]
        assert "串行" in trigger.suggestion_message


# ── Task 2.3：_state_summary 降级标记测试 ──


class TestStateSummaryDegraded:
    """_state_summary 阶段 2.3 is_degraded / skipped_step_indices 字段测试。"""

    def test_no_degradation_when_all_done(self):
        from agent.executor import _state_summary
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ])
        summary = _state_summary(
            plan,
            current_index=2,
            step_status={"0": StepStatus.DONE.value, "1": StepStatus.DONE.value},
            failure_count=0,
            replan_count=0,
        )
        assert summary["is_complete"] is True
        assert summary["is_degraded"] is False
        assert summary["skipped_step_indices"] == []
        assert summary["failed_step_indices"] == []

    def test_degraded_when_step_skipped(self):
        from agent.executor import _state_summary
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
            {"description": "step3", "index": 2},
        ])
        summary = _state_summary(
            plan,
            current_index=3,
            step_status={
                "0": StepStatus.DONE.value,
                "1": StepStatus.SKIPPED.value,
                "2": StepStatus.DONE.value,
            },
            failure_count=2,
            replan_count=1,
        )
        assert summary["is_degraded"] is True
        assert summary["skipped_step_indices"] == [1]
        assert summary["failed_step_indices"] == []

    def test_degraded_when_step_failed(self):
        from agent.executor import _state_summary
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ])
        summary = _state_summary(
            plan,
            current_index=2,
            step_status={
                "0": StepStatus.DONE.value,
                "1": StepStatus.FAILED.value,
            },
            failure_count=1,
            replan_count=0,
        )
        assert summary["is_degraded"] is True
        assert summary["skipped_step_indices"] == []
        assert summary["failed_step_indices"] == [1]

    def test_degraded_with_mixed_skipped_and_failed(self):
        from agent.executor import _state_summary
        plan = _make_plan([
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
            {"description": "step3", "index": 2},
            {"description": "step4", "index": 3},
        ])
        summary = _state_summary(
            plan,
            current_index=4,
            step_status={
                "0": StepStatus.DONE.value,
                "1": StepStatus.SKIPPED.value,
                "2": StepStatus.FAILED.value,
                "3": StepStatus.DONE.value,
            },
            failure_count=3,
            replan_count=2,
        )
        assert summary["is_degraded"] is True
        assert summary["skipped_step_indices"] == [1]
        assert summary["failed_step_indices"] == [2]


# ── Task 2.3：_maybe_notify_plan_degraded 测试 ──


class _FakeGraphState:
    """模拟 graph.aget_state 返回值。"""

    def __init__(self, values: dict):
        self.values = values


class _FakeGraph:
    """模拟 LangGraph CompiledStateGraph，仅支持 aget_state。"""

    def __init__(self, values: dict):
        self._values = values

    async def aget_state(self, config):
        return _FakeGraphState(self._values)


class _DegradedCapturingWS:
    """捕获 plan_degraded 事件的 WebSocket 桩。"""

    def __init__(self):
        self.payloads: list[dict] = []

    async def send_json(self, payload: dict):
        self.payloads.append(payload)


@pytest.mark.asyncio
async def test_maybe_notify_plan_degraded_skips_when_no_plan():
    """无 plan_steps 时不推送 plan_degraded。"""
    from api.routes.chat import _maybe_notify_plan_degraded
    ws = _DegradedCapturingWS()
    graph = _FakeGraph({"plan_steps": [], "step_status": {}})
    await _maybe_notify_plan_degraded(graph, {}, ws)
    assert ws.payloads == []


@pytest.mark.asyncio
async def test_maybe_notify_plan_degraded_skips_when_all_done():
    """所有步骤正常完成时不推送。"""
    from api.routes.chat import _maybe_notify_plan_degraded
    ws = _DegradedCapturingWS()
    graph = _FakeGraph({
        "plan_steps": [{"description": "s1", "index": 0}],
        "step_status": {"0": StepStatus.DONE.value},
        "failure_count": 0,
        "replan_count": 0,
    })
    await _maybe_notify_plan_degraded(graph, {}, ws)
    assert ws.payloads == []


@pytest.mark.asyncio
async def test_maybe_notify_plan_degraded_pushes_when_step_skipped():
    """有步骤被 SKIPPED 时推送 plan_degraded 事件。"""
    from api.routes.chat import _maybe_notify_plan_degraded
    ws = _DegradedCapturingWS()
    graph = _FakeGraph({
        "plan_steps": [
            {"description": "step1", "index": 0},
            {"description": "step2", "index": 1},
        ],
        "step_status": {
            "0": StepStatus.DONE.value,
            "1": StepStatus.SKIPPED.value,
        },
        "failure_count": 2,
        "replan_count": 1,
    })
    await _maybe_notify_plan_degraded(graph, {}, ws)

    degraded_events = [p for p in ws.payloads if p.get("type") == "plan_degraded"]
    assert len(degraded_events) == 1
    payload = degraded_events[0]["payload"]
    assert len(payload["skipped_steps"]) == 1
    assert payload["skipped_steps"][0]["description"] == "step2"
    assert payload["failure_count"] == 2
    assert payload["replan_count"] == 1
    assert "降级" in payload["message"]


@pytest.mark.asyncio
async def test_maybe_notify_plan_degraded_pushes_when_step_failed():
    """有步骤 FAILED 时推送 plan_degraded 事件。"""
    from api.routes.chat import _maybe_notify_plan_degraded
    ws = _DegradedCapturingWS()
    graph = _FakeGraph({
        "plan_steps": [{"description": "fail_step", "index": 0}],
        "step_status": {"0": StepStatus.FAILED.value},
        "failure_count": 1,
        "replan_count": 0,
    })
    await _maybe_notify_plan_degraded(graph, {}, ws)

    degraded_events = [p for p in ws.payloads if p.get("type") == "plan_degraded"]
    assert len(degraded_events) == 1
    payload = degraded_events[0]["payload"]
    assert len(payload["failed_steps"]) == 1
    assert payload["failed_steps"][0]["description"] == "fail_step"


@pytest.mark.asyncio
async def test_maybe_notify_plan_degraded_handles_aget_state_exception():
    """aget_state 抛异常时静默跳过，不抛错。"""
    from api.routes.chat import _maybe_notify_plan_degraded

    class _BrokenGraph:
        async def aget_state(self, config):
            raise RuntimeError("checkpoint unavailable")

    ws = _DegradedCapturingWS()
    # 不应抛异常
    await _maybe_notify_plan_degraded(_BrokenGraph(), {}, ws)
    assert ws.payloads == []
