"""Coordinator 意图分类与路由决策。

来源：ai_home_renovation_agent 的 coordinator/dispatcher 模式 +
ag2_adaptive_research_team 的 triage 路由思想。

职责：取用户消息 + 人设上下文，返回 RoutingDecision。
不修改图状态、不执行 I/O。图节点函数（coordinator_node in graph.py）
负责把 RoutingDecision 写入 state。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from enum import Enum
from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class RouteTarget(str, Enum):
    """路由目标。"""
    DIRECT = "direct"
    SPECIALIST = "specialist"
    MAIN = "main"


class RoutingDecision(BaseModel):
    """路由决策结果。"""
    target: RouteTarget = Field(description="路由目标")
    specialist: Optional[str] = Field(
        default=None,
        description="专家名称（仅 SPECIALIST 路由时有效，如 'research'/'coding'/'analysis'）",
    )
    rationale: str = Field(default="", description="路由理由（供审计/调试）")


_SIMPLE_CHAT_RE = re.compile(
    r"^(?:你好(?:呀)?|您好|hello|hi|hey|在吗|在不在|谢谢(?:你)?|thanks|thank you|"
    r"好的|ok|okay|收到|明白|再见|拜拜|早上好|中午好|晚上好|辛苦了|哈哈+|嗯+|喂)"
    r"[!,.，。？！~\s]*$",
    re.IGNORECASE,
)


def _should_skip_coordinator(user_text: str) -> bool:
    """对明显简单的输入短路，避免每轮都额外调用 coordinator LLM。

    与 graph.py 的 _should_skip_planner 保持一致，确保 coordinator
    不会对问候/确认类输入浪费 token。
    """
    text = user_text.strip()
    if not text:
        return True
    normalized = " ".join(text.split())
    if _SIMPLE_CHAT_RE.fullmatch(normalized):
        return True
    return False


def _llm_timeout() -> float:
    """获取 LLM 调用超时（秒），回退默认 120s。"""
    try:
        from config.settings import get_settings

        return get_settings().llm_invoke_timeout
    except Exception:
        return 120.0


async def classify_intent(
    model: BaseChatModel,
    user_text: str,
    persona_context: str = "",
) -> RoutingDecision:
    """分类用户意图，返回路由决策。

    简单输入短路（不调用 LLM）。复杂输入调用 LLM 返回严格 JSON。
    任何异常（JSON 解析失败 / LLM 错误）安全回退到 MAIN，
    确保 coordinator 永不阻塞主流程。

    Args:
        model: LLM 模型（建议用廉价模型，coordinator 是分类任务）
        user_text: 用户消息文本
        persona_context: 当前人设上下文（可选，影响 specialist 选择）

    Returns:
        RoutingDecision
    """
    if _should_skip_coordinator(user_text):
        return RoutingDecision(
            target=RouteTarget.DIRECT,
            rationale="简单输入短路",
        )

    try:
        from agent.prompts import build_coordinator_prompt

        prompt = build_coordinator_prompt(persona_context=persona_context)
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_text)]
        response = await asyncio.wait_for(
            model.ainvoke(messages),
            timeout=_llm_timeout(),
        )
        content = response.content if isinstance(response.content, str) else str(response.content)

        decision = _parse_routing_json(content)
        if decision is not None:
            return decision

        logger.warning("[coordinator] JSON 解析失败，回退到 MAIN: %s", content[:200])
        return RoutingDecision(
            target=RouteTarget.MAIN,
            rationale=f"JSON 解析失败，安全回退: {content[:100]}",
        )
    except Exception as e:
        logger.warning("[coordinator] LLM 调用失败，回退到 MAIN: %s", e)
        return RoutingDecision(
            target=RouteTarget.MAIN,
            rationale=f"LLM 异常，安全回退: {type(e).__name__}",
        )


def _parse_routing_json(content: str) -> RoutingDecision | None:
    """从 LLM 输出解析路由 JSON，容错处理。

    支持：纯 JSON / 带 ```json 代码块 / 前后有多余文本。
    """
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if json_match:
        content = json_match.group(1)
    else:
        brace_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if brace_match:
            content = brace_match.group(0)

    try:
        data = json.loads(content)
        target_str = data.get("target", "main").lower()
        try:
            target = RouteTarget(target_str)
        except ValueError:
            return None
        return RoutingDecision(
            target=target,
            specialist=data.get("specialist"),
            rationale=data.get("rationale", ""),
        )
    except (json.JSONDecodeError, TypeError):
        return None
