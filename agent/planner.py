"""规划节点 — 复杂任务先规划再执行。

当用户请求被判定为"复杂"（多步骤、多工具、研究分析等），
planner 先用 LLM 生成结构化计划，再以 SystemMessage 注入 Agent 上下文，
引导后续 ReAct 循环按步骤执行。

简单请求（闲聊、单步查询）跳过 planner，直接进入 Agent 循环。

阶段 2 扩展：
- parse_plan_to_steps：结构化解析，返回 PlanStep 列表（含并行组/工具提示）
- replan：基于失败上下文生成修订计划（保留已成功步骤）
"""

import asyncio
import logging
import re
from typing import Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage

from agent.step_state import PlanStep

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

# 重规划提示词模板（基于原计划 + 失败信息生成修订计划）
REPLAN_PROMPT_TEMPLATE = """你是一个任务规划器。之前的执行计划在某一步失败了，需要重新规划。

原始计划：
{original_plan}

失败信息：
- 失败步骤：第 {failed_step_index} 步「{failed_step_description}」
- 错误：{error_message}

已成功完成的步骤（请在修订计划中保留这些步骤的结果）：
{completed_steps}

请基于以上信息生成一个修订后的执行计划。要求：
1. 保留已成功步骤的成果（不需要重新执行）
2. 调整失败步骤的执行策略（换工具/换参数/换方法）
3. 后续步骤根据失败步骤的调整做相应修改
4. 用编号列表输出，每步一句话
5. 如果某些步骤可以并行，标注 [并行]
6. 步骤不超过 7 个

请只输出修订后的计划，不要多余解释。"""


def _llm_timeout() -> float:
    """获取 LLM 调用超时（秒），回退默认 120s。"""
    try:
        from config.settings import get_settings

        return get_settings().llm_invoke_timeout
    except Exception:
        return 120.0


async def classify_and_plan(model: BaseChatModel, user_message: str) -> str:
    """单次 LLM 调用完成分类 + 规划。

    Returns:
        计划文本（编号列表），或空字符串（简单请求 / 生成失败时）。
    """
    try:
        response = await asyncio.wait_for(
            model.ainvoke(
                [
                    HumanMessage(
                        content=f"{PLANNER_PROMPT}\n\n---\n\n用户请求：{user_message}"
                    ),
                ],
            ),
            timeout=_llm_timeout(),
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


# ── 阶段 2：结构化解析 + 重规划 ────────────────────────────────

# 工具提示提取正则：匹配 "（建议工具：xxx）" 或 "(tool: xxx)" 等
_TOOL_HINT_RE = re.compile(
    r"(?:[（(]\s*(?:建议工具|tool|建议使用工具)\s*[:：]\s*([^\s）()（）]+)\s*[）)])",
    re.IGNORECASE,
)
# 并行标签
_PARALLEL_TAG_RE = re.compile(r"^\[(?:并行|[Pp]arallel)\]\s*")


def parse_plan_to_steps(plan_text: str) -> list[PlanStep]:
    """将计划文本解析为结构化 PlanStep 列表。

    与 parse_plan_steps 的区别：
    - parse_plan_steps：返回纯文本列表（向后兼容）
    - parse_plan_to_steps：返回 PlanStep 对象（含并行组/工具提示/索引）

    解析规则：
    1. 编号列表 "1." "2)" 或无序列表 "- " 识别步骤
    2. [并行] 标签识别并行组（连续的并行步骤归为同组）
    3. "（建议工具：xxx）" 提取工具提示
    4. 步骤索引从 0 开始
    """
    if not plan_text:
        return []

    steps: list[PlanStep] = []
    current_parallel_group = 0
    parallel_active = False

    for line in plan_text.strip().splitlines():
        line = line.strip()
        if not line:
            continue

        # 匹配编号列表
        m = re.match(r"^(?:\d+[.)]\s*|[-*]\s*)", line)
        if not m:
            # 续行（属于上一步的补充说明）
            if steps:
                steps[-1].description += " " + line
            continue

        step_text = line[m.end():].strip()
        if not step_text:
            continue

        # 检测并行标签
        is_parallel = bool(_PARALLEL_TAG_RE.match(step_text))
        if is_parallel:
            clean = _PARALLEL_TAG_RE.sub("", step_text).strip()
            if not parallel_active:
                current_parallel_group += 1
                parallel_active = True
            step_text = clean
        else:
            parallel_active = False

        # 提取工具提示
        tool_hint = ""
        hint_match = _TOOL_HINT_RE.search(step_text)
        if hint_match:
            tool_hint = hint_match.group(1).strip()
            step_text = _TOOL_HINT_RE.sub("", step_text).strip()

        steps.append(PlanStep(
            description=step_text,
            tool_hint=tool_hint,
            parallel_group=current_parallel_group if is_parallel else 0,
            index=len(steps),
        ))

    return steps


async def replan(
    model: BaseChatModel,
    original_plan: str,
    failed_step_index: int = 0,
    failed_step_description: str = "",
    error_message: str = "",
    completed_steps: str = "",
    replan_context: str = "",
) -> str:
    """基于失败上下文生成修订计划。

    与 classify_and_plan 的区别：
    - classify_and_plan：从用户消息生成新计划
    - replan：基于原计划 + 失败信息生成修订计划（保留已成功步骤）

    Args:
        model: LLM 模型
        original_plan: 原始计划文本
        failed_step_index: 失败步骤索引（1-based）
        failed_step_description: 失败步骤描述
        error_message: 错误信息
        completed_steps: 已完成步骤的文本描述
        replan_context: 完整的重规划上下文（若提供则直接使用，覆盖其他参数）

    Returns:
        修订后的计划文本，或空字符串（生成失败时）
    """
    try:
        if replan_context:
            # 直接使用 executor 提供的完整上下文
            prompt = (
                f"你是一个任务规划器。之前的执行计划在某一步失败了，需要重新规划。\n\n"
                f"原始计划：\n{original_plan}\n\n"
                f"{replan_context}\n\n"
                f"请基于以上信息生成一个修订后的执行计划。要求：\n"
                f"1. 保留已成功步骤的成果（不需要重新执行）\n"
                f"2. 调整失败步骤的执行策略（换工具/换参数/换方法）\n"
                f"3. 后续步骤根据失败步骤的调整做相应修改\n"
                f"4. 用编号列表输出，每步一句话\n"
                f"5. 如果某些步骤可以并行，标注 [并行]\n"
                f"6. 步骤不超过 7 个\n\n"
                f"请只输出修订后的计划，不要多余解释。"
            )
        else:
            prompt = REPLAN_PROMPT_TEMPLATE.format(
                original_plan=original_plan,
                failed_step_index=failed_step_index,
                failed_step_description=failed_step_description,
                error_message=error_message[:500],
                completed_steps=completed_steps or "（无）",
            )
        response = await asyncio.wait_for(
            model.ainvoke([HumanMessage(content=prompt)]),
            timeout=_llm_timeout(),
        )
        text = response.content if isinstance(response.content, str) else str(response.content)
        return text.strip()
    except Exception as e:
        logger.warning(f"Replan failed: {e}")
        return ""
