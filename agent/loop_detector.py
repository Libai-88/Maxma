"""死循环检测 — 识别 LLM 重复调用相同工具的循环模式。

当 LLM 陷入"调用工具 X(A) → 收到结果 → 再调用工具 X(A)"的死循环时，
自动终止执行并通知用户，避免耗尽 recursion_limit。

检测策略（无状态，基于消息历史）：
    扫描消息历史中最近 N 条 AIMessage（含 tool_calls），
    若它们的 tool_call 签名完全相同，判定为死循环。

签名计算：
    tool_call_signature(tool_calls) → frozenset of (name, args_json) tuples
    使用 frozenset 忽略 tool_call_id 和顺序差异，聚焦"是否调用相同工具+相同参数"。
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage


def tool_call_signature(tool_calls: list[dict] | None) -> frozenset:
    """计算 tool_calls 的签名（用于重复检测）。

    Args:
        tool_calls: AIMessage.tool_calls 列表，每项形如
            {"name": "...", "args": {...}, "id": "...", "type": "tool_call"}

    Returns:
        frozenset of (name, args_json) tuples，忽略 id 和顺序。
        无 tool_calls 时返回空 frozenset。
    """
    if not tool_calls:
        return frozenset()
    signatures = []
    for tc in tool_calls:
        name = tc.get("name", "") or ""
        args = tc.get("args", {}) or {}
        # 规范化 args 为 JSON 字符串（sort_keys 确保顺序一致）
        try:
            args_json = json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            # 不可序列化的 args 回退到 str 表示
            args_json = str(sorted(args.items()) if isinstance(args, dict) else args)
        signatures.append((name, args_json))
    return frozenset(signatures)


def detect_loop(
    messages: list[BaseMessage],
    threshold: int = 3,
) -> bool:
    """检测消息历史中是否存在死循环。

    检查最近 threshold 条带 tool_calls 的 AIMessage，
    若它们的签名完全相同，判定为死循环。

    Args:
        messages: 完整消息历史
        threshold: 连续重复次数阈值（默认 3）

    Returns:
        True 表示检测到死循环，应终止执行
    """
    if threshold < 2:
        return False

    # 收集所有带 tool_calls 的 AIMessage
    ai_with_tools: list[AIMessage] = []
    for msg in messages:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            ai_with_tools.append(msg)

    if len(ai_with_tools) < threshold:
        return False

    # 取最近 threshold 条，检查签名是否全部相同
    recent = ai_with_tools[-threshold:]
    first_sig = tool_call_signature(recent[0].tool_calls)
    if not first_sig:
        # 空签名（无 tool_calls）不视为循环
        return False
    return all(
        tool_call_signature(m.tool_calls) == first_sig
        for m in recent[1:]
    )


def get_loop_break_messages(last_message: AIMessage) -> list[BaseMessage]:
    """构造循环终止消息（注入 ToolMessage + SystemMessage）。

    为 last_message 中的每个 tool_call 注入一条"已取消"的 ToolMessage，
    避免下轮出现 "tool_calls without corresponding ToolMessage" 错误。
    再追加一条 SystemMessage 通知 LLM 已终止循环。

    Args:
        last_message: 触发循环检测的 AIMessage（含 tool_calls）

    Returns:
        消息列表：[ToolMessage..., SystemMessage]
    """
    from langchain_core.messages import SystemMessage, ToolMessage

    msgs: list[BaseMessage] = []
    for tc in last_message.tool_calls:
        msgs.append(ToolMessage(
            content="[循环检测] 已终止重复的工具调用，避免死循环。",
            tool_call_id=tc.get("id", "") or "",
            name=tc.get("name", "") or "",
        ))
    tool_names = ", ".join(
        tc.get("name", "") for tc in last_message.tool_calls
    )
    msgs.append(SystemMessage(
        content=(
            f"[循环检测] 检测到连续重复调用工具（{tool_names}）已达阈值，"
            f"已自动终止。请停止重复调用，直接向用户说明当前情况："
            f"遇到了什么问题、为什么无法继续、以及建议的下一步操作。"
        )
    ))
    return msgs
