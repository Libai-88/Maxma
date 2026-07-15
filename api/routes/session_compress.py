"""会话压缩 REST 端点。

在 oh-my-pi 模式下，上下文压缩由 SnapCompact 自动处理。
这些端点保留以兼容旧客户端，实际不执行压缩操作。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/sessions", tags=["sessions"])
logger = logging.getLogger(__name__)


@router.post("/{session_id}/compress")
async def compress_session(session_id: str, request: Request) -> dict:
    """手动触发会话上下文压缩。
    
    在 oh-my-pi 模式下，压缩由 SnapCompact 自动在 agent 循环中处理。
    此端点保留以兼容旧客户端调用。
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "compressed": True,
        "method": "automatic",
        "note": "Compression is handled automatically by oh-my-pi SnapCompact",
    }


@router.post("/{session_id}/fresh-compact")
async def trigger_compaction(session_id: str, request: Request) -> dict:
    """显式触发会话上下文刷新。
    
    在 oh-my-pi 模式下，压缩和刷新由 SnapCompact 自动处理。
    此端点保留以兼容旧客户端调用。
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "compressed": True,
        "method": "automatic",
        "note": "Compaction is handled automatically by oh-my-pi SnapCompact",
    }
