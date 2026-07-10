# agent/stream_repair/empty_turn.py
"""空 turn 占位注入 — 修复 GLM-4.7/5.1 等 model 的空响应。

问题：
- GLM-4.7/5.1 等 model 会产生既无文本又无 tool 调用的空 turn
- LangGraph 的 ReAct 循环会判定为执行错误并中止
- 空字符串 content 在历史回放时被转成 content: null，污染后续每一轮

解法（参考 Halo base-stream-handler.ts:208-219）：
- 检测到空 turn 时，注入一个含单个空格的 AIMessage
- 占位内容必须非空（空字符串会导致历史回放 content: null）
- 有 tool 调用或实质文本内容时不修改
"""
from __future__ import annotations

import logging
from langchain_core.messages import AIMessage

logger = logging.getLogger(__name__)

# 占位内容：单个空格（必须非空）
_PLACEHOLDER_CONTENT = " "


def is_empty_turn(message: AIMessage) -> bool:
    """检测 AIMessage 是否为空 turn。

    空 turn 定义：
    - content 为空或仅空白字符
    - 无 tool_calls

    Args:
        message: 待检测的 AIMessage

    Returns:
        True 如果是空 turn
    """
    # 有 tool 调用就不是空 turn
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        return False

    content = message.content
    if not content:
        return True

    # 纯空白也视为空 turn（无实质内容）
    if isinstance(content, str) and not content.strip():
        return True

    return False


def inject_placeholder_if_needed(message: AIMessage) -> AIMessage:
    """如果是空 turn，注入占位内容。

    修改 message.content 为单个空格（非空）。
    有 tool 调用或实质内容时不修改。

    Args:
        message: 原始 AIMessage

    Returns:
        修复后的 AIMessage（如果是空 turn 则 content 被替换为占位空格）
    """
    if not is_empty_turn(message):
        return message

    # 已是占位内容则不重复处理
    if message.content == _PLACEHOLDER_CONTENT:
        return message

    logger.debug(
        "[stream_repair] 检测到空 turn，注入占位内容（model 可能是 GLM-4.7/5.1 等）"
    )

    # 创建新的 AIMessage，保留所有原始属性，仅替换 content
    # LangChain 的 AIMessage 是不可变的，需要创建新实例
    return AIMessage(
        content=_PLACEHOLDER_CONTENT,
        tool_calls=getattr(message, "tool_calls", []) or [],
        additional_kwargs=getattr(message, "additional_kwargs", {}) or {},
        response_metadata=getattr(message, "response_metadata", {}) or {},
        id=getattr(message, "id", None),
    )
