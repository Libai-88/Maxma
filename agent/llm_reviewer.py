# agent/llm_reviewer.py
"""双层 LLM 审批审查器。

small reviewer 初审（只批 low risk），large reviewer 终审（最终风险决策）。
小模型不敢批的升级大模型，平衡成本和准确性。
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)

REVIEWER_SYSTEM_PROMPT = """你是一个工具调用安全审查器。评估以下工具调用是否安全执行。

返回 JSON 格式：
{
  "action": "allow" | "deny_and_continue" | "ask_user" | "escalate",
  "reason": "简短理由",
  "risk": "low" | "medium" | "high" | "critical",
  "saferAlternative": "如果有更安全的替代方案，简要说明",
  "ruleIds": ["触发的规则ID"]
}

规则：
- 只允许明显的低风险、在范围内的操作
- 高风险/关键风险操作必须 escalate 或 ask_user
- 不扩展沙盒、不放宽网络策略
"""


class ReviewAction(Enum):
    ALLOW = "allow"
    DENY_AND_CONTINUE = "deny_and_continue"
    ASK_USER = "ask_user"
    ESCALATE = "escalate"


@dataclass
class ReviewResult:
    action: ReviewAction
    reason: str = ""
    risk: str = "medium"
    safer_alternative: str = ""
    rule_ids: list[str] | None = None
    reviewed_by: str = ""  # "small" | "large" | "fallback"


class LLMReviewer:
    """双层 LLM 审查器。"""

    def __init__(self, *, small_llm: Any = None, large_llm: Any = None) -> None:
        self._small_llm = small_llm
        self._large_llm = large_llm

    async def review(
        self,
        *,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
    ) -> ReviewResult:
        """审查工具调用。"""
        # 1. 如果小模型不可用，直接 ask_user
        if self._small_llm is None:
            return ReviewResult(
                action=ReviewAction.ASK_USER,
                reason="No reviewer available",
                risk="unknown",
                reviewed_by="fallback",
            )

        # 2. 小模型初审
        small_result = await self._review_with_llm(
            self._small_llm, tool_name, tool_input, session_id, "small"
        )

        # 3. 小模型允许且低风险 → 直接返回
        if small_result.action == ReviewAction.ALLOW and small_result.risk == "low":
            return small_result

        # 4. 小模型要求升级或风险较高 → 大模型终审
        if small_result.action == ReviewAction.ESCALATE or small_result.risk in ("high", "critical"):
            if self._large_llm is not None:
                large_result = await self._review_with_llm(
                    self._large_llm, tool_name, tool_input, session_id, "large"
                )
                if large_result.action == ReviewAction.ALLOW:
                    return large_result
                # 大模型不允许 → fallback 到 small_result
                return large_result

        # 5. 都不行 → ask_user
        if small_result.action == ReviewAction.ASK_USER:
            return small_result

        return small_result

    async def _review_with_llm(
        self,
        llm: Any,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
        reviewer_name: str,
    ) -> ReviewResult:
        """用指定 LLM 审查。"""
        try:
            user_msg = (
                f"工具: {tool_name}\n"
                f"输入: {json.dumps(tool_input, ensure_ascii=False, default=str)[:500]}\n"
                f"会话: {session_id}"
            )
            response = await llm.ainvoke(user_msg)
            raw = response.content if hasattr(response, 'content') else str(response)
            if isinstance(raw, list):
                content = "".join(b.get("text", "") for b in raw if isinstance(b, dict) and b.get("type") == "text")
            else:
                content = str(raw)

            return self._parse_review_response(content, reviewer_name)
        except Exception as e:
            logger.error(f"LLM reviewer ({reviewer_name}) failed: {e}")
            return ReviewResult(
                action=ReviewAction.ASK_USER,
                reason=f"Reviewer error: {e}",
                risk="unknown",
                reviewed_by=reviewer_name,
            )

    def _parse_review_response(self, content: str, reviewer_name: str) -> ReviewResult:
        """解析 LLM 审查响应。"""
        # 去掉 markdown fence
        content = re.sub(r'^```json\s*', '', content.strip())
        content = re.sub(r'\s*```$', '', content)

        try:
            data = json.loads(content)
            action = ReviewAction(data.get("action", "ask_user"))
            return ReviewResult(
                action=action,
                reason=data.get("reason", ""),
                risk=data.get("risk", "medium"),
                safer_alternative=data.get("saferAlternative", ""),
                rule_ids=data.get("ruleIds", []),
                reviewed_by=reviewer_name,
            )
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Failed to parse reviewer response: {e}")
            return ReviewResult(
                action=ReviewAction.ASK_USER,
                reason="Unparseable reviewer response",
                risk="unknown",
                reviewed_by=reviewer_name,
            )
