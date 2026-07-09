"""KB 查询重写 — pre-retrieval 优化。

来源：rag_failure_diagnostics_clinic 的 P02 修复（对话式查询 embed 效果差）。
职责：取用户消息 + 对话上下文，返回自包含的搜索查询。
不修改检索器状态。检索器（retriever.py）负责在 grading 失败时调用本模块重写并重试。

安全回退策略：任何异常返回原始查询，确保不阻塞检索流程。
"""
from __future__ import annotations

import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

# 对话式指代词模式：包含这些词的查询通常不是自包含的
_CONVERSATIONAL_RE = re.compile(
    r"(?:那个|这个|它|他|她|它们|我们|之前|刚才|上面|下面|那个东西|这个东西)"
    r"|(?:怎么用|支持吗|可以吗|行不行|是什么意思)$",
    re.IGNORECASE,
)


def is_self_contained(query: str) -> bool:
    """判断查询是否自包含（无需上下文即可理解）。

    包含对话式指代词（"那个"、"它"、"之前"等）的查询视为非自包含。
    """
    text = query.strip()
    if not text:
        return True
    return not _CONVERSATIONAL_RE.search(text)


async def rewrite_query(
    model: BaseChatModel,
    user_message: str,
    conversation_context: str = "",
) -> str:
    """重写对话式查询为自包含的搜索查询。

    自包含查询直接返回（不调用 LLM）。对话式查询调用 LLM 重写。
    任何异常返回原始查询。

    Args:
        model: LLM 模型
        user_message: 用户原始消息
        conversation_context: 对话上下文（之前的消息摘要）

    Returns:
        自包含的搜索查询
    """
    text = user_message.strip()
    if not text:
        return ""

    if is_self_contained(text):
        return text

    try:
        from agent.prompts import build_query_rewriter_prompt

        prompt = build_query_rewriter_prompt()
        context_clause = f"\n对话上下文：{conversation_context}" if conversation_context else ""
        user_msg = f"用户消息：{text}{context_clause}"
        messages = [SystemMessage(content=prompt), HumanMessage(content=user_msg)]
        response = await model.ainvoke(messages)
        content = (
            response.content
            if isinstance(response.content, str)
            else str(response.content)
        )
        rewritten = content.strip()
        if not rewritten:
            logger.warning("[query_rewriter] LLM 返回空白，回退到原始查询")
            return text
        return rewritten
    except Exception as e:
        logger.warning("[query_rewriter] 重写失败，回退到原始查询: %s", e)
        return text
