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
import time
from typing import Callable, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode
from typing_extensions import Annotated, NotRequired, TypedDict

from agent.approval_tool_node import ApprovalToolNode
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

# 匹配人格模板输出的 <mood>...</mood> 内部状态块（含可选的属性）
_MOOD_TAG_RE = re.compile(r"<mood[^>]*>.*?</mood>\s*", re.DOTALL | re.IGNORECASE)
_MAX_FAILOVER_ATTEMPTS = 5
# 兜底：匹配未闭合标签时，从 <mood> 到行尾或到下一个非 mood 行
_MOOD_UNCLOSED_RE = re.compile(
    r"<mood[^>]*>.*?(?=\n[^<\s]|\Z)", re.IGNORECASE
)


def _strip_mood_tags(message: AIMessage) -> AIMessage:
    """剥离人格模板的 <mood> 内部状态标签。

    yuan_default.md 指示 LLM 在回复开头输出 <mood> 心境记录，
    这些是内部状态，用户不应看到。此函数在 agent_node 返回前剥离它们。
    """
    content = getattr(message, "content", None)
    if not content or not isinstance(content, str):
        return message
    stripped = _MOOD_TAG_RE.sub("", content)
    # 如果标签未闭合，尝试兜底正则
    if "<mood" in stripped:
        stripped = _MOOD_UNCLOSED_RE.sub("", stripped)
    stripped = stripped.lstrip("\n").strip()
    if stripped == content.strip():
        return message  # 无变化，返回原对象避免不必要的拷贝
    if not stripped:
        stripped = " "  # 保持非空（避免空 turn）
    return AIMessage(
        content=stripped,
        tool_calls=getattr(message, "tool_calls", []) or [],
        additional_kwargs=getattr(message, "additional_kwargs", {}) or {},
        response_metadata=getattr(message, "response_metadata", {}) or {},
        id=getattr(message, "id", None),
    )


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

    # ── 编排层：coordinator 路由结果 ──
    coordinator_route: NotRequired[str]  # "direct" | "specialist" | "main"

    # ── 编排层：verifier 状态 ──
    verifier_retries: NotRequired[int]  # 当前已重试次数
    verifier_verdict: NotRequired[str]  # "sufficient" | "insufficient" | ""

    # ── Provider failover 审计字段 ──
    # 每次 agent 节点的实际调用结果。覆盖式写入避免长期会话无限增长，
    # checkpointer 的节点历史仍保留每次调用的完整轨迹。
    llm_provider_id: NotRequired[str]
    llm_model_name: NotRequired[str]
    llm_failover_trace: NotRequired[list[dict[str, str]]]
    # Explicit result of the latest model invocation.  Consumers must use this
    # metadata instead of parsing user-visible fallback text.
    llm_invocation_succeeded: NotRequired[bool]
    # A provider choice must remain stable while the current user turn is
    # executing tools.  The marker prevents this transient choice leaking into
    # the next user turn restored from the same checkpointer.
    llm_selected_provider_id: NotRequired[str]
    llm_selection_turn_marker: NotRequired[str]


