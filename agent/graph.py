"""Agent 图构建 — 带规划节点的 ReAct Agent。

图结构::

    planner → model ↔ tools
                ↓
              END

- planner: 判断任务复杂度，复杂任务注入计划 SystemMessage
- model（节点名 "agent"）: 调用 LLM，决定是否使用工具
- tools（节点名 "tools"）: 执行工具调用，返回结果
"""

import asyncio
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from typing_extensions import Annotated, TypedDict

from agent.planner import classify_and_plan, parse_plan_steps, PLAN_CONFIRM_THRESHOLD

logger = logging.getLogger(__name__)


class AgentState(TypedDict):
    """Agent 图状态。"""
    messages: Annotated[list[BaseMessage], add_messages]


def build_agent(
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    checkpointer: MemorySaver | None = None,
    ws=None,
) -> CompiledStateGraph:
    """构建带规划节点的 ReAct Agent 图。

    若提供 checkpointer 则复用（跨轮次持久化状态），
    否则每次新建 MemorySaver（原有行为）。
    若提供 ws（WebSocket），复杂计划将发送 plan_proposed 事件等待用户确认。
    """
    if checkpointer is None:
        checkpointer = MemorySaver()

    llm_with_tools = model.bind_tools(tools) if tools else model
    tool_node = ToolNode(tools) if tools else None

    # ── 节点函数（闭包捕获 model / llm_with_tools）──

    async def planner_node(state: AgentState) -> dict:
        """规划节点：单次 LLM 调用判断复杂度 + 生成计划。

        当计划步骤 >= PLAN_CONFIRM_THRESHOLD 且 ws 可用时，
        发送 plan_proposed 事件并等待用户确认。
        """
        messages = state["messages"]
        if not messages:
            return {}

        last_msg = messages[-1]
        if not isinstance(last_msg, HumanMessage):
            return {}

        user_text = last_msg.content if isinstance(last_msg.content, str) else str(last_msg.content)
        plan = await classify_and_plan(model, user_text)
        if not plan:
            return {}

        logger.info(f"Plan generated for user request: {user_text[:60]}...")

        # ── 计划确认流程 ──
        steps = parse_plan_steps(plan)
        if ws is not None and len(steps) >= PLAN_CONFIRM_THRESHOLD:
            import uuid
            from api import interaction

            plan_id = uuid.uuid4().hex[:12]

            # 发送 plan_proposed 事件
            try:
                await ws.send_json({
                    "type": "plan_proposed",
                    "payload": {
                        "plan_id": plan_id,
                        "steps": steps,
                        "plan_text": plan,
                    },
                })
            except Exception as e:
                logger.warning(f"Failed to send plan_proposed: {e}")
                # WebSocket 发送失败，跳过确认直接执行
                plan_msg = SystemMessage(content=f"[执行计划]\n{plan}")
                return {"messages": [plan_msg]}

            # 注册交互并等待用户响应
            interaction_id, future = interaction.register()
            # 用 plan_id 作为 interaction_id 的映射（前端用 plan_id 回复）
            interaction._pending[plan_id] = future

            try:
                response = await asyncio.wait_for(future, timeout=120)
            except asyncio.TimeoutError:
                logger.info("Plan confirmation timed out, proceeding with original plan")
                response = None
            finally:
                interaction.cleanup(plan_id)
                interaction.cleanup(interaction_id)  # 清理 register() 创建的原始条目

            # 处理用户响应
            if response is None:
                # 超时，使用原计划
                pass
            elif isinstance(response, str):
                resp_data = response.strip()
                if resp_data.lower() in ("reject", "取消", "拒绝", "否", "no", "deny"):
                    logger.info("Plan rejected by user")
                    reject_msg = SystemMessage(content="[执行计划] 用户已拒绝此计划，请直接用简洁方式回应用户。")
                    return {"messages": [reject_msg]}
                elif resp_data.lower() not in ("approve", "确认", "同意", "是", "ok"):
                    # 用户修改了计划
                    plan = resp_data
                    logger.info(f"Plan modified by user: {plan[:60]}...")
            # else: response 是 approve，使用原计划

        plan_msg = SystemMessage(content=f"[执行计划]\n{plan}")
        return {"messages": [plan_msg]}

    async def agent_node(state: AgentState) -> dict:
        """模型节点：调用 LLM，返回 AI 响应（可能包含 tool_calls）。

        若消息列表开头没有 SystemMessage，自动注入 system_prompt（仅首次）。
        """
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=system_prompt)] + list(messages)
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> str:
        """路由：最后一条 AI 消息有 tool_calls → 执行工具，否则结束。"""
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    # ── 构建图 ──

    graph = StateGraph(AgentState)

    # 添加节点（model 节点命名为 "agent" 以兼容 WebSocket 回调）
    graph.add_node("planner", planner_node)
    graph.add_node("agent", agent_node)
    if tool_node is not None:
        graph.add_node("tools", tool_node)

    # 入口 → planner
    graph.set_entry_point("planner")

    # planner → agent（无条件）
    graph.add_edge("planner", "agent")

    # agent → tools | END（条件路由）
    if tool_node is not None:
        graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
        # tools → agent（工具执行后回到模型继续推理）
        graph.add_edge("tools", "agent")
    else:
        graph.add_edge("agent", END)

    return graph.compile(checkpointer=checkpointer)
