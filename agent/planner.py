"""规划节点 — 复杂任务先规划再执行。

当用户请求被判定为"复杂"（多步骤、多工具、研究分析等），
planner 先用 LLM 生成结构化计划，再以 SystemMessage 注入 Agent 上下文，
引导后续 ReAct 循环按步骤执行。

简单请求（闲聊、单步查询）跳过 planner，直接进入 Agent 循环。
"""

import logging
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

# 计划步骤数 >= 此阈值时触发用户确认
PLAN_CONFIRM_THRESHOLD = 3

PLANNER_PROMPT = """你是一个任务规划器。用户会提出一个请求。

如果任务简单（闲聊、问候、单步查询、直接回答），只回复：
SIMPLE

如果任务复杂（涉及多个步骤、需要多种工具协作、需要研究分析），请输出一个简洁的执行计划：
1. 用编号列表列出具体步骤（每步一句话）
2. 每个步骤注明建议使用的工具名称（如果明确的话）
3. 步骤不超过 7 个
4. 如果某些步骤之间互不依赖、可以并行执行，在步骤前标注 [并行]
   例如：
   1. [并行] 搜索 Python 3.12 新特性
   2. [并行] 分析项目目录结构
   3. 汇总以上结果生成报告

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


def parse_plan_steps(plan_text: str) -> list[str]:
    """从计划文本中提取步骤列表。

    支持格式:
    - "1. 步骤描述"
    - "1) 步骤描述"
    - "- 步骤描述"
    """
    if not plan_text:
        return []
    steps = []
    for line in plan_text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # 匹配编号列表: "1." "2)" 或无序列表 "- "
        m = re.match(r"^(?:\d+[.)]\s*|[-*]\s*)", line)
        if m:
            step_text = line[m.end():].strip()
            if step_text:
                steps.append(step_text)
        elif steps:
            # 续行（属于上一步的补充说明）
            steps[-1] += " " + line
    return steps


def extract_parallel_groups(plan_text: str) -> list[list[str]]:
    """从计划文本中提取可并行的步骤组。

    连续的标注了 [并行] 的步骤会被归为同一组。
    返回一个列表，每个元素是一组可并行的步骤描述。
    非并行步骤不会出现在结果中。
    """
    if not plan_text:
        return []

    groups: list[list[str]] = []
    current_group: list[str] = []

    for line in plan_text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # 去掉编号前缀 "1. " "2) " 等
        m = re.match(r"^(?:\d+[.)]\s*|[-*]\s*)", line)
        step_text = line[m.end():].strip() if m else line.strip()

        step_lower = step_text.lower()
        if step_lower.startswith("[并行]") or step_lower.startswith("[parallel]"):
            # 去掉标签（保留原始大小写的正则）
            clean = re.sub(r"^\[(?:并行|[Pp]arallel)\]\s*", "", step_text).strip()
            current_group.append(clean)
        else:
            # 遇到非并行步骤，结束当前组
            if current_group:
                groups.append(current_group)
                current_group = []

    # 尾部还有未提交的组
    if current_group:
        groups.append(current_group)

    return groups
