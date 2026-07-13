"""Verifier 答案充分性评分 — ReAct 循环的正确性闸门。

来源：ag2_adaptive_research_team 的 triage→verifier→synthesizer 三明治模式。
职责：取 agent 的最终答案 + 原始问题 + 检索证据，判定答案是否充分。
不修改图状态。图节点函数（verifier_node in graph.py）负责把 Verdict 写入 state
并决定是否路由回 agent 重试。

安全回退策略：任何异常（LLM 错误 / JSON 解析失败）都回退到 sufficient，
确保 verifier 永不阻塞用户拿到答案——它是质量增强，不是硬闸门。
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_MIN_ANSWER_LENGTH_TO_VERIFY = 10


class Verdict(BaseModel):
    """验证判定结果。"""
    verdict: str = Field(description="sufficient 或 insufficient")
    gaps: list[str] = Field(default_factory=list, description="不足之处的具体描述")
    rationale: str = Field(default="", description="判定理由（供审计/调试）")

    def is_sufficient(self) -> bool:
        """是否充分。非 sufficient 的任何值都视为不充分。"""
        return self.verdict.lower() == "sufficient"


def should_verify(answer: str) -> bool:
    """答案是否值得验证。

    过短的答案（如错误降级消息 "出错了"）跳过验证，
    避免无意义 LLM 调用并直接放行。
    """
    return len(answer.strip()) >= _MIN_ANSWER_LENGTH_TO_VERIFY


def _llm_timeout() -> float:
    """获取 LLM 调用超时（秒），回退默认 120s。"""
    try:
        from config.settings import get_settings

        return get_settings().llm_invoke_timeout
    except Exception:
        return 120.0


async def grade_answer(
    model: BaseChatModel,
    question: str,
    answer: str,
    evidence: str = "",
) -> Verdict:
    """评分答案充分性。

    短答案短路（不调用 LLM，直接放行）。正常答案调用 LLM 返回严格 JSON。
    任何异常安全回退到 sufficient（verifier 是质量增强，不是硬闸门）。

    Args:
        model: LLM 模型（建议用廉价模型，verifier 是判定任务）
        question: 用户原始问题
        answer: agent 的最终答案
        evidence: 检索到的证据（可选，KB/工具输出摘要）

    Returns:
        Verdict
    """
    if not should_verify(answer):
        return Verdict(
            verdict="sufficient",
            rationale="答案过短，跳过验证直接放行",
        )

    try:
        from agent.prompts import build_verifier_prompt

        prompt = build_verifier_prompt()
        user_msg = _build_user_msg(question, answer, evidence)
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_msg)]
        response = await asyncio.wait_for(
            model.ainvoke(messages),
            timeout=_llm_timeout(),
        )
        content = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )

        verdict = _parse_verdict_json(content)
        if verdict is not None:
            return verdict

        logger.warning("[verifier] JSON 解析失败，回退到 sufficient: %s", content[:200])
        return Verdict(
            verdict="sufficient",
            rationale=f"JSON 解析失败，安全回退: {content[:100]}",
        )
    except Exception as e:
        logger.warning("[verifier] LLM 调用失败，回退到 sufficient: %s", e)
        return Verdict(
            verdict="sufficient",
            rationale=f"LLM 异常，安全回退: {type(e).__name__}",
        )


def _build_user_msg(question: str, answer: str, evidence: str) -> str:
    """构建 verifier 的用户消息（含原始问题、答案、证据）。"""
    parts = [f"## 用户问题\n{question}", f"## Agent 答案\n{answer}"]
    if evidence:
        parts.append(f"## 检索证据\n{evidence}")
    return "\n\n".join(parts)


def _parse_verdict_json(content: str) -> Verdict | None:
    """从 LLM 输出解析判定 JSON，容错处理。"""
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if json_match:
        content = json_match.group(1)
    else:
        brace_match = re.search(r"\{[^{}]*\}", content, re.DOTALL)
        if brace_match:
            content = brace_match.group(0)

    try:
        data = json.loads(content)
        return Verdict(
            verdict=data.get("verdict", "sufficient"),
            gaps=data.get("gaps", []),
            rationale=data.get("rationale", ""),
        )
    except (json.JSONDecodeError, TypeError):
        return None
