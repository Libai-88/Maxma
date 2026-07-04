"""Agent 图构建 — 带规划节点的 ReAct Agent。

图结构（enable_executor=True，阶段 2 默认）::

    planner → executor → agent ↔ tools
                 ↑           |
                 └───────────┘
                 (每步完成后 regain 控制权)

图结构（enable_executor=False，子 Agent 用）::

    planner → episodic_retriever → model ↔ tools
                                     ↓
                                   END

- planner: 判断任务复杂度，复杂任务生成结构化计划写入 state
- executor: 步骤级执行驱动 + HITL 确认 + 失败重规划路由
- episodic_retriever: 从情景记忆检索相关历史对话（4 层架构，可选）
- model（节点名 "agent"）: 调用 LLM，决定是否使用工具
- tools（节点名 "tools"）: 执行工具调用，返回结果
"""

import asyncio
import logging
import re
from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from typing_extensions import Annotated, TypedDict

from agent.planner import (
    classify_and_plan,
    parse_plan_steps,
    parse_plan_to_steps,
    PLAN_CONFIRM_THRESHOLD,
)
from agent.step_state import merge_dicts, StepStatus
from agent.executor import (
    make_executor_node,
    make_executor_router,
    request_plan_confirmation as _request_plan_confirmation,  # 向后兼容 re-export
)

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
    """Agent 图状态。

    阶段 2 扩展：新增步骤状态机字段，用于 executor 节点驱动 plan-and-execute。
    所有新字段使用覆盖式更新（无 Annotated reducer 即默认覆盖），
    除 step_status 使用 merge_dicts 合并更新。
    """
    # 原有字段
    messages: Annotated[list[BaseMessage], add_messages]
    episodic_context: str

    # ── 阶段 2：步骤状态机字段 ──
    # 计划步骤列表（list[dict]，每项为 PlanStep.to_dict()）
    plan_steps: list[dict]
    # 当前步骤索引（0-based，覆盖式）
    current_step_index: int
    # 步骤状态：{step_index_str: StepStatus.value}（合并式，避免覆盖丢失）
    step_status: Annotated[dict, merge_dicts]
    # 并行组列表（list[list[int]]，每组是步骤索引列表）
    parallel_groups: list[list[int]]
    # 当前步骤失败次数（覆盖式）
    failure_count: int
    # 最后失败的步骤描述（覆盖式）
    last_failed_step: str
    # 计划是否已确认（HITL）（覆盖式）
    plan_confirmed: bool
    # 重规划次数（覆盖式）
    replan_count: int
    # 原始计划文本（供 replan 使用）（覆盖式）
    plan_text: str


