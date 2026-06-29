"""上下文窗口管理 — 滑动窗口截断与摘要。"""

import logging
from typing import Sequence

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage

from api.context_usage import count_tokens

logger = logging.getLogger(__name__)

# 保留最近的最小轮次数（即使超出 token 限制也不截断这些）
MIN_RECENT_TURNS = 5
# 当上下文占比超过此阈值时触发截断
TRIM_THRESHOLD = 0.75


def _count_turns(messages: Sequence[BaseMessage]) -> int:
    """统计对话轮次数（一个 human + 后续 ai/tool 消息算一轮）。"""
    turns = 0
    for msg in messages:
        if isinstance(msg, HumanMessage):
            turns += 1
    return turns


def _find_trim_boundary(messages: Sequence[BaseMessage], min_turns: int) -> int:
    """找到截断边界：保留最近 min_turns 轮，返回截断点的索引。

    截断点一定在对话轮次边界上（HumanMessage 之前），
    不会切断一个 turn 的中间（避免丢失 tool_calls 对应的 ToolMessage）。
    """
    if len(messages) <= 1:
        return 0

    # 从后往前找，找到第 min_turns 个 HumanMessage 的位置
    human_count = 0
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            human_count += 1
            if human_count >= min_turns:
                return i
    return 0


def _summarize_old_messages(messages: Sequence[BaseMessage]) -> str:
    """将旧消息压缩为简短摘要文本。

    当前实现：提取关键信息拼接。后续可接入 LLM 生成更智能的摘要。
    """
    summaries = []
    tool_count = 0
    ai_count = 0
    human_count = 0

    for msg in messages:
        if isinstance(msg, HumanMessage):
            human_count += 1
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            # 只保留用户消息的前 100 字符
            if len(content) > 100:
                content = content[:100] + "..."
            summaries.append(f"用户: {content}")
        elif isinstance(msg, AIMessage):
            ai_count += 1
        elif isinstance(msg, ToolMessage):
            tool_count += 1

    parts = []
    if human_count:
        parts.append(f"{human_count} 条用户消息")
    if ai_count:
        parts.append(f"{ai_count} 条 AI 回复")
    if tool_count:
        parts.append(f"{tool_count} 次工具调用")

    header = f"[历史对话摘要: {', '.join(parts)}]"

    if summaries:
        # 最多保留最近 3 条用户消息的摘要
        recent = summaries[-3:]
        return header + "\n" + "\n".join(recent)
    return header


def should_trim_context(
    messages: Sequence[BaseMessage],
    system_prompt_tokens: int,
    max_tokens: int,
) -> bool:
    """判断是否需要截断上下文。

    Args:
        messages: 当前对话消息列表
        system_prompt_tokens: 系统提示词占用的 token 数
        max_tokens: 模型上下文窗口上限

    Returns:
        True 如果当前上下文占比超过阈值且对话轮次足够多
    """
    if len(messages) < MIN_RECENT_TURNS * 2:
        return False

    # 估算当前 token 使用
    total_tokens = system_prompt_tokens
    for msg in messages:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        total_tokens += count_tokens(content) + 4  # 格式化开销

    usage_ratio = total_tokens / max_tokens if max_tokens else 0
    return usage_ratio > TRIM_THRESHOLD


def trim_messages(
    messages: Sequence[BaseMessage],
    system_prompt_tokens: int,
    max_tokens: int,
) -> list[BaseMessage]:
    """截断消息列表，保留最近的对话轮次，旧消息替换为摘要。

    Args:
        messages: 原始消息列表
        system_prompt_tokens: 系统提示词 token 数
        max_tokens: 模型上下文窗口上限

    Returns:
        截断后的消息列表（可能包含一条摘要消息在开头）
    """
    if not should_trim_context(messages, system_prompt_tokens, max_tokens):
        return list(messages)

    boundary = _find_trim_boundary(messages, MIN_RECENT_TURNS)
    if boundary == 0:
        return list(messages)

    old_messages = messages[:boundary]
    kept_messages = messages[boundary:]

    # 生成旧消息摘要
    summary_text = _summarize_old_messages(old_messages)

    # 构造截断后的消息列表
    result: list[BaseMessage] = []

    # 保留开头的 SystemMessage（如果有）
    if kept_messages and isinstance(kept_messages[0], SystemMessage):
        result.append(kept_messages[0])
        kept_messages = kept_messages[1:]

    # 插入摘要作为 SystemMessage
    if summary_text:
        result.append(SystemMessage(content=f"[上下文压缩] {summary_text}"))

    result.extend(kept_messages)

    logger.info(
        f"Context trimmed: {len(old_messages)} messages → summary, "
        f"kept {len(kept_messages)} recent messages"
    )

    return result


async def maybe_trim_checkpoint(
    graph,
    config: dict,
    system_prompt_tokens: int,
    max_tokens: int,
) -> bool:
    """检查 checkpoint 中的消息是否需要截断，如需则更新。

    Args:
        graph: LangGraph compiled agent
        config: LangGraph config (含 thread_id)
        system_prompt_tokens: 系统提示词 token 数
        max_tokens: 模型上下文窗口上限

    Returns:
        True 如果执行了截断
    """
    try:
        state = await graph.aget_state(config)
        if state is None:
            return False

        messages = state.values.get("messages", [])
        if not messages:
            return False

        if not should_trim_context(messages, system_prompt_tokens, max_tokens):
            return False

        trimmed = trim_messages(messages, system_prompt_tokens, max_tokens)
        if len(trimmed) == len(messages):
            return False

        # 使用 aupdate_state 更新 checkpoint
        # 注意：需要清除旧消息，写入新消息
        # LangGraph 的 messages channel 使用 add_messages reducer，
        # 所以我们需要先清空再写入
        await graph.aupdate_state(
            config,
            {"messages": trimmed},
        )
        logger.info(
            f"Checkpoint trimmed for thread {config.get('configurable', {}).get('thread_id', '?')}: "
            f"{len(messages)} → {len(trimmed)} messages"
        )
        return True

    except Exception as e:
        logger.warning(f"Failed to trim checkpoint: {e}", exc_info=True)
        return False
