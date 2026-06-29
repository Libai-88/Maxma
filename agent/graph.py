"""Agent 图构建 — 带规划节点的 ReAct Agent。

图结构::

    planner → model ↔ tools
                ↓
              END

- planner: 判断任务复杂度，复杂任务注入计划 SystemMessage
- model（节点名 "agent"）: 调用 LLM，决定是否使用工具
- tools（节点名 "tools"）: 执行工具调用，返回结果
"""

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

from agent.planner import classify_and_plan

logger = logging.getLogger(__name__)


class AgentState(TypedDict):
    """Agent 图状态。"""
    messages: Annotated[list[BaseMessage], add_messages]


def build_agent(
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    checkpointer: MemorySaver | None = None,
) -> CompiledStateGraph:
    """构建带规划节点的 ReAct Agent 图。

    若提供 checkpointer 则复用（跨轮次持久化状态），
    否则每次新建 MemorySaver（原有行为）。
    """
    if checkpointer is None:
        checkpointer = MemorySaver()

    llm_with_tools = model.bind_tools(tools) if tools else model
    tool_node = ToolNode(tools) if tools else None

    # ── 节点函数（闭包捕获 model / llm_with_tools）──

    async def planner_node(state: AgentState) -> dict:
        """规划节点：单次 LLM 调用判断复杂度 + 生成计划。"""
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
