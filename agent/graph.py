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
import re

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

_SIMPLE_CHAT_RE = re.compile(
    r"^(?:你好(?:呀)?|您好|hello|hi|hey|在吗|在不在|谢谢(?:你)?|thanks|thank you|"
    r"好的|ok|okay|收到|明白|再见|拜拜|早上好|中午好|晚上好|辛苦了|哈哈+|嗯+|喂)"
    r"[!,.，。？！~\s]*$",
    re.IGNORECASE,
)
_COMPLEXITY_HINTS = (
    "然后",
    "再",
    "同时",
    "并行",
    "分别",
    "对比",
    "比较",
    "分析",
    "研究",
    "调查",
    "排查",
    "定位",
    "修复",
    "重构",
    "实现",
    "设计",
    "规划",
    "计划",
    "步骤",
    "清单",
    "todo",
    "phase",
    "阶段",
    "汇总",
    "总结",
    "审查",
    "review",
    "debug",
    "bug",
    "测试",
    "构建",
    "部署",
    "迁移",
    "优化",
    "写一个",
    "写个",
    "做一个",
    "做个",
    "创建",
    "生成",
    "开发",
)


def _should_skip_planner(user_text: str) -> bool:
    """对明显简单的输入做本地短路，避免每轮都额外调用 planner。"""
    text = user_text.strip()
    if not text:
        return True

    normalized = " ".join(text.split())
    if _SIMPLE_CHAT_RE.fullmatch(normalized):
        return True

    if "\n" in text or len(normalized) > 48:
        return False

    if "```" in text or "http://" in text or "https://" in text or "\\" in text:
        return False

    if re.search(r"(?:^|\s)\d+[.)]", normalized):
        return False

    lower_text = normalized.lower()
    if any(hint in lower_text for hint in _COMPLEXITY_HINTS):
        return False

    punctuation_count = sum(normalized.count(ch) for ch in "。？！!?；;")
    if punctuation_count >= 2:
        return False

    return len(normalized) <= 20 or normalized.endswith(("吗", "么", "呢", "?", "？"))


class AgentState(TypedDict):
    """Agent 图状态。"""
    messages: Annotated[list[BaseMessage], add_messages]


async def _request_plan_confirmation(
    *,
    ws,
    interaction,
    plan_id: str,
    steps: list[str],
    plan: str,
    timeout: float = 120,
):
    """发送计划确认请求并确保所有 pending 映射最终被清理。"""
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
        return await asyncio.wait_for(future, timeout=timeout)
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

        # 提取用户消息文本（支持多模态 content list）
        user_text = _extract_text_content(last_msg.content)
        if _should_skip_planner(user_text):
            logger.debug("Skipping planner for simple turn: %s", user_text[:60])
            return {}

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
            response = await _request_plan_confirmation(
                ws=ws,
                interaction=interaction,
                plan_id=plan_id,
                steps=steps,
                plan=plan,
            )

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

        始终在 LLM 调用前注入系统提示词（本地 prepend，不持久化到 state）。
        不依赖 messages[0] 的类型判断，确保压缩摘要 SystemMessage 不会
        抑制系统提示词注入（压缩后 LLM 仍保留所有人设/行为规则）。
        """
        messages = state["messages"]
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


def _extract_text_content(content) -> str:
    """从消息 content 中提取可读文本，支持多模态 content list。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            elif isinstance(block, dict):
                import json
                parts.append(json.dumps(block, ensure_ascii=False))
            else:
                parts.append(str(block))
        return " ".join(p for p in parts if p)
    return str(content) if content is not None else ""
