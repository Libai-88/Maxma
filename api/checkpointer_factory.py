"""Checkpointer 工厂 — oh-my-pi sidecar 模式下无操作存根。

oh-my-pi sidecar 管理所有会话状态（JSONL 持久化）。
Python 端不再需要 LangGraph checkpointer。
此模块保留为兼容导入的零操作存根。
"""

import logging

logger = logging.getLogger(__name__)


async def init_persistent_checkpointer() -> None:
    """无操作：oh-my-pi sidecar 模式下不需要 checkpointer。"""
    logger.debug("[checkpointer] sidecar-only mode — init is a no-op")
    return None


def get_persistent_checkpointer() -> None:
    """无操作：oh-my-pi sidecar 模式下不需要 checkpointer。"""
    return None


async def close_persistent_checkpointer() -> None:
    """无操作：oh-my-pi sidecar 模式下不需要 checkpointer。"""
    logger.debug("[checkpointer] sidecar-only mode — close is a no-op")


def get_checkpointer_info() -> dict:
    """返回 checkpointer 状态信息。"""
    return {
        "type": "none",
        "persistent": False,
        "db_path": "",
        "mode": "oh-my-pi sidecar (no checkpointer needed)",
    }
