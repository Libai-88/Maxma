"""会话压缩 REST 端点 — OMP sidecar 代理。

尝试通过 pi_bridge 调用 sidecar 的 compact RPC。
如果 sidecar 不支持 compact，优雅降级并返回说明。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from api.pi_bridge.rpc_client import JsonRpcError
from api.pi_bridge.session_adapter import SessionMap

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


async def _try_sidecar_compact(session_id: str, request: Request) -> dict:
    """尝试通过 OMP sidecar 执行压缩。

    Returns:
        压缩结果 dict。sidecar 不可用或 compact 不支持时返回 degraded 状态。
    """
    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr is None:
        return {"compressed": False, "method": "unavailable", "detail": "Sidecar 未初始化"}

    try:
        await mgr.start()
        client = mgr.client
        if client is None:
            return {"compressed": False, "method": "unavailable", "detail": "Sidecar 客户端不可用"}

        with SessionMap() as sm:
            sidecar_sid = sm.get_sidecar_id(session_id)
        if not sidecar_sid:
            # 无映射 → 该会话未通过 sidecar 处理过
            return {"compressed": False, "method": "unavailable", "detail": "未找到对应 sidecar 会话"}

        result = await client.call("compact", {"session_id": sidecar_sid})
        return {
            "compressed": result.get("compressed", True),
            "method": "sidecar",
            "removed_count": result.get("removed_count"),
            "detail": result.get("detail", "压缩完成"),
        }
    except JsonRpcError as e:
        # sidecar 不支持 compact 方法 → 降级
        logger.debug("[compact] sidecar compact RPC 不可用: %s", e)
        return {
            "compressed": False,
            "method": "degraded",
            "detail": f"compact not supported by sidecar: {e}",
        }
    except Exception as e:
        logger.warning("[compact] sidecar 压缩失败: %s", e)
        return {
            "compressed": False,
            "method": "error",
            "detail": f"压缩失败: {e}",
        }


@router.post("/{session_id}/compress")
async def compress_session(session_id: str, request: Request) -> dict:
    """手动触发会话上下文压缩。

    优先通过 OMP sidecar 执行。如果 sidecar 不可用，返回 degraded 状态。
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    result = await _try_sidecar_compact(session_id, request)
    return result


@router.post("/{session_id}/fresh-compact")
async def trigger_compaction(session_id: str, request: Request) -> dict:
    """显式触发会话上下文刷新。

    行为同 compress_session。
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    result = await _try_sidecar_compact(session_id, request)
    return result
