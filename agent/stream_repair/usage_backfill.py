"""usage 回填 — 上游不返回 token 数时用字符累积估算。

问题：
- 部分上游 model 不返回 usage（无 stream_options.include_usage）
- 导致余额统计/上下文显示全部为 0

解法（参考 Halo base-stream-handler.ts:257-286 + usage-estimator.ts）：
- 输入侧：累加输入消息的字符数估算
- 输出侧：累加 AI 响应文本 + thinking + tool 参数的字符数
- BIAS_HIGH_FACTOR=1.35：只许多计绝不少计（usage 是余额统计的唯一来源）
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from langchain_core.messages import AIMessage, BaseMessage

logger = logging.getLogger(__name__)

# 偏高因子：把最差实测欠计（数字/符号密集文本约 0.74x）抬到 >=1.0x
BIAS_HIGH_FACTOR = 1.35

# 基础估算：约 4 字符/token（英文），中文约 2 字符/token
# 取折中 3.5 字符/token，再乘以 BIAS_HIGH_FACTOR
_CHARS_PER_TOKEN = 3.5


def estimate_tokens(text: str) -> int:
    """估算字符串的 token 数（偏高，只许多计绝不少计）。

    Args:
        text: 待估算的文本

    Returns:
        估算的 token 数（>= 0）
    """
    if not text:
        return 0
    raw = len(text) / _CHARS_PER_TOKEN
    return int(raw * BIAS_HIGH_FACTOR) + 1  # +1 确保非零文本至少 1


def _extract_text_from_message(message: BaseMessage) -> str:
    """从消息中提取文本内容（跳过 image block）。"""
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    # 处理 content_blocks 格式
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
                # 跳过 image block（base64 字符长度会严重高估）
            elif isinstance(block, str):
                texts.append(block)
        return "".join(texts)
    return str(content) if content else ""


def extract_usage_from_response(message: AIMessage) -> Optional[dict]:
    """从 AIMessage 的 response_metadata 中提取 usage 信息。

    支持 OpenAI 格式（token_usage）和 Anthropic 格式（usage）。

    Args:
        message: AI 响应消息

    Returns:
        {"input_tokens": int, "output_tokens": int} 或 None
    """
    metadata = getattr(message, "response_metadata", {}) or {}

    # OpenAI 格式
    token_usage = metadata.get("token_usage") or metadata.get("usage")
    if token_usage:
        input_tokens = token_usage.get("prompt_tokens", 0) or token_usage.get("input_tokens", 0)
        output_tokens = token_usage.get("completion_tokens", 0) or token_usage.get("output_tokens", 0)
        if input_tokens or output_tokens:
            return {
                "input_tokens": int(input_tokens),
                "output_tokens": int(output_tokens),
            }

    return None


def backfill_usage_if_missing(
    ai_message: AIMessage,
    input_messages: List[BaseMessage],
) -> Optional[dict]:
    """如果 usage 缺失，用字符累积估算回填。

    Args:
        ai_message: AI 响应消息
        input_messages: 输入消息列表（用于估算 input tokens）

    Returns:
        {"input_tokens": int, "output_tokens": int, "estimated": bool}
        如果已有 usage，estimated=False；如果估算回填，estimated=True
    """
    # 先尝试提取已有 usage
    existing = extract_usage_from_response(ai_message)
    if existing:
        return {
            "input_tokens": existing["input_tokens"],
            "output_tokens": existing["output_tokens"],
            "estimated": False,
        }

    # usage 缺失，用字符估算
    # 输入侧：累加所有输入消息的文本
    input_text = "".join(
        _extract_text_from_message(msg) for msg in input_messages
    )
    input_tokens = estimate_tokens(input_text)

    # 输出侧：AI 响应文本 + tool 参数
    output_text = _extract_text_from_message(ai_message)
    output_tokens = estimate_tokens(output_text)

    # 累加 tool 调用参数
    tool_calls = getattr(ai_message, "tool_calls", None) or []
    for tc in tool_calls:
        args = tc.get("args", {})
        if args:
            import json
            args_text = json.dumps(args, ensure_ascii=False)
            output_tokens += estimate_tokens(args_text)

    if input_tokens == 0 and output_tokens == 0:
        return None

    logger.debug(
        "[stream_repair] usage 回填: input=%d, output=%d (estimated)",
        input_tokens, output_tokens,
    )

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated": True,
    }
