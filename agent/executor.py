"""Executor 节点 — Plan-and-Execute 步骤级执行驱动。

executor 节点位于 planner 与 agent 之间，负责：
1. 计划确认（HITL）：复杂计划在执行前等待用户确认
2. 步骤驱动：按步骤注入上下文，agent 完成一步后 regain 控制权推进下一步
3. 并行触发：检测并行组后建议 LLM 调用 parallel_execute（2.2）
4. 失败重规划：工具失败达阈值后路由回 planner 修订计划（2.3）

图拓扑（enable_executor=True 时）::

    planner → executor → agent ↔ tools
                 ↑           |
                 └───────────┘
                 (每步完成后 regain 控制权)

executor 不直接调用 LLM，只做状态机路由 + SystemMessage 注入。
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Callable, Optional

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langgraph.graph import END

from agent.step_state import ExecutionPlan, PlanStep, StepStatus, merge_dicts

logger = logging.getLogger(__name__)


# ── HITL 计划确认 ──────────────────────────────────────────────

async def request_plan_confirmation(
    *,
    ws,
    interaction,
    plan_id: str,
    steps: list[str],
    plan: str,
    timeout: float = 120,
):
    """发送计划确认请求并确保所有 pending 映射最终被清理。

    通过 WebSocket 推送 plan_proposed 事件，等待前端 plan_response 响应。
    超时或异常时返回 None，调用方按原计划继续。
    """
    future: asyncio.Future | None = None
    try:
        _, future = await interaction.register(interaction_id=plan_id)
        await ws.send_json({
            "type": "plan_proposed",
            "payload": {
                "plan_id": plan_id,
                "steps": steps,
                "plan_text": plan,
            },
        })
        # 记录计划提案到 Activity Hub
        try:
            from api.activity_hub import activity_hub
            from api.interaction import current_session_id
            _session_id = current_session_id.get() or ""
            activity_hub.add(
                category="plan",
                event_type="plan_proposed",
                session_id=_session_id,
                message=f"计划待确认：{len(steps)} 步",
                payload={"plan_steps": steps[:5]},
            )
        except Exception:
            pass

        response = await asyncio.wait_for(future, timeout=timeout)
        # 记录计划确认响应到 Activity Hub
        try:
            from api.activity_hub import activity_hub
            from api.interaction import current_session_id
            _session_id = current_session_id.get() or ""
            if isinstance(response, str):
                resp_lower = response.strip().lower()
                if resp_lower in ("reject", "取消", "拒绝", "否", "no", "deny"):
                    activity_hub.add(
                        category="plan",
                        event_type="plan_rejected",
                        session_id=_session_id,
                        level="warn",
                        message="用户拒绝执行计划",
                    )
                elif resp_lower in ("approve", "确认", "同意", "是", "ok"):
                    activity_hub.add(
                        category="plan",
                        event_type="plan_approved",
                        session_id=_session_id,
                        message="用户批准执行计划",
                    )
                else:
                    activity_hub.add(
                        category="plan",
                        event_type="plan_modified",
                        session_id=_session_id,
                        message="用户修改了执行计划",
                    )
        except Exception:
            pass
        return response
    except asyncio.TimeoutError:
        logger.info("Plan confirmation timed out, proceeding with original plan")
        return None
    except Exception as e:
        logger.warning("Plan confirmation failed, proceeding with original plan: %s", e)
        return None
    finally:
        if future is not None and not future.done():
            future.cancel()
        await interaction.cleanup(plan_id)


# ── 步骤状态机 ─────────────────────────────────────────────────

class StepStateMachine:
    """步骤状态机 — 跟踪执行计划中每个步骤的状态。

    纯逻辑类，不依赖图运行时。executor_node 通过它判断下一步动作。
    """

    def __init__(self, plan: ExecutionPlan):
        self.plan = plan
        self.current_index = 0
        self.statuses: dict[str, StepStatus] = {}
        self.failure_count = 0
        self.replan_count = 0
        self.last_failed_step: str = ""

    @property
    def is_complete(self) -> bool:
        """所有步骤是否已完成。"""
        if self.plan.is_empty:
            return True
        return self.current_index >= self.plan.step_count

    @property
    def current_step(self) -> Optional[PlanStep]:
        """当前待执行的步骤（None 表示已完成全部步骤）。"""
        if self.is_complete:
            return None
        return self.plan.steps_in_order()[self.current_index]

    def get_status(self, index: int) -> StepStatus:
        """获取指定步骤的状态（默认 PENDING）。"""
        return self.statuses.get(str(index), StepStatus.PENDING)

    def set_status(self, index: int, status: StepStatus) -> None:
        """设置指定步骤的状态。"""
        self.statuses[str(index)] = status

    def advance(self) -> Optional[PlanStep]:
        """推进到下一步，返回下一步（None 表示已完成全部）。"""
        if not self.is_complete:
            self.current_index += 1
        return self.current_step

    def mark_failed(self, error: str = "") -> None:
        """标记当前步骤失败，累加失败计数。"""
        if self.current_step is not None:
            self.set_status(self.current_step.index, StepStatus.FAILED)
            self.last_failed_step = self.current_step.description
            self.failure_count += 1

    def mark_done(self) -> None:
        """标记当前步骤完成。"""
        if self.current_step is not None:
            self.set_status(self.current_step.index, StepStatus.DONE)

    def should_replan(self, threshold: int = 2) -> bool:
        """是否应触发重规划（失败次数达到阈值）。"""
        return self.failure_count >= threshold

    def get_completed_steps(self) -> list[PlanStep]:
        """返回已完成的步骤列表（用于 replan 时保留已成功步骤）。"""
        return [
            s for s in self.plan.steps_in_order()
            if self.get_status(s.index) == StepStatus.DONE
        ]

    def summary(self) -> dict:
        """返回状态摘要（供 WS 事件推送）。"""
        return {
            "current_step_index": self.current_index,
            "total_steps": self.plan.step_count,
            "statuses": {k: v.value for k, v in self.statuses.items()},
            "failure_count": self.failure_count,
            "replan_count": self.replan_count,
            "is_complete": self.is_complete,
        }


# ── 工具失败检测 ────────────────────────────────────────────────

def detect_tool_failure(messages: list[BaseMessage], since_index: int = 0) -> tuple[bool, str, str]:
    """检查消息列表中是否有工具失败。

    检测 ToolMessage.content 中是否包含 format_error 标记（success: false）。
    返回 (是否失败, 错误信息, 工具名)。

    Args:
        messages: 消息列表
        since_index: 从该索引开始检查（用于只检查当前步骤的消息）

    Returns:
        (has_failure, error_msg, tool_name)
        - has_failure: 是否检测到失败
        - error_msg: 错误信息（失败时非空）
        - tool_name: 失败的工具名（失败时非空，供 ErrorRecoveryManager.record_failure 使用）
    """
    for msg in messages[since_index:]:
        if not isinstance(msg, ToolMessage):
            continue
        content = str(msg.content) if not isinstance(msg.content, str) else msg.content
        # format_error 返回 JSON: {"success": false, "error": "..."}
        if '"success": false' in content or '"success":false' in content:
            # 提取错误信息
            error_msg = content[:200]
            try:
                import json
                parsed = json.loads(content)
                if isinstance(parsed, dict) and parsed.get("success") is False:
                    error_msg = parsed.get("error", "工具执行失败")
            except (json.JSONDecodeError, TypeError):
                pass
            # ToolMessage.name 字段记录工具名（format_error 由 tools/base.py 设置）
            tool_name = getattr(msg, "name", "") or ""
            return True, error_msg, tool_name
    return False, "", ""


def find_last_system_message_index(messages: list[BaseMessage]) -> int:
    """找到最后一条 SystemMessage 的索引（用于界定当前步骤的消息范围）。

    executor 注入步骤上下文时使用 SystemMessage，agent_node 注入系统提示词时
    也是 SystemMessage。这里找的是 executor 注入的最后一条步骤消息。
    步骤消息以 "[当前步骤" 开头。
    """
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if isinstance(msg, SystemMessage):
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            if content.startswith("[当前步骤"):
                return i
    return -1


# ── executor 节点工厂 ──────────────────────────────────────────

def make_executor_node(
    *,
    ws,
    interaction_module,
    system_prompt: str,
    enable_hitl: bool = True,
    plan_confirm_timeout: float = 120,
    replan_threshold: int = 2,
    max_replans: int = 2,
    send_event: Optional[Callable] = None,
    recovery_manager: Optional[Any] = None,
    performance_monitor: Optional[Any] = None,
    on_plan_confirmation: Optional[Callable] = None,
    on_activity_event: Optional[Callable] = None,
):
    """创建 executor 节点函数（闭包捕获 ws / interaction / 配置）。

    Args:
        ws: WebSocket 实例（None 时跳过 HITL）
        interaction_module: api.interaction 模块
        system_prompt: 系统提示词（用于判断是否需要 auto_approve）
        enable_hitl: 是否启用 HITL 确认
        plan_confirm_timeout: HITL 超时秒数
        replan_threshold: 触发重规划的最小失败次数
        max_replans: 最大重规划次数
        send_event: 可选的事件推送回调（用于 plan_step_* 事件）
        recovery_manager: ErrorRecoveryManager 实例（None 时跳过 record_failure；
            阶段 2.3 接入：record_failure + should_replan + build_replan_trigger；
            生产代码由 graph.py 显式注入全局单例，测试传 None 隔离状态）
        performance_monitor: PerformanceMonitor 实例（None 时跳过 record_tool_call；
            阶段 2.3 接入：record_tool_call(success=False)）
        on_plan_confirmation: 计划确认回调（B5 回调注入）。
            None 时使用本模块的 request_plan_confirmation。
        on_activity_event: 活动事件记录回调（B5 回调注入）。
            None 时懒加载 api.activity_hub.activity_hub.add。
            用于将 plan_step_start / plan_step_end / plan_step_error / plan_completed
            事件记录到 ActivityHub。
    """
    # 回调注入默认值：未提供时使用直接引用 / 懒加载
    if on_plan_confirmation is None:
        on_plan_confirmation = request_plan_confirmation
    if on_activity_event is None:
        try:
            from api.activity_hub import activity_hub
            on_activity_event = activity_hub.add
        except Exception:
            on_activity_event = None

    def _record_activity(event: dict) -> None:
        """将 plan 事件记录到 ActivityHub（通过注入的 on_activity_event 回调）。

        与 _send_event 的 WS 推送互补：WS 推送给前端实时展示，
        ActivityHub 记录供后续查询/审计。记录失败不影响主流程。
        """
        if on_activity_event is None:
            return
        try:
            from api.interaction import current_session_id
            _session_id = current_session_id.get() or ""
        except Exception:
            _session_id = ""
        event_type = event.get("type", "")
        payload = event.get("payload", {})
        try:
            if event_type == "plan_step_start":
                step_idx = payload.get("step_index", 0)
                on_activity_event(
                    category="plan",
                    event_type="plan_step_start",
                    session_id=_session_id,
                    message=f"开始步骤 {step_idx + 1}: {payload.get('step_description', '')}",
                    payload=payload,
                )
            elif event_type == "plan_step_end":
                step_idx = payload.get("step_index", 0)
                on_activity_event(
                    category="plan",
                    event_type="plan_step_end",
                    session_id=_session_id,
                    message=f"完成步骤 {step_idx + 1}（{payload.get('status', 'done')}）",
                    payload=payload,
                )
            elif event_type == "plan_step_error":
                step_idx = payload.get("step_index", 0)
                on_activity_event(
                    category="plan",
                    event_type="plan_step_error",
                    session_id=_session_id,
                    level="warn",
                    message=f"步骤 {step_idx + 1} 失败: {payload.get('error', '')[:100]}",
                    payload=payload,
                )
            elif event_type == "plan_completed":
                on_activity_event(
                    category="plan",
                    event_type="plan_completed",
                    session_id=_session_id,
                    message="计划执行完成",
                    payload=payload,
                )
        except Exception:
            logger.debug("Failed to record plan event to ActivityHub", exc_info=True)

    async def _send_event(payload: dict) -> None:
        """通过 ws 或 send_event 回调推送事件，并记录到 ActivityHub。"""
        # 记录到 ActivityHub（B5：plan 事件记录）
        _record_activity(payload)
        if send_event is not None:
            await send_event(payload)
        elif ws is not None:
            try:
                await ws.send_json(payload)
            except Exception:
                logger.debug("Failed to send executor event via ws", exc_info=True)

    async def executor_node(state: dict) -> dict:
        """Executor 节点：步骤级执行驱动 + 状态机路由。

        每次被调用时：
        1. 若无计划 → 直接通过（简单任务）
        2. 若计划未确认 → 执行 HITL 确认
        3. 若全部步骤完成 → 返回结束信号
        4. 若当前步骤刚完成 → 推进下一步
        5. 若当前步骤失败 → 判断是否重规划
        6. 注入当前步骤上下文 → 路由到 agent
        """
        plan_steps_raw = state.get("plan_steps", [])
        if not plan_steps_raw:
            # 无计划，简单任务直接通过到 agent
            return {}

        plan = ExecutionPlan.from_dict_list(
            plan_steps_raw,
            raw_text=state.get("plan_text", ""),
        )
        if plan.is_empty:
            return {}

        current_index = state.get("current_step_index", 0)
        step_status = state.get("step_status", {})
        failure_count = state.get("failure_count", 0)
        replan_count = state.get("replan_count", 0)
        plan_confirmed = state.get("plan_confirmed", False)

        # ── 1. HITL 确认（首次进入，计划未确认）──
        if not plan_confirmed:
            from agent.planner import PLAN_CONFIRM_THRESHOLD

            need_hitl = (
                enable_hitl
                and ws is not None
                and plan.step_count >= PLAN_CONFIRM_THRESHOLD
            )

            if need_hitl:
                # 检查 auto_approve
                from api.interaction import current_session_id, get_session_auto_approve
                session_id = current_session_id.get()
                auto_approve = get_session_auto_approve(session_id) if session_id else False

                if not auto_approve:
                    plan_id = uuid.uuid4().hex[:12]
                    steps_text = [s.description for s in plan.steps_in_order()]
                    response = await on_plan_confirmation(
                        ws=ws,
                        interaction=interaction_module,
                        plan_id=plan_id,
                        steps=steps_text,
                        plan=plan.raw_text,
                        timeout=plan_confirm_timeout,
                    )

                    if response is not None:
                        resp = str(response).strip()
                        resp_lower = resp.lower()
                        if resp_lower in ("reject", "取消", "拒绝", "否", "no", "deny"):
                            # 用户拒绝 → 注入拒绝消息，结束执行
                            reject_msg = SystemMessage(
                                content="[执行计划] 用户已拒绝此计划，请直接用简洁方式回应用户。"
                            )
                            return {
                                "messages": [reject_msg],
                                "plan_confirmed": True,
                            }
                        elif resp_lower not in ("approve", "确认", "同意", "是", "ok"):
                            # 用户修改了计划 → 重新解析
                            from agent.planner import parse_plan_to_steps
                            new_steps = parse_plan_to_steps(resp)
                            if new_steps:
                                plan = ExecutionPlan(steps=new_steps, raw_text=resp)
                                logger.info("Plan modified by user, re-parsed %d steps", plan.step_count)
            # 标记已确认（无论是否做了 HITL）
            confirmed_update = {"plan_confirmed": True}
            if not plan.is_empty:
                confirmed_update["plan_steps"] = plan.to_dict_list()
                confirmed_update["plan_text"] = plan.raw_text
            # 继续执行第一步
            return {**confirmed_update, **_inject_step(plan, 0, state, _send_event)}

        # ── 2. 全部步骤完成 → 结束 ──
        if current_index >= plan.step_count:
            await _send_event({
                "type": "plan_completed",
                "payload": {"summary": _state_summary(plan, current_index, step_status, failure_count, replan_count)},
            })
            return {}

        # ── 3. 检查当前步骤状态 ──
        current_step = plan.steps_in_order()[current_index]
        step_key = str(current_step.index)
        status_str = step_status.get(step_key, StepStatus.PENDING.value)
        status = StepStatus(status_str) if isinstance(status_str, str) else status_str

        # 并行组处理：当前步骤属于并行组时，同组所有步骤一起处理
        is_parallel = current_step.is_parallel
        group_steps = _get_parallel_group_steps(plan, current_step) if is_parallel else [current_step]
        group_status_keys = [str(s.index) for s in group_steps]
        last_group_index = max(s.index for s in group_steps)

        if status == StepStatus.RUNNING:
            # agent 刚完成当前步骤（no tool_calls 路由回 executor）
            # 检查是否有工具失败
            messages = state.get("messages", [])
            sys_idx = find_last_system_message_index(messages)
            check_from = sys_idx + 1 if sys_idx >= 0 else 0
            has_failure, error_msg, failed_tool_name = detect_tool_failure(messages, check_from)

            if has_failure:
                # 阶段 2.3：接入 ErrorRecoveryManager + PerformanceMonitor
                # 阶段 3.1：record_failure 同步驱动 CircuitBreaker
                suggestion = None
                circuit_open = False
                if recovery_manager is not None and failed_tool_name:
                    try:
                        suggestion = recovery_manager.record_failure(failed_tool_name, error_msg)
                    except Exception:
                        logger.debug("record_failure failed", exc_info=True)
                    # 阶段 3.1：检查熔断器是否已打开
                    try:
                        circuit_open = recovery_manager.is_tool_circuit_open(failed_tool_name)
                        if circuit_open:
                            logger.warning(
                                "工具 %s 熔断器已打开，建议重规划时避免使用该工具",
                                failed_tool_name,
                            )
                    except Exception:
                        logger.debug("circuit breaker check failed", exc_info=True)
                if performance_monitor is not None and failed_tool_name:
                    try:
                        performance_monitor.record_tool_call(
                            failed_tool_name, duration=0.0, success=False
                        )
                    except Exception:
                        logger.debug("record_tool_call failed", exc_info=True)

                # 标记失败，判断是否重规划
                new_failure_count = failure_count + 1
                # 并行组：同组所有步骤一起标记失败
                new_step_status = {k: StepStatus.FAILED.value for k in group_status_keys}

                # 阶段 2.3：优先使用 ErrorRecoveryManager.should_replan 判断
                # （保留对 replan_threshold 的兼容，recovery_manager 为 None 时回退）
                should_trigger_replan = (
                    new_failure_count >= replan_threshold and replan_count < max_replans
                )
                # 阶段 3.1：熔断器打开时强制触发重规划（继续调用该工具无意义）
                if circuit_open and replan_count < max_replans:
                    should_trigger_replan = True
                if recovery_manager is not None and failed_tool_name:
                    try:
                        # should_replan 返回 True 时不一定触发（还需受 max_replans 约束）
                        # 这里仅用作补充判断：recovery_manager 认为不该 replan 时尊重其意见
                        rm_should = recovery_manager.should_replan(
                            failed_tool_name,
                            failure_count=new_failure_count,
                            threshold=replan_threshold,
                        )
                        # 取交集：两者都同意才触发
                        # 例外：熔断器打开时强制触发（绕过 rm_should 的阈值检查）
                        if circuit_open:
                            should_trigger_replan = (
                                should_trigger_replan and replan_count < max_replans
                            )
                        else:
                            should_trigger_replan = (
                                should_trigger_replan and rm_should and replan_count < max_replans
                            )
                    except Exception:
                        logger.debug("should_replan check failed", exc_info=True)

                if should_trigger_replan:
                    # 触发重规划 → 注入失败上下文，路由回 planner
                    # 阶段 2.3：使用 ReplanTrigger 携带更丰富的上下文
                    completed_steps_text = _completed_steps_text(plan, step_status)
                    replan_trigger = None
                    if recovery_manager is not None and failed_tool_name:
                        try:
                            replan_trigger = recovery_manager.build_replan_trigger(
                                tool_name=failed_tool_name,
                                failed_step_description=current_step.description,
                                error_message=error_msg,
                                completed_steps=completed_steps_text,
                            )
                        except Exception:
                            logger.debug("build_replan_trigger failed", exc_info=True)

                    await _send_event({
                        "type": "plan_step_error",
                        "payload": {
                            "step_index": current_index,
                            "step_description": current_step.description,
                            "error": error_msg,
                            "replanning": True,
                            "tool_name": failed_tool_name,
                            "alternative_tools": (
                                replan_trigger.alternative_tools if replan_trigger else []
                            ),
                        },
                    })
                    # 构造 [重规划请求] SystemMessage：包含失败上下文 + 替代工具建议
                    alt_hint = ""
                    if replan_trigger and replan_trigger.alternative_tools:
                        alt_hint = (
                            f"\n建议替代工具：{', '.join(replan_trigger.alternative_tools)}"
                        )
                    suggestion_hint = ""
                    if replan_trigger and replan_trigger.suggestion_message:
                        suggestion_hint = (
                            f"\n恢复建议：{replan_trigger.suggestion_message}"
                        )
                    # 阶段 3.1：熔断器打开时附加警告
                    circuit_hint = ""
                    if circuit_open and failed_tool_name:
                        circuit_hint = (
                            f"\n⚠️ 熔断警告：工具 {failed_tool_name} 已连续失败达到熔断阈值，"
                            f"当前熔断器处于打开状态，重规划时请避免使用该工具或改用替代工具。"
                        )
                    replan_msg = SystemMessage(
                        content=(
                            f"[重规划请求]\n"
                            f"原计划第 {current_index + 1} 步「{current_step.description}」失败。\n"
                            f"失败工具：{failed_tool_name or '未知'}\n"
                            f"错误信息：{error_msg}\n"
                            f"已成功完成的步骤：{completed_steps_text}\n"
                            f"{alt_hint}{suggestion_hint}{circuit_hint}\n"
                            f"请基于原计划和失败信息生成修订计划，保留已成功步骤，调整失败步骤的执行策略。"
                        )
                    )
                    return {
                        "messages": [replan_msg],
                        "step_status": new_step_status,
                        "failure_count": new_failure_count,
                        "last_failed_step": current_step.description,
                        "replan_count": replan_count + 1,
                        # 重置步骤指针，planner 重新生成计划后从 0 开始
                        "current_step_index": 0,
                        "plan_confirmed": False,
                    }
                else:
                    # 失败次数不足或重规划次数用尽，标记失败后跳过该步骤
                    # 并行组：推送所有同组步骤的 error 事件
                    for s in group_steps:
                        await _send_event({
                            "type": "plan_step_error",
                            "payload": {
                                "step_index": s.index,
                                "step_description": s.description,
                                "error": error_msg,
                                "replanning": False,
                                "skipped": True,
                                "tool_name": failed_tool_name,
                                "suggestion": suggestion.message if suggestion else "",
                            },
                        })
                    skip_msg = SystemMessage(
                        content=f"[步骤跳过] 第 {current_index + 1} 步「{current_step.description}」因失败被跳过。"
                    )
                    # 并行组：跳过整个组，推进到组后下一步
                    next_index = last_group_index + 1
                    # 合并 step_status：当前组跳过 + 下一步运行中（避免覆盖）
                    next_update = _inject_step(plan, next_index, state, _send_event) if next_index < plan.step_count else {}
                    merged_status = {k: StepStatus.SKIPPED.value for k in group_status_keys}
                    merged_status.update(next_update.get("step_status", {}))
                    return {
                        "messages": [skip_msg, *next_update.get("messages", [])],
                        "step_status": merged_status,
                        "failure_count": new_failure_count,
                        "last_failed_step": current_step.description,
                        "current_step_index": next_index,
                    }
            else:
                # 步骤成功完成 → 推进下一步
                # 阶段 2.3：重置同步骤内成功工具的失败计数（避免历史失败误触发 replan）
                # 修复 Bug 5.2：原实现对所有 ToolMessage 都调用 record_success，包括
                # 失败的 ToolMessage（content 含 '"success": false'），导致失败工具的
                # CircuitBreaker 失败计数被错误重置。现在过滤掉失败的工具调用。
                if recovery_manager is not None:
                    for msg in messages[check_from:]:
                        if not isinstance(msg, ToolMessage):
                            continue
                        content = msg.content if isinstance(msg.content, str) else str(msg.content)
                        # 跳过失败的工具调用（与 detect_tool_failure 的判定保持一致）
                        if '"success": false' in content or '"success":false' in content:
                            continue
                        t_name = getattr(msg, "name", "") or ""
                        if t_name:
                            try:
                                recovery_manager.record_success(t_name)
                            except Exception:
                                logger.debug("record_success failed", exc_info=True)
                # 并行组：同组所有步骤一起标记完成，推送所有 end 事件
                for s in group_steps:
                    await _send_event({
                        "type": "plan_step_end",
                        "payload": {
                            "step_index": s.index,
                            "step_description": s.description,
                            "status": "done",
                        },
                    })
                # 并行组：推进到组后下一步
                next_index = last_group_index + 1
                done_status = {k: StepStatus.DONE.value for k in group_status_keys}
                if next_index >= plan.step_count:
                    # 全部完成
                    # 合并 step_status：当前组完成 + 历史状态，供 _state_summary 准确计算 is_degraded
                    final_status = dict(step_status)
                    final_status.update(done_status)
                    await _send_event({
                        "type": "plan_completed",
                        "payload": {"summary": _state_summary(plan, next_index, final_status, failure_count, replan_count)},
                    })
                    return {
                        "step_status": done_status,
                        "current_step_index": next_index,
                    }
                # 注入下一步（合并 step_status：当前步完成 + 下一步运行中）
                next_step = plan.steps_in_order()[next_index]
                if next_step.is_parallel:
                    next_update = _inject_parallel_step(plan, next_step, state, _send_event)
                else:
                    next_update = _inject_step(plan, next_index, state, _send_event)
                merged_status = dict(done_status)
                merged_status.update(next_update.get("step_status", {}))
                return {
                    "step_status": merged_status,
                    "current_step_index": next_index,
                    "messages": next_update.get("messages", []),
                }

        # ── 4. 步骤待执行 → 注入步骤上下文 ──
        if status in (StepStatus.PENDING, StepStatus.FAILED):
            # 并行组：注入并行执行建议
            if is_parallel:
                return _inject_parallel_step(plan, current_step, state, _send_event)
            return _inject_step(plan, current_index, state, _send_event)

        # 其他状态（DONE/SKIPPED）→ 推进
        # 并行组：跳过整个组
        next_index = last_group_index + 1 if is_parallel else current_index + 1
        if next_index >= plan.step_count:
            return {"current_step_index": next_index}
        next_step = plan.steps_in_order()[next_index]
        if next_step.is_parallel:
            next_update = _inject_parallel_step(plan, next_step, state, _send_event)
        else:
            next_update = _inject_step(plan, next_index, state, _send_event)
        return {
            "current_step_index": next_index,
            **next_update,
        }

    async def _executor_node_with_activity(state: dict) -> dict:
        """带 Activity Hub 记录的 executor 节点包装。

        在 turn 开始/结束时记录事件，使用 try/finally 确保所有 return 路径
        都能触发 turn_end 记录。Activity Hub 记录失败不影响正常流程。

        B5：使用注入的 on_activity_event 回调，而非直接 import activity_hub。
        """
        # 记录 turn 开始
        if on_activity_event is not None:
            try:
                from api.interaction import current_session_id
                _session_id = current_session_id.get() or ""
                on_activity_event(
                    category="turn",
                    event_type="turn_start",
                    session_id=_session_id,
                    message="Agent turn 开始",
                )
            except Exception:
                pass

        try:
            return await executor_node(state)
        finally:
            # 记录 turn 结束
            if on_activity_event is not None:
                try:
                    from api.interaction import current_session_id
                    _session_id = current_session_id.get() or ""
                    on_activity_event(
                        category="turn",
                        event_type="turn_end",
                        session_id=_session_id,
                        message="Agent turn 结束",
                    )
                except Exception:
                    pass

    return _executor_node_with_activity


def _inject_step(
    plan: ExecutionPlan,
    index: int,
    state: dict,
    send_event: Callable,
) -> dict:
    """注入指定步骤的上下文 SystemMessage，并推送 plan_step_start 事件。"""
    if index >= plan.step_count:
        return {}
    step = plan.steps_in_order()[index]
    step_key = str(step.index)

    # 构造步骤上下文消息
    tool_hint = f"（建议工具：{step.tool_hint}）" if step.tool_hint else ""
    step_msg = SystemMessage(
        content=(
            f"[当前步骤 {index + 1}/{plan.step_count}]{tool_hint}\n"
            f"{step.description}\n"
            f"请专注完成此步骤。如果需要使用工具，请直接调用。"
        )
    )

    # 异步推送 step_start 事件（不阻塞）
    async def _push():
        await send_event({
            "type": "plan_step_start",
            "payload": {
                "step_index": index,
                "step_description": step.description,
                "tool_hint": step.tool_hint,
                "total_steps": plan.step_count,
            },
        })

    # 在异步上下文中推送（executor_node 是 async，但我们在这里是同步函数）
    # 用 create_task 不阻塞当前流程
    try:
        loop = asyncio.get_event_loop()
        task = loop.create_task(_push())
        task.add_done_callback(lambda t: t.exception())
    except RuntimeError:
        pass  # 无事件循环，跳过推送

    return {
        "messages": [step_msg],
        "step_status": {step_key: StepStatus.RUNNING.value},
    }


def _get_parallel_group_steps(plan: ExecutionPlan, step: PlanStep) -> list[PlanStep]:
    """获取与指定步骤同属一个并行组的所有步骤（按索引升序）。"""
    if not step.is_parallel:
        return [step]
    return [
        s for s in plan.steps_in_order()
        if s.parallel_group == step.parallel_group
    ]


def _inject_parallel_step(
    plan: ExecutionPlan,
    step: PlanStep,
    state: dict,
    send_event: Callable,
) -> dict:
    """注入并行执行建议，触发 LLM 调用 parallel_execute 工具。

    方案 A（推荐）：向 state 注入"建议调用 parallel_execute"的 SystemMessage，
    让 LLM 自主调用（保持 ReAct 范式）。

    构造 parallel_execute 工具所需的 tasks JSON 参数，包含同组所有步骤。
    标记同组所有步骤为 RUNNING，推送所有步骤的 plan_step_start 事件。
    """
    group_steps = _get_parallel_group_steps(plan, step)

    # 构造 parallel_execute 的 tasks 参数
    tasks = [
        {"task": s.description, "name": f"步骤{s.index + 1}"}
        for s in group_steps
    ]
    tasks_json = json.dumps(tasks, ensure_ascii=False)

    # 构造并行执行建议消息
    step_list_text = "\n".join(
        f"  {s.index + 1}. {s.description}" for s in group_steps
    )
    parallel_msg = SystemMessage(
        content=(
            f"[并行执行建议] 以下 {len(group_steps)} 个步骤互不依赖，可并行执行：\n"
            f"{step_list_text}\n\n"
            f"请调用 parallel_execute 工具，tasks 参数如下：\n"
            f"{tasks_json}\n\n"
            f"等待 parallel_execute 返回后汇总结果。"
        )
    )

    # 异步推送所有并行步骤的 start 事件
    async def _push_all():
        for s in group_steps:
            await send_event({
                "type": "plan_step_start",
                "payload": {
                    "step_index": s.index,
                    "step_description": s.description,
                    "tool_hint": s.tool_hint,
                    "total_steps": plan.step_count,
                },
            })

    try:
        loop = asyncio.get_event_loop()
        task = loop.create_task(_push_all())
        task.add_done_callback(lambda t: t.exception())
    except RuntimeError:
        pass  # 无事件循环，跳过推送

    # 标记同组所有步骤为 RUNNING
    status_update = {str(s.index): StepStatus.RUNNING.value for s in group_steps}

    return {
        "messages": [parallel_msg],
        "step_status": status_update,
    }


def _state_summary(
    plan: ExecutionPlan,
    current_index: int,
    step_status: dict,
    failure_count: int,
    replan_count: int,
) -> dict:
    """生成计划执行摘要。

    阶段 2.3 扩展：包含 is_degraded / skipped_step_indices / failed_step_indices，
    供前端 plan_completed 事件判断是否需要向用户展示"降级完成"提示。
    """
    skipped_indices: list[int] = []
    failed_indices: list[int] = []
    for step in plan.steps_in_order():
        status_val = step_status.get(str(step.index))
        if status_val == StepStatus.SKIPPED.value:
            skipped_indices.append(step.index)
        elif status_val == StepStatus.FAILED.value:
            failed_indices.append(step.index)
    is_degraded = bool(skipped_indices or failed_indices)
    return {
        "total_steps": plan.step_count,
        "current_step_index": current_index,
        "statuses": dict(step_status),
        "failure_count": failure_count,
        "replan_count": replan_count,
        "is_complete": current_index >= plan.step_count,
        # 阶段 2.3：降级标记（有步骤被跳过或失败）
        "is_degraded": is_degraded,
        "skipped_step_indices": skipped_indices,
        "failed_step_indices": failed_indices,
    }


def _completed_steps_text(plan: ExecutionPlan, step_status: dict) -> str:
    """返回已完成步骤的文本描述（用于 replan 上下文）。"""
    completed = []
    for step in plan.steps_in_order():
        if step_status.get(str(step.index)) == StepStatus.DONE.value:
            completed.append(f"  {step.index + 1}. {step.description}")
    return "\n".join(completed) if completed else "（无）"


# ── executor 路由函数 ──────────────────────────────────────────

def make_executor_router(max_replans: int = 2):
    """创建 executor 路由函数：判断 executor 之后去哪。

    返回路由函数，用于 graph.add_conditional_edges。
    路由目标：
    - "agent"：执行当前步骤
    - "planner"：重规划
    - END（langgraph.graph.END）：全部完成或无计划
    """
    def executor_router(state: dict) -> str:
        plan_steps = state.get("plan_steps", [])
        if not plan_steps:
            # 无计划 → 直接进 agent
            return "agent"

        current_index = state.get("current_step_index", 0)
        plan = ExecutionPlan.from_dict_list(plan_steps)

        # 全部完成 → END
        if current_index >= plan.step_count:

        # 检查是否需要重规划
        step_status = state.get("step_status", {})
        failure_count = state.get("failure_count", 0)
        replan_count = state.get("replan_count", 0)

        # 如果最后一条消息是重规划请求（SystemMessage 以 "[重规划请求]" 开头）→ 去 planner
        messages = state.get("messages", [])
        if messages:
            last = messages[-1]
            if isinstance(last, SystemMessage):
                content = last.content if isinstance(last.content, str) else str(last.content)
                if content.startswith("[重规划请求]"):
                    return "planner"

        return "agent"

    return executor_router
