# agent/stream_repair/pipeline.py
"""流式修复管道 — 集成空 turn 修复 + tool JSON 修复 + usage 回填。

在 agent_node 返回 AIMessage 后执行，通过 feature flag 控制。

设计参考 Halo 的 BaseStreamHandler：
- 顺序：先修空 turn → 再修 tool JSON → 最后回填 usage
- 每个修复器独立，失败不影响其他
- 通过 config.settings 的 feature flag 控制开关
"""
from __future__ import annotations

import logging
from typing import List

from langchain_core.messages import AIMessage, BaseMessage

from agent.stream_repair.empty_turn import inject_placeholder_if_needed
from agent.stream_repair.tool_json_repair import repair_tool_calls_json
from agent.stream_repair.usage_backfill import backfill_usage_if_missing

logger = logging.getLogger(__name__)


def _is_stream_repair_enabled() -> bool:
    """检查流式修复是否启用（默认关闭）。"""
    try:
        from config.settings import get_settings
        return get_settings().stream_repair_enabled
    except Exception:
        return False


def apply_stream_repairs(
    ai_message: AIMessage,
    input_messages: List[BaseMessage],
) -> AIMessage:
    """对流式响应应用修复管道。

    修复顺序：
    1. 空 turn 占位注入（如果启用）
    2. tool 参数 JSON 修复（如果启用）
    3. usage 回填（如果启用）

    Args:
        ai_message: agent_node 返回的原始 AIMessage
        input_messages: 输入消息列表（用于 usage 估算）

    Returns:
        修复后的 AIMessage
    """
    if not _is_stream_repair_enabled():
        return ai_message

    result = ai_message

    # 1. 空 turn 修复
    try:
        result = inject_placeholder_if_needed(result)
    except Exception as e:
        logger.warning("[stream_repair] 空 turn 修复失败: %s", e)

    # 2. tool JSON 修复
    try:
        result = repair_tool_calls_json(result)
    except Exception as e:
        logger.warning("[stream_repair] tool JSON 修复失败: %s", e)

    # 3. usage 回填
    try:
        usage = backfill_usage_if_missing(result, input_messages)
        if usage and usage.get("estimated"):
            # 把估算的 usage 注入 response_metadata
            metadata = dict(getattr(result, "response_metadata", {}) or {})
            metadata["estimated_usage"] = {
                "input_tokens": usage["input_tokens"],
                "output_tokens": usage["output_tokens"],
            }
            result = AIMessage(
                content=result.content,
                tool_calls=getattr(result, "tool_calls", []) or [],
                additional_kwargs=getattr(result, "additional_kwargs", {}) or {},
                response_metadata=metadata,
                id=getattr(result, "id", None),
            )
    except Exception as e:
        logger.warning("[stream_repair] usage 回填失败: %s", e)

    return result
