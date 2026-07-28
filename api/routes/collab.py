"""Collaboration API — 会话分享与协作管理。

提供会话分享链接、快照、协作状态等功能。
Phase 2 采用异步协作模式（分享链接 + 快照），预留实时协作接口。
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateShareRequest(BaseModel):
    session_id: str
    access_mode: str = "read"  # 'read' | 'comment' | 'edit'
    expires_in_hours: int | None = None
    password: str | None = None
    max_access: int | None = None


class CreateSnapshotRequest(BaseModel):
    title: str


# 简单的内存存储（生产环境应使用数据库）
_shares: dict[str, dict[str, Any]] = {}
_snapshots: dict[str, dict[str, Any]] = {}


@router.get("/sessions/{session_id}/shares")
async def list_session_shares(session_id: str, request: Request):
    """列出会话的所有分享链接。"""
    shares = [s for s in _shares.values() if s["session_id"] == session_id]
    return shares


@router.post("/sessions/{session_id}/shares")
async def create_session_share(session_id: str, body: CreateShareRequest, request: Request):
    """创建会话分享链接。"""
    share_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    expires_at = None
    if body.expires_in_hours:
        expires_at = (now + timedelta(hours=body.expires_in_hours)).isoformat()

    share = {
        "share_id": share_id,
        "session_id": session_id,
        "created_by": "current_user",  # TODO: 从 auth 获取
        "created_at": now.isoformat(),
        "expires_at": expires_at,
        "access_mode": body.access_mode,
        "password_protected": bool(body.password),
        "access_count": 0,
        "max_access": body.max_access,
    }
    _shares[share_id] = share
    return share


@router.delete("/shares/{share_id}")
async def revoke_session_share(share_id: str, request: Request):
    """撤销分享链接。"""
    if share_id not in _shares:
        raise HTTPException(status_code=404, detail="Share not found")
    del _shares[share_id]
    return {"ok": True}


@router.get("/sessions/{session_id}/snapshots")
async def list_session_snapshots(session_id: str, request: Request):
    """列出会话的所有快照。"""
    snapshots = [s for s in _snapshots.values() if s["session_id"] == session_id]
    return snapshots


@router.post("/sessions/{session_id}/snapshots")
async def create_session_snapshot(session_id: str, body: CreateSnapshotRequest, request: Request):
    """创建会话快照。"""
    snapshot_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)

    # 尝试从 session manager 获取会话信息
    turn_count = 0
    context_usage = {"used": 0, "capacity": 0}
    session_mgr = getattr(request.app.state, "session_manager", None)
    if session_mgr:
        try:
            session = session_mgr.get_session(session_id)
            if session:
                turn_count = len(getattr(session, "messages", []))
        except Exception:
            pass

    snapshot = {
        "snapshot_id": snapshot_id,
        "session_id": session_id,
        "title": body.title,
        "created_at": now.isoformat(),
        "turn_count": turn_count,
        "context_usage": context_usage,
    }
    _snapshots[snapshot_id] = snapshot
    return snapshot


@router.delete("/snapshots/{snapshot_id}")
async def delete_session_snapshot(snapshot_id: str, request: Request):
    """删除会话快照。"""
    if snapshot_id not in _snapshots:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    del _snapshots[snapshot_id]
    return {"ok": True}
