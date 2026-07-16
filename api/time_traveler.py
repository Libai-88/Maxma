"""TimeTraveler — 对话轮次撤回工具（oh-my-pi sidecar 版本）。

通过 sidecar 的 undo RPC 方法撤回指定轮次的对话消息。
不再依赖 LangGraph RemoveMessage 机制。
"""

import logging

logger = logging.getLogger(__name__)


async def undo_rounds(sidecar_mgr, sidecar_session_id: str, n: int = 1) -> int:
    """撤回最近 n 轮对话。

    通过 sidecar 的 undo RPC 方法实现。
    委托给 sidecar session 管理消息状态。

    Args:
        sidecar_mgr: SidecarManager 实例（需已启动）
        sidecar_session_id: oh-my-pi sidecar 中的 session ID
        n: 要撤回的轮次数，默认 1

    Returns:
        实际删除的估计消息条数。
    """
    if n < 1 or not sidecar_mgr or not sidecar_session_id:
        return 0

    client = sidecar_mgr.client
    if client is None:
        logger.warning("[time_traveler] sidecar client not available")
        return 0

    try:
        result = await client.call("undo", {
            "session_id": sidecar_session_id,
            "steps": n,
        })
        removed = result.get("removed", 0)
        logger.info(
            "[time_traveler] undo %d step(s): removed %d message(s)",
            n, removed,
        )
        return removed
    except Exception as e:
        logger.warning("[time_traveler] sidecar undo failed: %s", e)
        return 0


async def undo_last_round(sidecar_mgr, sidecar_session_id: str) -> int:
    """撤回最近一轮对话。"""
    return await undo_rounds(sidecar_mgr, sidecar_session_id, n=1)


async def undo_all(sidecar_mgr, sidecar_session_id: str) -> int:
    """撤回所有轮次，清空对话历史。"""
    return await undo_rounds(sidecar_mgr, sidecar_session_id, n=100)