def build_agent(
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    checkpointer: MemorySaver | None = None,
    ws=None,
    episodic_mm=None,
    enable_executor: bool | None = None,
    enable_hitl: bool = True,
) -> CompiledStateGraph:
    """构建带规划节点的 ReAct Agent 图。

    若提供 checkpointer 则复用（跨轮次持久化状态），
    否则每次新建 MemorySaver（原有行为）。
    若提供 ws（WebSocket），复杂计划将发送 plan_proposed 事件等待用户确认。
    若提供 episodic_mm（EpisodicMemoryManager），将注入 episodic_retriever 节点，
    在每轮 LLM 调用前从情景记忆层检索相关历史对话。

    阶段 2 新增参数：
    - enable_executor: 是否启用 executor 节点（plan-and-execute 步骤级驱动）。
      None 时从 settings.executor_enable_by_default 读取。子 Agent 应传 False。
    - enable_hitl: 是否启用 HITL 计划确认。事件钩子场景应传 False。
    """
    if checkpointer is None:
        checkpointer = MemorySaver()

    # 从 settings 读取默认值
    if enable_executor is None:
        try:
            from config.settings import get_settings
            enable_executor = get_settings().executor_enable_by_default
        except Exception:
            enable_executor = True

    llm_with_tools = model.bind_tools(tools) if tools else model
    tool_node = ToolNode(tools) if tools else None

    # ── 节点函数（闭包捕获 model / llm_with_tools）──

    async def planner_node(state: AgentState) -> dict:
        """规划节点：单次 LLM 调用判断复杂度 + 生成计划。

        阶段 2 重构：
        - enable_executor=True：生成结构化计划写入 state（plan_steps/plan_text），
          不再直接注入 SystemMessage，由 executor 节点驱动步骤执行
        - enable_executor=False：生成计划后注入 SystemMessage（原有行为）
        """
        messages = state["messages"]
        if not messages:
            return {}

        # 重规划场景：检查最后一条消息是否是 [重规划请求]
        # 如果是，调用 replan 而非 classify_and_plan
        last_msg = messages[-1]
        if isinstance(last_msg, SystemMessage):
            content = last_msg.content if isinstance(last_msg.content, str) else str(last_msg.content)
            if content.startswith("[重规划请求]"):
                return await _handle_replan(state, content)

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

        if enable_executor:
            # executor 模式：结构化解析写入 state，不注入 SystemMessage
            plan_steps = parse_plan_to_steps(plan)
            if not plan_steps:
                return {}
            # 显式重置旧 step_status：merge_dicts reducer 不会因返回 {} 而清空，
            # 需要把旧 key 显式设为 PENDING 以避免新计划命中旧状态
            old_step_status = state.get("step_status", {})
            reset_status = {k: StepStatus.PENDING.value for k in old_step_status}
            return {
                "plan_steps": [s.to_dict() for s in plan_steps],
                "plan_text": plan,
                "current_step_index": 0,
                "step_status": reset_status,
                "failure_count": 0,
                "replan_count": 0,
                "plan_confirmed": False,
            }
        else:
            # 非 executor 模式（子 Agent）：保持原有行为，注入 SystemMessage
            # 不做 HITL 确认（子 Agent 无需用户交互）
            plan_msg = SystemMessage(content=f"[执行计划]\n{plan}")
            return {"messages": [plan_msg]}

    async def _handle_replan(state: AgentState, replan_request: str) -> dict:
        """处理重规划请求：调用 replan 生成修订计划。

        从 [重规划请求] SystemMessage 中提取失败上下文，
        调用 planner.replan 生成修订计划，写入 state。
        """
        from agent.planner import replan as do_replan

        original_plan = state.get("plan_text", "")
        try:
            # 去掉 [重规划请求] 前缀，将完整上下文传给 replan
            context = replan_request.replace("[重规划请求]\n", "", 1).strip()
            output = await do_replan(
                model=model,
                original_plan=original_plan,
                replan_context=context,
            )
        except Exception as e:
            logger.warning("Replan generation failed: %s", e)
            return {}

        if not output:
            return {}

        # 解析修订计划
        new_steps = parse_plan_to_steps(output)
        if not new_steps:
            return {}

        logger.info("Replan generated: %d steps", len(new_steps))
        # 显式重置旧 step_status（merge_dicts reducer 不会因返回 {} 而清空）
        old_step_status = state.get("step_status", {})
        reset_status = {k: StepStatus.PENDING.value for k in old_step_status}
        return {
            "plan_steps": [s.to_dict() for s in new_steps],
            "plan_text": output,
            "current_step_index": 0,
            "step_status": reset_status,
            "failure_count": 0,  # 重置失败计数
            "plan_confirmed": False,  # 重新触发 HITL（如果配置）
        }

    async def episodic_retriever_node(state: AgentState) -> dict:
        """情景记忆检索节点（4 层架构）：从情景记忆层检索相关历史对话。

        使用用户最近一条消息作为 query，调用 EpisodicMemoryManager.retrieve，
        把结果写入 state.episodic_context 供 agent_node 注入到系统提示词。
        无 episodic_mm 或检索失败时返回空字符串（不阻塞主流程）。
        """
        if episodic_mm is None:
            return {"episodic_context": ""}

        messages = state["messages"]
        if not messages:
            return {"episodic_context": ""}

        # 取最近一条 HumanMessage 作为 query
        query = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                query = _extract_text_content(msg.content)
                break

        if not query:
            return {"episodic_context": ""}

        try:
            from agent.context_manager import retrieve_from_episodic

            context_text = retrieve_from_episodic(query, episodic_mm, top_k=3)
        except Exception as e:
            logger.warning("[episodic_retriever] retrieve failed: %s", e)
            context_text = ""

        return {"episodic_context": context_text}

    async def agent_node(state: AgentState) -> dict:
        """模型节点：调用 LLM，返回 AI 响应（可能包含 tool_calls）。

        始终在 LLM 调用前注入系统提示词（本地 prepend，不持久化到 state）。
        不依赖 messages[0] 的类型判断，确保压缩摘要 SystemMessage 不会
        抑制系统提示词注入（压缩后 LLM 仍保留所有人设/行为规则）。
        若 episodic_context 非空，将其追加到系统提示词后供 LLM 参考。
        """
        messages = state["messages"]
        episodic_context = state.get("episodic_context", "") or ""
        # 系统提示词 + 情景记忆上下文（本地拼接，不持久化）
        prompt = system_prompt
        if episodic_context:
            prompt = f"{system_prompt}\n\n{episodic_context}"
        messages = [SystemMessage(content=prompt)] + list(messages)
        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response], "episodic_context": ""}

    async def loop_breaker_node(state: AgentState) -> dict:
        """循环终止节点：注入 ToolMessage + SystemMessage 后结束。

        当 should_continue 检测到死循环时路由到此节点。
        为 last AIMessage 的每个 tool_call 生成"已取消"的 ToolMessage，
        避免下轮 "tool_calls without corresponding ToolMessage" 错误，
        并追加 SystemMessage 通知 LLM 已终止循环、需向用户说明情况。
        """
        from agent.loop_detector import get_loop_break_messages

        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            break_msgs = get_loop_break_messages(last)
            logger.warning(
                "[loop_detector] 检测到死循环，已终止重复工具调用: %s",
                [tc.get("name", "") for tc in last.tool_calls],
            )
            return {"messages": break_msgs}
        return {}

    def should_continue(state: AgentState) -> str:
        """路由：最后一条 AI 消息有 tool_calls → 执行工具，否则结束或回 executor。

        阶段 2 扩展：
        - enable_executor=True 且有计划 → agent 完成后回 executor（步骤推进）
        - 其他情况 → END

        阶段 5.2 扩展：
        - 检测到死循环 → 路由到 loop_breaker 节点注入终止消息后 END
        """
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            # 阶段 5.2：死循环检测（在路由到 tools 之前）
            try:
                from config.settings import get_settings
                ld_enabled = get_settings().loop_detection_enabled
                ld_threshold = get_settings().loop_detection_threshold
            except Exception:
                ld_enabled = True
                ld_threshold = 3
            if ld_enabled:
                from agent.loop_detector import detect_loop
                if detect_loop(state["messages"], threshold=ld_threshold):
                    return "loop_breaker"
            return "tools"
        # 无 tool_calls：executor 模式下回 executor 推进步骤，否则结束
        if enable_executor and state.get("plan_steps"):
            return "executor"
        return END

    # ── 构建图 ──

    graph = StateGraph(AgentState)

    # 添加节点（model 节点命名为 "agent" 以兼容 WebSocket 回调）
    graph.add_node("planner", planner_node)
    if episodic_mm is not None:
        graph.add_node("episodic_retriever", episodic_retriever_node)

    if enable_executor:
        # 读取 executor 配置
        try:
            from config.settings import get_settings
            settings = get_settings()
            plan_confirm_timeout = settings.plan_confirm_timeout
            replan_threshold = settings.replan_threshold
            max_replans = settings.executor_max_replans
        except Exception:
            plan_confirm_timeout = 120
            replan_threshold = 2
            max_replans = 2

        # 创建 executor 节点
        try:
            from api import interaction as interaction_module
        except ImportError:
            interaction_module = None

        # 阶段 2.3：注入 ErrorRecoveryManager + PerformanceMonitor 全局单例
        # （测试场景传 None 隔离状态，生产场景用全局单例累积跨会话失败统计）
        try:
            from agent.error_recovery import get_recovery_manager
            recovery_manager = get_recovery_manager()
        except Exception:
            recovery_manager = None
        try:
            from agent.performance import get_performance_monitor
            performance_monitor = get_performance_monitor()
        except Exception:
            performance_monitor = None

        executor_node = make_executor_node(
            ws=ws,
            interaction_module=interaction_module,
            system_prompt=system_prompt,
            enable_hitl=enable_hitl,
            plan_confirm_timeout=plan_confirm_timeout,
            replan_threshold=replan_threshold,
            max_replans=max_replans,
            recovery_manager=recovery_manager,
            performance_monitor=performance_monitor,
        )
        graph.add_node("executor", executor_node)

    graph.add_node("agent", agent_node)
    # 阶段 5.2：循环终止节点（检测到死循环时注入终止消息后结束）
    graph.add_node("loop_breaker", loop_breaker_node)
    if tool_node is not None:
        graph.add_node("tools", tool_node)

    # 入口 → planner
    graph.set_entry_point("planner")

    # planner → episodic_retriever → executor/agent（条件：episodic_mm 可用）
    if episodic_mm is not None:
        graph.add_edge("planner", "episodic_retriever")
        if enable_executor:
            graph.add_edge("episodic_retriever", "executor")
        else:
            graph.add_edge("episodic_retriever", "agent")
    else:
        if enable_executor:
            graph.add_edge("planner", "executor")
        else:
            graph.add_edge("planner", "agent")

    if enable_executor:
        # executor → agent | planner(replan) | END（条件路由）
        executor_router = make_executor_router(max_replans=max_replans)
        graph.add_conditional_edges(
            "executor",
            executor_router,
            {"agent": "agent", "planner": "planner", END: END},
        )

        # agent → tools | loop_breaker | executor | END（条件路由）
        # loop_breaker → END（死循环终止后直接结束）
        if tool_node is not None:
            graph.add_conditional_edges(
                "agent",
                should_continue,
                {"tools": "tools", "loop_breaker": "loop_breaker", "executor": "executor", END: END},
            )
            # tools → agent（工具执行后回到模型继续推理）
            graph.add_edge("tools", "agent")
        else:
            graph.add_conditional_edges(
                "agent",
                should_continue,
                {"loop_breaker": "loop_breaker", "executor": "executor", END: END},
            )
        graph.add_edge("loop_breaker", END)
    else:
        # 非 executor 模式（子 Agent）：agent → tools | loop_breaker | END
        if tool_node is not None:
            graph.add_conditional_edges(
                "agent",
                should_continue,
                {"tools": "tools", "loop_breaker": "loop_breaker", END: END},
            )
            graph.add_edge("tools", "agent")
        else:
            graph.add_edge("agent", END)
        graph.add_edge("loop_breaker", END)

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
