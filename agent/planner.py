"""规划节点 — 复杂任务先规划再执行。

当用户请求被判定为"复杂"（多步骤、多工具、研究分析等），
planner 先用 LLM 生成结构化计划，再以 SystemMessage 注入 Agent 上下文，
引导后续 ReAct 循环按步骤执行。

简单请求（闲聊、单步查询）跳过 planner，直接进入 Agent 循环。
"""

import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

PLANNER_PROMPT = """你是一个任务规划器。用户会提出一个请求。

如果任务简单（闲聊、问候、单步查询、直接回答），只回复：
SIMPLE

如果任务复杂（涉及多个步骤、需要多种工具协作、需要研究分析），请输出一个简洁的执行计划：
1. 用编号列表列出具体步骤（每步一句话）
2. 每个步骤注明建议使用的工具名称（如果明确的话）
3. 步骤不超过 7 个

请只输出 SIMPLE 或计划，不要多余解释。"""


async def classify_and_plan(model: BaseChatModel, user_message: str) -> str:
    """单次 LLM 调用完成分类 + 规划。

    Returns:
        计划文本（编号列表），或空字符串（简单请求 / 生成失败时）。
    """
    try:
        response = await model.ainvoke(
            [
                HumanMessage(
                    content=f"{PLANNER_PROMPT}\n\n---\n\n用户请求：{user_message}"
                ),
            ],
        )
        text = response.content if isinstance(response.content, str) else str(response.content)
        text = text.strip()
        if text.upper().startswith("SIMPLE"):
            return ""
        return text
    except Exception as e:
        logger.warning(f"Planner failed, skipping plan: {e}")
        return ""