def build_agent(
    model: BaseChatModel,
    tools: list[BaseTool],
    system_prompt: str,
    checkpointer: MemorySaver | None = None,
    ws=None,
    episodic_mm=None,
    enable_executor: bool | None = None,
    enable_hitl: bool = True,
    coordinator_enabled: bool | None = None,
    verifier_enabled: bool | None = None,
    verifier_max_retries: int | None = None,
    # 回调注入：Agent 不直接持有这些模块的引用，通过回调间接访问
    on_plan_confirmation: Callable | None = None,
    on_activity_event: Callable | None = None,
    # 运行时配置摘要（B6）：注入到 episodic_context，让 agent 感知自身配置
    runtime_context: str | None = None,
    # 自动情景记忆检索的会话边界。缺失时宁可不注入，也不能跨会话泄露。
    episodic_session_id: str | None = None,
    # 可选注入，正常 WebSocket 对话会从 ws.app.state 自动获取。
    # 保留显式入口，供无 WebSocket 的受控执行环境使用。
    provider_manager=None,
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

    回调注入参数（B5）：
    - on_plan_confirmation: 计划确认回调，None 时懒加载 agent.executor.request_plan_confirmation
    - on_activity_event: 活动事件记录回调，None 时懒加载 api.activity_hub.activity_hub.add
    """
    # 使用注入的回调，而非直接 import
    if on_plan_confirmation is None:
        from agent.executor import request_plan_confirmation as on_plan_confirmation
    if on_activity_event is None:
        from api.activity_hub import activity_hub
        on_activity_event = activity_hub.add

    if checkpointer is None:
        checkpointer = MemorySaver()

    # 从 settings 读取默认值
    if enable_executor is None:
        try:
            from config.settings import get_settings
            enable_executor = get_settings().executor_enable_by_default
        except Exception:
            enable_executor = True

    if coordinator_enabled is None:
        try:
            from config.settings import get_settings
            coordinator_enabled = get_settings().coordinator_enabled
        except Exception:
            coordinator_enabled = False

    if verifier_enabled is None:
        try:
            from config.settings import get_settings
            verifier_enabled = get_settings().verifier_enabled
        except Exception:
            verifier_enabled = False
    if verifier_max_retries is None:
        try:
            from config.settings import get_settings
            verifier_max_retries = get_settings().verifier_max_retries
        except Exception:
            verifier_max_retries = 2

    llm_with_tools = model.bind_tools(tools) if tools else model

    if provider_manager is None and ws is not None:
        provider_manager = getattr(getattr(getattr(ws, "app", None), "state", None), "provider_manager", None)

    def _current_turn_has_tool_effects(messages: list[BaseMessage]) -> bool:
        """Whether this turn has reached a tool result.

        Tool execution may be non-idempotent.  Once a ToolMessage exists after
        the latest user input, never replay an LLM request through another
        provider in that turn.  Older turns do not block a new turn's failover.
        """
        latest_human_index = -1
        for index in range(len(messages) - 1, -1, -1):
            if isinstance(messages[index], HumanMessage):
                latest_human_index = index
                break
        if latest_human_index < 0:
            return False
        return any(
            message.__class__.__name__ == "ToolMessage"
            for message in messages[latest_human_index + 1 :]
        )

    def _current_turn_marker(messages: list[BaseMessage]) -> str:
        """Return a stable marker for the latest user turn.

        LangChain message IDs are optional, so use the number of human
        messages as a deterministic fallback.  This is sufficient to keep a
        selected fallback across ``agent -> tools -> agent`` while ensuring a
        later user input starts from the configured primary model again.
        """
        human_messages = [message for message in messages if isinstance(message, HumanMessage)]
        if not human_messages:
            return ""
        message_id = getattr(human_messages[-1], "id", None)
        if isinstance(message_id, str) and message_id:
            return f"message:{message_id}"
        return f"human-count:{len(human_messages)}"

    def _model_name_for_audit(llm: BaseChatModel, provider) -> str:
        for attribute in ("model_name", "model"):
            value = getattr(llm, attribute, None)
            if isinstance(value, str) and value:
                return value
        return provider.default_model if provider is not None else ""

    def _build_provider_llm(provider):
        fallback_llm = provider.create_llm(
            provider.default_model,
            temperature=0.7,
            streaming=True,
        )
        return fallback_llm.bind_tools(tools) if tools else fallback_llm
    # 使用审批工具节点（可配置开关）；关闭时回退到原始 ToolNode
    if tools:
        try:
            from config.settings import get_settings
            _settings = get_settings()
        except Exception:
            _settings = None
        if _settings is not None and _settings.approval_gateway_enabled:
            tool_node = ApprovalToolNode(tools)
            logger.info("ApprovalToolNode enabled")
        else:
            tool_node = ToolNode(tools)
    else:
        tool_node = None

    # ── 节点函数（闭包捕获 model / llm_with_tools）──

    async def coordinator_node(state: AgentState) -> dict:
        """协调者节点：分类用户意图，决定路由。

        路由结果写入 state.coordinator_route，供后续条件边使用。
        简单输入短路（不调用 LLM）。任何异常安全回退到 MAIN。
        """
        from agent.coordinator import classify_intent, RouteTarget

        messages = state["messages"]
        if not messages:
            return {"coordinator_route": "main"}

        user_text = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                user_text = _extract_text_content(msg.content)
                break

        if not user_text:
            return {"coordinator_route": "main"}

        try:
            decision = await classify_intent(model, user_text)
            route = decision.target.value
            logger.info("[coordinator] route=%s rationale=%s", route, decision.rationale[:80])
            return {"coordinator_route": route}
        except Exception as e:
            logger.warning("[coordinator] 分类失败，回退到 main: %s", e)
            return {"coordinator_route": "main"}

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
            new_step_count = len(plan_steps)
            reset_status = {k: StepStatus.PENDING.value for k in old_step_status if int(k) < new_step_count}
            # 清理超出新计划长度的旧步骤状态
            for k in list(old_step_status):
                if int(k) >= new_step_count:
                    reset_status.pop(k, None)
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

            context_text = retrieve_from_episodic(
                query,
                episodic_mm,
                top_k=3,
                session_id=episodic_session_id or "",
            )
        except Exception as e:
            logger.warning("[episodic_retriever] retrieve failed: %s", e)
            context_text = ""

        return {"episodic_context": context_text}

    async def agent_node(state: AgentState) -> dict:
        """模型节点：调用 LLM，返回 AI 响应（可能包含 tool_calls）。

        始终在 LLM 调用前注入系统提示词（本地 prepend，不持久化到 state）。
        不依赖 messages[0] 的类型判断，确保压缩摘要 SystemMessage 不会
        抑制系统提示词注入（压缩后 LLM 仍保留所有人设/行为规则）。

        缓存优化（DeepSeek prompt cache）：
        SystemMessage 保持完全稳定（仅含 build_system_prompt() 输出），
        不再追加 episodic_context 等动态内容。episodic_context 改为
        prepend 到最新的 HumanMessage（本地修改，不持久化到 state），
        这样 SystemMessage + 消息历史前缀可以命中缓存。

        B6 优化：runtime_context（运行时配置摘要）也 prepend 到 HumanMessage，
        让 agent 每轮都能感知自身的 providers/MCP/工具配置全貌，
        减少执行路径的不确定性（避免"第一次能过第二次卡"的问题）。
        """
        messages = state["messages"]
        episodic_context = state.get("episodic_context", "") or ""
        # 系统提示词保持完全稳定，不追加动态内容（有利于 DeepSeek prompt cache）
        # episodic_context + runtime_context 改为 prepend 到最新 HumanMessage（本地修改，不持久化）
        # runtime_context 让 agent 每轮都能"看到"自己的配置全貌
        context_parts: list[str] = []
        if runtime_context:
            context_parts.append(runtime_context)
        if episodic_context:
            context_parts.append(f"[相关情景记忆]\n{episodic_context}")
        prepend_text = "\n\n".join(context_parts)

        msgs = list(messages)
        if prepend_text and msgs and isinstance(msgs[-1], HumanMessage):
            original_content = msgs[-1].content
            msgs[-1] = HumanMessage(
                content=f"{prepend_text}\n\n---\n\n{original_content}"
            )
        messages = [SystemMessage(content=system_prompt)] + msgs
        current_turn_marker = _current_turn_marker(msgs)
        selected_provider_id = ""
        active_llm = llm_with_tools
        active_provider = None
        previous_selection_matches_turn = (
            state.get("llm_selection_turn_marker") == current_turn_marker
        )
        if previous_selection_matches_turn and provider_manager is not None:
            candidate_provider_id = state.get("llm_selected_provider_id", "")
            if candidate_provider_id:
                try:
                    # Continue with the provider that already produced this
                    # turn's tool call.  Its health may have changed since the
                    # prior node, but changing providers after tool execution
                    # could replay a non-idempotent operation.
                    active_provider = provider_manager.get(candidate_provider_id)
                    active_llm = _build_provider_llm(active_provider)
                    selected_provider_id = candidate_provider_id
                except KeyError:
                    logger.warning(
                        "[agent_node] selected provider no longer exists: %s",
                        candidate_provider_id,
                    )
        if active_provider is None and provider_manager is not None:
            try:
                active_provider = provider_manager.find_provider_for_llm(model)
                if active_provider is not None:
                    selected_provider_id = active_provider.config.id
            except Exception as e:
                logger.warning("[agent_node] 无法识别当前模型所属提供商: %s", type(e).__name__)

        initial_model_name = _model_name_for_audit(model, active_provider)
        tool_effects_present = _current_turn_has_tool_effects(msgs)
        attempted_provider_ids: set[str] = set()
        trace: list[dict[str, str]] = []

        # A provider marked unhealthy by a prior turn is skipped before this
        # invocation.  This remains before any current-turn tool side effect.
        if (
            active_provider is not None
            and active_provider.is_unhealthy
            and not tool_effects_present
            and provider_manager is not None
        ):
            attempted_provider_ids.add(active_provider.config.id)
            fallback_provider = provider_manager.get_fallback(attempted_provider_ids)
            if fallback_provider is not None:
                trace.append({
                    "provider_id": active_provider.config.id,
                    "model_name": _model_name_for_audit(active_llm, active_provider),
                    "outcome": "skipped_unhealthy",
                })
                active_provider = fallback_provider
                active_llm = _build_provider_llm(active_provider)
                selected_provider_id = active_provider.config.id

        try:
            failover_count = 0
            while True:
                provider_id = active_provider.config.id if active_provider is not None else ""
                model_name = (
                    initial_model_name
                    if active_llm is llm_with_tools
                    else _model_name_for_audit(active_llm, active_provider)
                )
                if provider_id:
                    attempted_provider_ids.add(provider_id)
                started_at = time.monotonic()
                try:
                    _llm_timeout = 120
                    try:
                        from config.settings import get_settings
                        _llm_timeout = get_settings().llm_invoke_timeout
                    except Exception:
                        pass
                    response = await asyncio.wait_for(
                        active_llm.ainvoke(messages), timeout=_llm_timeout
                    )
                except asyncio.TimeoutError:
                    raise TimeoutError(
                        f"LLM 调用超时（{_llm_timeout}s），provider={provider_id}"
                    )
                except Exception as e:
                    retryable = False
                    if active_provider is not None and provider_manager is not None:
                        from api.providers.manager import is_retryable_provider_error

                        retryable = is_retryable_provider_error(e)
                        if retryable:
                            provider_manager.mark_unhealthy(
                                active_provider.config.id,
                                detail=f"LLM invocation failed: {type(e).__name__}",
                            )
                    trace.append({
                        "provider_id": provider_id,
                        "model_name": model_name,
                        "outcome": "retryable_error" if retryable else "error",
                        "error_type": type(e).__name__,
                    })
                    if (
                        not retryable
                        or tool_effects_present
                        or provider_manager is None
                        or active_provider is None
                    ):
                        raise

                    fallback_provider = provider_manager.get_fallback(attempted_provider_ids)
                    if fallback_provider is None:
                        raise
                    logger.warning(
                        "[agent_node] provider failover %s/%s -> %s/%s (attempt %d)",
                        active_provider.config.id,
                        model_name or "<unknown>",
                        fallback_provider.config.id,
                        fallback_provider.default_model or "<unknown>",
                        failover_count + 1,
                    )
                    failover_count += 1
                    if failover_count >= _MAX_FAILOVER_ATTEMPTS:
                        raise RuntimeError(
                            f"Provider failover exhausted after {_MAX_FAILOVER_ATTEMPTS} attempts"
                            f" (tried: {', '.join(attempted_provider_ids)})"
                        )
                    active_provider = fallback_provider
                    active_llm = _build_provider_llm(active_provider)
                    selected_provider_id = active_provider.config.id
                    continue

                latency_ms = (time.monotonic() - started_at) * 1000
                if active_provider is not None and provider_manager is not None:
                    provider_manager.mark_healthy(active_provider.config.id, latency_ms=latency_ms)
                trace.append({
                    "provider_id": provider_id,
                    "model_name": model_name,
                    "outcome": "success",
                })
                break
        except Exception as e:
            logger.error("[agent_node] LLM 调用失败: %s", type(e).__name__, exc_info=True)
            # 优雅降级：返回错误提示，避免整个 Graph 崩溃
            err_msg = AIMessage(
                content=f"（调用模型时出错：{type(e).__name__}: {str(e)[:200]}。请稍后重试或检查提供商配置。）"
            )
            return {
                "messages": [err_msg],
                "episodic_context": "",
                "llm_provider_id": trace[-1]["provider_id"] if trace else "",
                "llm_model_name": trace[-1]["model_name"] if trace else "",
                "llm_failover_trace": trace,
                "llm_invocation_succeeded": False,
                "llm_selected_provider_id": selected_provider_id,
                "llm_selection_turn_marker": current_turn_marker,
            }

        # 流式响应修复管道（通过 feature flag 控制，默认关闭）
        # 修复国产模型（GLM/DeepSeek/Moonshot）的不规范输出：
        # - 空 turn 占位注入
        # - tool 参数 JSON 修复
        # - usage 回填
        try:
            from agent.stream_repair.pipeline import apply_stream_repairs
            response = apply_stream_repairs(response, messages)
        except Exception as e:
            logger.warning("[agent_node] 流式修复管道异常: %s", e)

        # 剥离人格模板的 <mood> 内部状态标签（用户不应看到心境记录）
        response = _strip_mood_tags(response)

        return {
            "messages": [response],
            "episodic_context": "",
            "llm_provider_id": trace[-1]["provider_id"] if trace else "",
            "llm_model_name": trace[-1]["model_name"] if trace else "",
            "llm_failover_trace": trace,
            "llm_invocation_succeeded": True,
            "llm_selected_provider_id": selected_provider_id,
            "llm_selection_turn_marker": current_turn_marker,
        }

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

    async def verifier_node(state: AgentState) -> dict:
        """验证节点：评分 agent 最终答案的充分性。

        sufficient 或重试耗尽 → END（由 should_continue_from_verifier 路由）
        insufficient 且仍有重试 → 注入 gap SystemMessage，路由回 agent
        """
        from agent.verifier import grade_answer, Verdict

        messages = state["messages"]
        if not messages:
            return {"verifier_verdict": "sufficient"}

        # 取最后一条无 tool_calls 的 AIMessage 作为答案
        answer = ""
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and not getattr(msg, "tool_calls", None):
                answer = msg.content if isinstance(msg.content, str) else str(msg.content)
                break

        # 取用户原始问题
        question = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                question = _extract_text_content(msg.content)
                break

        retries = state.get("verifier_retries", 0)

        try:
            verdict = await grade_answer(model, question, answer)
        except Exception as e:
            logger.warning("[verifier] 评分失败，放行: %s", e)
            return {"verifier_verdict": "sufficient"}

        if verdict.is_sufficient():
            logger.info("[verifier] sufficient, 放行")
            return {"verifier_verdict": "sufficient"}

        # insufficient
        if retries >= verifier_max_retries:
            logger.info("[verifier] insufficient 但重试耗尽 (%d/%d), 放行", retries, verifier_max_retries)
            return {"verifier_verdict": "sufficient"}

        # 注入 gap，路由回 agent
        gaps_text = "; ".join(verdict.gaps) if verdict.gaps else "答案不够充分"
        gap_msg = SystemMessage(
            content=f"[验证反馈] 你的回答还不够充分：{gaps_text}。请补充这些内容后重新回答。"
        )
        logger.info("[verifier] insufficient (retry %d/%d), gaps: %s", retries + 1, verifier_max_retries, gaps_text)
        return {
            "messages": [gap_msg],
            "verifier_retries": retries + 1,
            "verifier_verdict": "insufficient",
        }

    def should_continue_from_verifier(state: AgentState) -> str:
        """verifier 后路由：sufficient → END；insufficient → agent。"""
        verdict = state.get("verifier_verdict", "sufficient")
        if verdict == "insufficient":
            return "agent"
        return END

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
        # 无 tool_calls
        # executor 模式下回 executor 推进步骤
        if enable_executor and state.get("plan_steps"):
            return "executor"
        # verifier 启用时路由到 verifier，否则直接结束
        if verifier_enabled:
            return "verifier"
        return END

    # ── 构建图 ──

    graph = StateGraph(AgentState)

    # 添加节点（model 节点命名为 "agent" 以兼容 WebSocket 回调）
    graph.add_node("planner", planner_node)
    if coordinator_enabled:
        graph.add_node("coordinator", coordinator_node)
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
            on_plan_confirmation=on_plan_confirmation,
            on_activity_event=on_activity_event,
        )
        graph.add_node("executor", executor_node)

    graph.add_node("agent", agent_node)
    # 阶段 5.2：循环终止节点（检测到死循环时注入终止消息后结束）
    graph.add_node("loop_breaker", loop_breaker_node)
    if verifier_enabled:
        graph.add_node("verifier", verifier_node)
    if tool_node is not None:
        graph.add_node("tools", tool_node)

    # 入口：coordinator 启用时先走 coordinator → planner，否则直接 planner
    if coordinator_enabled:
        graph.set_entry_point("coordinator")
        graph.add_edge("coordinator", "planner")
    else:
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

        # agent → tools | loop_breaker | executor | verifier | END（条件路由）
        # loop_breaker → END（死循环终止后直接结束）
        if tool_node is not None:
            _agent_targets = {"tools": "tools", "loop_breaker": "loop_breaker", "executor": "executor", END: END}
            if verifier_enabled:
                _agent_targets["verifier"] = "verifier"
            graph.add_conditional_edges(
                "agent",
                should_continue,
                _agent_targets,
            )
            # tools → agent（工具执行后回到模型继续推理）
            graph.add_edge("tools", "agent")
        else:
            _agent_targets = {"loop_breaker": "loop_breaker", "executor": "executor", END: END}
            if verifier_enabled:
                _agent_targets["verifier"] = "verifier"
            graph.add_conditional_edges(
                "agent",
                should_continue,
                _agent_targets,
            )
        graph.add_edge("loop_breaker", END)
    else:
        # 非 executor 模式（子 Agent）：agent → tools | loop_breaker | verifier | END
        if tool_node is not None:
            _agent_targets = {"tools": "tools", "loop_breaker": "loop_breaker", END: END}
            if verifier_enabled:
                _agent_targets["verifier"] = "verifier"
            graph.add_conditional_edges(
                "agent",
                should_continue,
                _agent_targets,
            )
            graph.add_edge("tools", "agent")
        else:
            if verifier_enabled:
                graph.add_conditional_edges(
                    "agent",
                    should_continue,
                    {"loop_breaker": "loop_breaker", "verifier": "verifier", END: END},
                )
            else:
                graph.add_edge("agent", END)
        graph.add_edge("loop_breaker", END)

    if verifier_enabled:
        graph.add_conditional_edges(
            "verifier",
            should_continue_from_verifier,
            {"agent": "agent", END: END},
        )

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
