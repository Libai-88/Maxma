"""Collaboration API — 会话分享与协作管理。

提供会话分享链接、快照、协作状态等功能。
Phase 2 采用异步协作模式（分享链接 + 快照），预留实时协作接口。

存储层：SQLite（通过 api.db.core.transaction）。
"""

from __future__ import annotations

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.db.core import rows_to_dicts, transaction

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


# ── 辅助：DB 行 → API 响应格式 ─────────────────────────────


def _share_row_to_dict(row: dict) -> dict:
    """将 collab_shares 表行转换为 API 响应格式。"""
    return {
        "share_id": row["id"],
        "session_id": row["session_id"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "expires_at": row["expires_at"],
        "access_mode": row["permission"],
        "password_protected": bool(row["password_protected"]),
        "access_count": row["access_count"],
        "max_access": row["max_access"],
    }


def _snapshot_row_to_dict(row: dict) -> dict:
    """将 collab_snapshots 表行转换为 API 响应格式。"""
    context_usage = {"used": 0, "capacity": 0}
    try:
        context_usage = json.loads(row.get("context_usage") or "{}")
    except (json.JSONDecodeError, TypeError):
        pass
    return {
        "snapshot_id": row["id"],
        "session_id": row["session_id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "turn_count": row["turn_count"],
        "context_usage": context_usage,
    }


# ── 分享链接端点 ──────────────────────────────────────────


@router.get("/sessions/{session_id}/shares")
async def list_session_shares(session_id: str, request: Request):
    """列出会话的所有分享链接。"""
    with transaction() as db:
        rows = db.execute(
            "SELECT * FROM collab_shares WHERE session_id = ? AND revoked = 0 ORDER BY created_at DESC",
            (session_id,),
        ).fetchall()
    return [_share_row_to_dict(r) for r in rows_to_dicts(rows)]


@router.post("/sessions/{session_id}/shares")
async def create_session_share(session_id: str, body: CreateShareRequest, request: Request):
    """创建会话分享链接。"""
    share_id = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    expires_at = None
    if body.expires_in_hours:
        expires_at = (now + timedelta(hours=body.expires_in_hours)).isoformat()

    share_url = f"/collab/shares/{share_id}"

    with transaction() as db:
        db.execute(
            """INSERT INTO collab_shares
               (id, session_id, share_url, created_at, expires_at, revoked, permission,
                created_by, password_protected, access_count, max_access)
               VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)""",
            (
                share_id,
                session_id,
                share_url,
                now.isoformat(),
                expires_at,
                body.access_mode,
                "current_user",  # TODO: 从 auth 获取
                int(bool(body.password)),
                body.max_access,
            ),
        )

    return {
        "share_id": share_id,
        "session_id": session_id,
        "created_by": "current_user",
        "created_at": now.isoformat(),
        "expires_at": expires_at,
        "access_mode": body.access_mode,
        "password_protected": bool(body.password),
        "access_count": 0,
        "max_access": body.max_access,
    }


@router.get("/shares/{share_id}")
async def get_share(share_id: str, request: Request):
    """获取分享链接的会话信息。"""
    with transaction() as db:
        row = db.execute(
            "SELECT * FROM collab_shares WHERE id = ? AND revoked = 0",
            (share_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Share not found or revoked")
        share = _share_row_to_dict(rows_to_dicts([row])[0])

        # 检查过期
        if share.get("expires_at"):
            expires = datetime.fromisoformat(share["expires_at"])
            if expires < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Share has expired")

        # 增加访问计数
        db.execute(
            "UPDATE collab_shares SET access_count = access_count + 1 WHERE id = ?",
            (share_id,),
        )

    # 获取会话消息
    session_mgr = getattr(request.app.state, "session_manager", None)
    messages = []
    if session_mgr:
        try:
            session = await session_mgr.get(share["session_id"])
            if session:
                messages = getattr(session, "messages", [])
        except Exception:
            pass

    return {
        "share": share,
        "session_id": share["session_id"],
        "messages": messages,
    }


@router.delete("/shares/{share_id}")
async def revoke_session_share(share_id: str, request: Request):
    """撤销分享链接。"""
    with transaction() as db:
        row = db.execute(
            "SELECT id FROM collab_shares WHERE id = ?", (share_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Share not found")
        db.execute(
            "UPDATE collab_shares SET revoked = 1 WHERE id = ?", (share_id,)
        )
    return {"ok": True}


# ── 快照端点 ──────────────────────────────────────────────


@router.get("/sessions/{session_id}/snapshots")
async def list_session_snapshots(session_id: str, request: Request):
    """列出会话的所有快照。"""
    with transaction() as db:
        rows = db.execute(
            "SELECT * FROM collab_snapshots WHERE session_id = ? ORDER BY created_at DESC",
            (session_id,),
        ).fetchall()
    return [_snapshot_row_to_dict(r) for r in rows_to_dicts(rows)]


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
            session = await session_mgr.get(session_id)
            if session:
                turn_count = len(getattr(session, "messages", []))
        except Exception:
            pass

    with transaction() as db:
        db.execute(
            """INSERT INTO collab_snapshots
               (id, session_id, title, content, created_at, turn_count, context_usage)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                snapshot_id,
                session_id,
                body.title,
                "",  # content 预留，后续可存储快照正文
                now.isoformat(),
                turn_count,
                json.dumps(context_usage),
            ),
        )

    return {
        "snapshot_id": snapshot_id,
        "session_id": session_id,
        "title": body.title,
        "created_at": now.isoformat(),
        "turn_count": turn_count,
        "context_usage": context_usage,
    }


@router.delete("/snapshots/{snapshot_id}")
async def delete_session_snapshot(snapshot_id: str, request: Request):
    """删除会话快照。"""
    with transaction() as db:
        row = db.execute(
            "SELECT id FROM collab_snapshots WHERE id = ?", (snapshot_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        db.execute(
            "DELETE FROM collab_snapshots WHERE id = ?", (snapshot_id,)
        )
    return {"ok": True}
