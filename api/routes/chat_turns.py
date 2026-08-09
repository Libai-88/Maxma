"""chat_turns.py — 回合 id 校验与上下文用量估算。

从 chat.py 拆分（S2-4）：_calculate_context_usage 改为接收消息列表
（依赖注入），chat.py 传入 _get_messages_from_sidecar 的结果。
"""

import uuid
from collections.abc import Iterable


def _new_turn_id(turn_id: object = None) -> str:
    """Return a validated client id or create one before execution begins."""
    if isinstance(turn_id, str):
        candidate = turn_id.strip()
        if candidate and len(candidate) <= 128:
            return candidate
    return uuid.uuid4().hex


async def _calculate_context_usage(
    messages: Iterable[dict],
    system_prompt: str,
    *,
    max_tokens: int = 256_000,
    model_name: str = "",
) -> dict:
    """Estimate context usage from a message list (chars/2 ≈ tokens)."""
    message_list = list(messages)
    total_chars = sum(len(m.get("content", "")) for m in message_list)
    total_chars += len(system_prompt or "")
    estimated_tokens = int(total_chars / 2)
    return {
        "estimated_tokens": estimated_tokens,
        "max_tokens": max_tokens,
        "percentage": min(
            100, int(estimated_tokens / max(max_tokens, 1) * 100)
        ),
        "message_count": len(message_list),
        "model_name": model_name,
    }
