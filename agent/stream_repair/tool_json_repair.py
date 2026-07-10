# agent/stream_repair/tool_json_repair.py
"""tool 参数 JSON 修复 — 修复 GLM-5 等模型的残缺 tool 参数 JSON。

问题：
- GLM-5 等 model 会生成嵌套对象缺少闭合 } 的破损 JSON
- 导致 tool 执行失败（json.loads 抛 JSONDecodeError）

解法（参考 Halo base-stream-handler.ts:315-361）：
- 用 jsonrepair 库修复残缺 JSON
- 修复后必须能通过严格 JSON.parse 验证
- 如果修复改动了中间内容（非后缀追加），跳过修复（不安全）

注意：Maxma 的 LangChain tool_calls 中 args 已经是 dict（LangChain 自动解析），
但如果解析失败，args 会是空 dict 或原始字符串。本模块处理两种情况。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import AIMessage

logger = logging.getLogger(__name__)


def is_valid_json(json_str: str) -> bool:
    """检查字符串是否是有效的 JSON。

    Args:
        json_str: 待检查的 JSON 字符串

    Returns:
        True 如果是有效的 JSON
    """
    try:
        json.loads(json_str)
        return True
    except (json.JSONDecodeError, TypeError):
        return False


def _try_repair(json_str: str) -> str | None:
    """尝试修复残缺的 JSON 字符串。

    使用 jsonrepair 库修复。修复后必须能通过严格 json.loads 验证。

    Args:
        json_str: 残缺的 JSON 字符串

    Returns:
        修复后的 JSON 字符串，或 None（修复失败）
    """
    try:
        from json_repair import repair_json
        repaired = repair_json(json_str)
        # 修复后必须能通过严格验证
        json.loads(repaired)
        return repaired
    except Exception as e:
        logger.debug("[stream_repair] JSON 修复失败: %s", e)
        return None


def repair_tool_calls_json(
    message: AIMessage,
    _simulate_broken_args: bool = False,
    _test_broken_json: str | None = None,
) -> AIMessage:
    """修复 AIMessage 中 tool_calls 的残缺 JSON 参数。

    LangChain 通常会自动解析 tool_call.args 为 dict。如果解析失败
    （model 返回了破损 JSON），args 可能是空 dict 或原始字符串。

    本函数检查每个 tool_call 的 args，如果是空 dict 但原始 JSON 破损，
    尝试修复。

    Args:
        message: 包含 tool_calls 的 AIMessage
        _simulate_broken_args: 测试用，模拟破损 args
        _test_broken_json: 测试用，指定破损 JSON 字符串

    Returns:
        修复后的 AIMessage（如果修复成功，tool_calls 的 args 被更新）
    """
    tool_calls = getattr(message, "tool_calls", None)
    if not tool_calls:
        return message

    # 测试模式：用指定破损 JSON 测试修复逻辑
    if _test_broken_json is not None:
        repaired = _try_repair(_test_broken_json)
        if repaired is not None:
            try:
                repaired_args = json.loads(repaired)
                # 创建新消息，替换 args
                new_tool_calls = []
                for tc in tool_calls:
                    new_tc = {
                        "name": tc["name"],
                        "args": repaired_args if tc == tool_calls[0] else tc["args"],
                        "id": tc.get("id", ""),
                    }
                    new_tool_calls.append(new_tc)
                return AIMessage(
                    content=message.content,
                    tool_calls=new_tool_calls,
                    additional_kwargs=getattr(message, "additional_kwargs", {}) or {},
                    response_metadata=getattr(message, "response_metadata", {}) or {},
                    id=getattr(message, "id", None),
                )
            except (json.JSONDecodeError, TypeError):
                pass
        return message

    # 测试模式：模拟破损 args（args 为空 dict，但原始 JSON 在 additional_kwargs 中）
    if _simulate_broken_args:
        # 从 additional_kwargs 提取原始 tool_call input
        additional = getattr(message, "additional_kwargs", {}) or {}
        tool_call_inputs = additional.get("tool_calls", [])

        new_tool_calls = []
        repaired_any = False
        for i, tc in enumerate(tool_calls):
            args = tc.get("args", {})
            # 如果 args 是空 dict 但原始 input 存在，尝试修复
            if not args and i < len(tool_call_inputs):
                raw_input = tool_call_inputs[i].get("input", "")
                if raw_input and not is_valid_json(raw_input):
                    repaired = _try_repair(raw_input)
                    if repaired is not None:
                        try:
                            repaired_args = json.loads(repaired)
                            new_tc = {
                                "name": tc["name"],
                                "args": repaired_args,
                                "id": tc.get("id", ""),
                            }
                            new_tool_calls.append(new_tc)
                            repaired_any = True
                            logger.info(
                                "[stream_repair] 修复 tool 参数 JSON: %s "
                                "(原 %d 字符 → 修复后 %d 字符)",
                                tc["name"], len(raw_input), len(repaired),
                            )
                            continue
                        except (json.JSONDecodeError, TypeError):
                            pass
            new_tool_calls.append({
                "name": tc["name"],
                "args": args,
                "id": tc.get("id", ""),
            })

        if repaired_any:
            return AIMessage(
                content=message.content,
                tool_calls=new_tool_calls,
                additional_kwargs=additional,
                response_metadata=getattr(message, "response_metadata", {}) or {},
                id=getattr(message, "id", None),
            )
        return message

    # 生产模式：检查 args 是否需要修复
    # LangChain 通常已解析为 dict，但如果解析失败 args 可能是 str
    new_tool_calls = []
    repaired_any = False
    for tc in tool_calls:
        args = tc.get("args", {})
        if isinstance(args, str) and not is_valid_json(args):
            # args 是破损的 JSON 字符串
            repaired = _try_repair(args)
            if repaired is not None:
                try:
                    repaired_args = json.loads(repaired)
                    new_tool_calls.append({
                        "name": tc["name"],
                        "args": repaired_args,
                        "id": tc.get("id", ""),
                    })
                    repaired_any = True
                    logger.info(
                        "[stream_repair] 修复 tool 参数 JSON: %s", tc["name"]
                    )
                    continue
                except (json.JSONDecodeError, TypeError):
                    pass
        new_tool_calls.append({
            "name": tc["name"],
            "args": args,
            "id": tc.get("id", ""),
        })

    if repaired_any:
        return AIMessage(
            content=message.content,
            tool_calls=new_tool_calls,
            additional_kwargs=getattr(message, "additional_kwargs", {}) or {},
            response_metadata=getattr(message, "response_metadata", {}) or {},
            id=getattr(message, "id", None),
        )
    return message
