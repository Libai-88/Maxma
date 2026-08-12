"""REST API — 会话 CRUD + Const 固定会话。"""

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.context_usage import estimate_context_usage
from agent.prompts import get_system_prompt_parts

logger = logging.getLogger(__name__)

def _audit_record(type_: str, target: str, target_id: str, detail: str) -> None:
    """AUDIT-WIRE-001：追加审计记录（内部调用，复用 audit_log 的持久化）。"""
    try:
        from api.routes.audit_log import _append_record
        _append_record({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "epoch": int(time.time()),
            "type": type_,
            "target": target,
            "detail": f"{detail}: {target_id}"[:500],
            "data_size": 0,
            "status": "ok",
        })
    except Exception:
        pass  # 审计失败不影响主操作


# PATH-TRAVERSAL-001：session_id 安全字符校验（uuid hex + 短划线等）
import re
import time
_SAFE_SID_RE = re.compile(r"^[0-9a-zA-Z_-]{1,64}$")

router = APIRouter()


class ConstifyRequest(BaseModel):
    name: str


PermissionModeValue = Literal["read_only", "ask", "operate", "auto"]
_PERMISSION_MODES: tuple[PermissionModeValue, ...] = (
    "read_only",
    "ask",
    "operate",
    "auto",
)


class PermissionModeRequest(BaseModel):
    """Browser-facing request for the session's additional permission layer."""

    permission_mode: PermissionModeValue


def _permission_modes_enabled() -> bool:
    """Read the opt-in flag at request time so settings reloads take effect."""
    try:
        from config.settings import get_settings

        return bool(get_settings().permission_modes_enabled)
    except Exception:
        # Permission mode controls must never accidentally become writable if
        # settings cannot be loaded.
        return False


def _permission_mode_metadata(session, *, enabled: bool) -> dict[str, object]:
    """Return the small, non-secret contract consumed by the session UI.

    A disabled feature reports the compatible confirmation-first mode instead
    of a stale, more permissive saved value.  This reflects the mode effective
    at the approval boundary while the feature flag is off.
    """
    return {
        "session_id": session.session_id,
        "permission_modes_enabled": enabled,
        "permission_mode": session.permission_mode if enabled else "yolo",
        "permission_mode_updated_at": session.permission_mode_updated_at,
        "available_permission_modes": list(_PERMISSION_MODES) if enabled else [],
    }


@router.post("/sessions")
async def create_session(request: Request):
    sm = request.app.state.session_manager
    session = await sm.create()
    return {"session_id": session.session_id, "created_at": session.created_at}


@router.get("/sessions")
async def list_sessions(request: Request):
    sm = request.app.state.session_manager
    return {"sessions": await sm.list_sessions()}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {
        "session_id": session.session_id,
        "message_count": session.message_count,
        "created_at": session.created_at,
        "has_active_agent": session._active_task is not None
        and not session._active_task.done(),
        "is_const": session.is_const,
        "const_name": session.const_name,
    }


@router.get("/sessions/{session_id}/permission-mode")
async def get_session_permission_mode(session_id: str, request: Request):
    """Get the effective permission mode for one authenticated session."""
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return _permission_mode_metadata(session, enabled=_permission_modes_enabled())


@router.put("/sessions/{session_id}/permission-mode")
async def set_session_permission_mode(
    session_id: str,
    body: PermissionModeRequest,
    request: Request,
):
    """Persist a validated permission mode when the opt-in feature is active."""
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    if not _permission_modes_enabled():
        # The flag preserves the legacy approval semantics, so an inactive
        # endpoint must not leave a latent elevated value on the session.
        raise HTTPException(status_code=409, detail="权限模式功能未启用")

    try:
        session.set_permission_mode(body.permission_mode)
    except ValueError:
        # The request model normally catches this first.  Keep the boundary
        # fail-closed if an alternative SessionState implementation rejects it.
        raise HTTPException(status_code=422, detail="不支持的权限模式") from None

    return _permission_mode_metadata(session, enabled=True)


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, request: Request, limit: int = 50):
    # 修复 PARAM-RANGE-001：limit 无界/负值语义错乱（负 limit 会让
    # get_recent_turns 的 turns[-count:] 切出错误片段）
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit 必须在 1-500 之间")
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    logger.info("[messages] get_messages(%s): session=%s", session_id[:8], session)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # const 会话：从 YAML 文件读取
    if session.is_const:
        from api.const_session_store import load_const_session_by_id

        const_data = load_const_session_by_id(session_id)
        if const_data is not None:
            persisted_messages = const_data.get("messages", [])
            if isinstance(persisted_messages, list):
                return {
                    "session_id": session_id,
                    "messages": [
                        {
                            "role": str(m.get("type", "human")),
                            "content": m.get("content", ""),
                        }
                        for m in persisted_messages
                        if isinstance(m, dict)
                    ],
                }

    # sidecar 模式：从 sidecar RPC 获取消息
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
        except Exception:
            logger.debug("[messages] sidecar start failed for %s, fallback to SessionMap", session_id[:8], exc_info=True)
            sidecar_mgr = None
    if sidecar_mgr is not None:
        client = sidecar_mgr.client
        if client is not None:
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("get_messages", {
                        "session_id": sidecar_sid,
                        "limit": limit,
                    })
                    # 规范化 role 格式：sidecar 用 "user"/"assistant"，前端期望 "human"/"ai"
                    _role_map = {"user": "human", "assistant": "ai"}
                    raw_msgs = result.get("messages", [])
                    normalized = [
                        {**m, "role": _role_map.get(m.get("role", ""), m.get("role", ""))}
                        for m in raw_msgs
                    ]
                    return {
                        "session_id": session_id,
                        "messages": normalized,
                        "total": result.get("total", 0),
                        # CACHE-RECONCILE-001：标记来源——前端只在
                        # source="sidecar"（完整消息）时做缓存校准；
                        # SessionMap fallback 是截断/限轮的历史，不能
                        # 作为校准依据（会误删本地完整缓存）。
                        "source": "sidecar",
                    }
                except Exception:
                    logger.debug("[messages] sidecar fetch failed for %s", session_id, exc_info=True)

    # fallback: 从 SessionMap 的 recent turns 获取
    from api.pi_bridge.session_adapter import get_session_map
    smap = get_session_map()
    turns = smap.get_recent_turns(session_id, count=limit)
    messages = []
    for t in turns:
        messages.append({"role": "human", "content": t.get("user", "")})
        messages.append({"role": "ai", "content": t.get("assistant", "")})
    return {"session_id": session_id, "messages": messages, "total": len(messages), "source": "session_map"}


async def _sync_const_session_after_undo(session, deleted: int, *, sidecar_mgr=None):
    """Sync const session YAML after undo. sidecar 模式下从 sidecar 获取消息。"""
    if session.is_const and deleted > 0:
        from api.const_session_store import save_const_session

        try:
            # 从 sidecar 获取当前消息列表
            from api.pi_bridge.session_adapter import get_session_map
            sidecar_sid = None
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session.session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if not sidecar_sid:
                return

            # 优先使用传入的 sidecar_mgr，其次检查 session 上的引用
            if sidecar_mgr is None:
                sidecar_mgr = getattr(session, "_sidecar_mgr", None)
            if sidecar_mgr is None:
                return
            try:
                await sidecar_mgr.start()
            except Exception:
                logger.debug("[sessions] sidecar start failed, return empty", exc_info=True)
                return
            if sidecar_mgr.client is None:
                return

            result = await sidecar_mgr.client.call("get_messages", {
                "session_id": sidecar_sid,
                "limit": 200,
            })
            messages = result.get("messages", [])
            serialized = []
            for m in messages:
                role = m.get("role", "unknown")
                content = m.get("content", "")
                if role == "user":
                    serialized.append({"type": "human", "content": content})
                elif role == "assistant":
                    serialized.append({"type": "ai", "content": content})
            metadata = session.persistent_metadata()
            save_const_session(
                session.session_id,
                session.const_name,
                metadata,
                serialized,
            )
            logger.info(
                "[undo] const 会话 %s 已同步更新 YAML (deleted=%d, msg_count=%d)",
                session.session_id, deleted, session.message_count,
            )
        except Exception:
            logger.warning(
                "[undo] const 会话 %s 撤回后同步 YAML 失败",
                session.session_id, exc_info=True,
            )


@router.post("/sessions/{session_id}/undo")
async def undo_session_messages(session_id: str, request: Request, n: int = 1):
    """撤回最近 n 轮对话（默认撤回最后一轮）。"""
    if n < 1 or n > 100:
        raise HTTPException(status_code=400, detail="n 必须在 1-100 之间")
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # UNDO-BUSY-001：Agent 运行中禁止撤回——sidecar 的 undo 从消息列表
    # 末尾切轮，会把 in-flight 轮次的未完成消息一并切掉，运行中 turn 的
    # 上下文被从底部修改，最终回复与上下文不一致。
    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 正在处理中，请等待本轮完成后撤回")

    # ── Sidecar path ──────────────────────────────────────────────
    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr is not None:
        try:
            await mgr.start()
            client = mgr.client
        except Exception:
            logger.debug("[sessions] sidecar start failed, skip sidecar path", exc_info=True)
            client = None
        if client is not None:
            # 注入 sidecar manager 到 session
            session._sidecar_mgr = mgr
            # 优先从 SessionMap（持久化 SQLite）查找 sidecar session ID
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("undo", {
                        "session_id": sidecar_sid,
                        "steps": n,
                    })
                    deleted = result.get("removed", 0)
                    turns_removed = int(result.get("turns_removed") or 0)

                    # 先更新内存状态，再同步持久化。
                    # 顺序保证：_sync_const_session_after_undo 通过
                    # persistent_metadata() 读取 session.message_count，
                    # 必须先更新 message_count 才能将新值持久化到 YAML，
                    # 否则 YAML 会保存旧值造成内存与磁盘状态不一致。
                    session.message_count = max(0, session.message_count - deleted)

                    # UNDO-SYNC-001：同步 SessionMap 持久化 turns——
                    # 此前只改 sidecar 消息与内存计数，sidecar 会话销毁/
                    # 重启后已撤回的轮次会被 get_recent_turns 恢复进上下文，
                    # 重启后 message_count = len(turns)*2 也把撤回轮次算回。
                    # turns_removed 是 sidecar 按完整轮数切除的准确值；
                    # 旧 sidecar 未返回该字段时按消息数折半兜底。
                    if turns_removed > 0:
                        smap.remove_recent_turns(session_id, turns_removed)
                    elif deleted > 0:
                        smap.remove_recent_turns(session_id, max(1, deleted // 2))

                    if session.is_const and deleted > 0:
                        await _sync_const_session_after_undo(session, deleted, sidecar_mgr=mgr)

                    return {"deleted_count": deleted}
                except HTTPException:
                    raise
                except Exception:
                    logger.debug("[undo] sidecar undo failed for %s", session_id, exc_info=True)

    # sidecar 不可用时的降级响应
    raise HTTPException(status_code=503, detail="Undo 需要 sidecar 连接")


@router.post("/sessions/{session_id}/recap")
async def recap_session(session_id: str, request: Request):
    """GAP-B3-001：会话闲置回顾——基于当前会话上下文生成简短进展总结。

    前端 idle 计时触发（配置 recap.enabled/recap.idleSeconds，见设置页）；
    sidecar 把回顾 prompt 串行追加到会话 promptQueue，不新建会话。
    进行中的轮次拒绝执行（避免打断流式回复）。
    """
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 正在处理中，请等待本轮完成后再回顾")

    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr is None:
        raise HTTPException(status_code=503, detail="Sidecar 不可用")
    try:
        await mgr.start()
        client = await mgr.get_client()
    except Exception:
        logger.debug("[sessions] sidecar start failed for recap", exc_info=True)
        raise HTTPException(status_code=503, detail="Sidecar 不可用")
    if client is None:
        raise HTTPException(status_code=503, detail="Sidecar 不可用")

    from api.pi_bridge.session_adapter import get_session_map
    smap = get_session_map()
    sidecar_sid = smap.get_sidecar_id(session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        raise HTTPException(status_code=409, detail="会话尚未初始化模型连接")

    try:
        result = await client.call("session_recap", {"session_id": sidecar_sid})
        answer = str(result.get("answer") or "").strip()
        return {
            "answer": answer,
            "status": "completed" if answer else "empty",
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("[recap] session_recap failed for %s", session_id)
        raise HTTPException(status_code=502, detail="回顾生成失败，请稍后重试")


@router.post("/sessions/{session_id}/compact")
async def compact_session(session_id: str, request: Request, keep_last: int = 20):
    """GAP-CMD-001：压缩上下文历史（斜杠命令 /compact）。

    截断会话消息历史至最近 keep_last 条（保留首位 system 消息），
    复用 sidecar compact RPC；进行中的轮次拒绝执行。
    """
    if keep_last < 1 or keep_last > 500:
        raise HTTPException(status_code=400, detail="keep_last 必须在 1-500 之间")
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 正在处理中，请等待本轮完成后压缩")

    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr is None:
        raise HTTPException(status_code=503, detail="Sidecar 不可用")
    try:
        await mgr.start()
        client = await mgr.get_client()
    except Exception:
        logger.debug("[sessions] sidecar start failed for compact", exc_info=True)
        raise HTTPException(status_code=503, detail="Sidecar 不可用")
    if client is None:
        raise HTTPException(status_code=503, detail="Sidecar 不可用")

    from api.pi_bridge.session_adapter import get_session_map
    smap = get_session_map()
    sidecar_sid = smap.get_sidecar_id(session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        raise HTTPException(status_code=409, detail="会话尚未初始化模型连接")

    try:
        # AUX-STALE-001：探活后调用（sidecar 重启后旧映射静默失败）
        await client.call("get_messages", {"session_id": sidecar_sid, "limit": 0})
    except Exception:
        smap.clear_sidecar_id(session_id)
        try:
            session._sidecar_session_id = None
        except Exception:
            pass
        raise HTTPException(status_code=409, detail="会话连接已失效，请发送一条消息后重试")

    try:
        result = await client.call("compact", {"session_id": sidecar_sid, "keep_last": keep_last})
        return {
            "compressed": bool(result.get("compressed")),
            "removed_count": int(result.get("removed_count") or 0),
            "detail": result.get("detail", ""),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("[compact] compact failed for %s", session_id)
        raise HTTPException(status_code=502, detail="上下文压缩失败，请稍后重试")


@router.get("/sessions/{session_id}/context-usage")
async def get_context_usage(session_id: str, request: Request):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    # OMP ModelRegistry 管理所有 provider，Python 端使用默认值
    max_tokens = 256_000
    model_name = ""

    system_prompt = getattr(request.app.state, "system_prompt", "") or ""

    # sidecar 模式：从 sidecar 获取消息估算用量
    counting_messages = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
            client = sidecar_mgr.client
        except Exception:
            logger.debug("[sessions] sidecar start failed, skip sidecar path", exc_info=True)
            client = None
        if client is not None:
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("get_messages", {
                        "session_id": sidecar_sid,
                        "limit": 200,
                    })
                    counting_messages = result.get("messages", [])
                except Exception:
                    logger.debug("Failed to get messages for context usage in session %s", session_id, exc_info=True)

    # 粗略 token 估算：约 2 字符 ≈ 1 token
    total_chars = sum(len(m.get("content", "")) for m in counting_messages)
    total_chars += len(system_prompt)
    estimated_tokens = int(total_chars / 2)
    usage = {
        "estimated_tokens": estimated_tokens,
        "max_tokens": max_tokens,
        "percentage": min(100, int(estimated_tokens / max(max_tokens, 1) * 100)),
        "message_count": len(counting_messages),
        "model_name": model_name,
        "session_id": session_id,
    }
    return usage


@router.delete("/sessions/{session_id}/messages")
async def clear_session_messages(session_id: str, request: Request):
    """清空会话全部消息（UX-CLEAR-001）。

    前端"清空会话"此前只清本地 turns，刷新/重启后 loadHistoryFromBackend
    会把历史全部恢复——用户确认"不可撤销"后消息"复活"，属信任级问题。
    本端点：销毁 sidecar session（模型侧上下文）→ 清空 SessionMap 持久化
    turns 与幂等 id → 重置 message_count。const 会话同时删除磁盘文件。
    """
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # Agent 运行中禁止清空（避免 in-flight turn 的上下文被从底部抽走）
    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 正在处理中，请等待本轮完成后清空")

    # 1. 销毁 sidecar session（模型侧上下文）
    from api.routes.chat import _destroy_sidecar_session
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        try:
            await _destroy_sidecar_session(sidecar_mgr, session)
        except Exception:
            logger.debug("[sessions] clear: destroy sidecar session failed", exc_info=True)

    # 2. 清空 SessionMap 持久化 turns + message_ids
    from api.pi_bridge.session_adapter import get_session_map
    try:
        smap = get_session_map()
        cleared = smap.clear_turns(session_id)
    except Exception:
        logger.warning("[sessions] clear: SessionMap clear failed", exc_info=True)
        cleared = 0

    # 3. 重置内存状态
    session.message_count = 0
    session.recent_message_ids.clear()

    # 4. const 会话：同步删除磁盘文件（避免重启后旧内容复活）
    if session.is_const:
        try:
            from api.const_session_store import delete_const_session
            delete_const_session(session_id)
        except Exception:
            logger.debug("[sessions] clear: const file delete failed", exc_info=True)

    _audit_record("session", "clear", session_id, "清空会话消息")
    return {"status": "cleared", "cleared_turns": cleared}


async def _delete_session_inner(
    sm, sidecar_mgr, session_id: str,
) -> bool:
    """删除单个会话的完整清理（const YAML + sidecar session + SessionMap + session manager）。

    供单个删除与批量删除复用。返回会话是否被删除。
    """
    session = await sm.get(session_id)

    # 若为 const 会话，先清理磁盘文件
    if session is not None and session.is_const:
        from api.const_session_store import delete_const_session

        delete_const_session(session_id)

    # 清理 sidecar session（防止内存泄漏）
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
            client = sidecar_mgr.client
        except Exception:
            logger.debug("[delete] sidecar start failed, skip cleanup", exc_info=True)
            client = None
        if client is not None:
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid and session is not None:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    await client.call("destroy_session", {
                        "session_id": sidecar_sid,
                    })
                except Exception:
                    logger.debug("[delete] sidecar destroy failed for %s", sidecar_sid[:8], exc_info=True)
            # 清理 SessionMap 映射
            smap = get_session_map()
            smap.remove(session_id)

    return await sm.delete(session_id)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    sm = request.app.state.session_manager
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if not await _delete_session_inner(sm, sidecar_mgr, session_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    # AUDIT-WIRE-001：敏感操作写入审计日志（此前审计模块无任何生产写入方）
    _audit_record("session", "delete", session_id, "会话删除")
    return {"status": "deleted"}


class BatchDeleteRequest(BaseModel):
    session_ids: list[str]


@router.post("/sessions/batch-delete")
async def batch_delete_sessions(body: BatchDeleteRequest, request: Request):
    """批量删除多个会话（best-effort，逐条清理）。"""
    sm = request.app.state.session_manager
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    deleted: list[str] = []
    for sid in body.session_ids:
        try:
            if await _delete_session_inner(sm, sidecar_mgr, sid):
                deleted.append(sid)
        except Exception:
            logger.debug("[sessions] batch delete failed for %s", sid, exc_info=True)
    return {"deleted": deleted, "count": len(deleted)}


@router.post("/sessions/clear-temp")
async def clear_temp_sessions(request: Request):
    """删除所有非固定（临时）会话。"""
    sm = request.app.state.session_manager
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    deleted: list[str] = []
    try:
        sessions = await sm.list_sessions()
    except Exception:
        logger.debug("[sessions] list failed for clear-temp", exc_info=True)
        sessions = []
    for s in sessions:
        if s.get("is_const"):
            continue
        try:
            if await _delete_session_inner(sm, sidecar_mgr, s["session_id"]):
                deleted.append(s["session_id"])
        except Exception:
            logger.debug("[sessions] clear-temp failed for %s", s["session_id"], exc_info=True)
    return {"deleted": deleted, "count": len(deleted)}


# ── Const 固定会话 ────────────────────────────────────────────


@router.post("/sessions/{session_id}/const")
async def constify_session(session_id: str, body: ConstifyRequest, request: Request):
    """将当前会话固定为 const 持久化保存。"""
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # Agent 运行中禁止固定
    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 仍在运行中，无法固定会话")

    # 从 sidecar 提取消息
    serialized = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
            client = sidecar_mgr.client
        except Exception:
            logger.debug("[sessions] sidecar start failed, skip sidecar path", exc_info=True)
            client = None
        if client is not None:
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("get_messages", {
                        "session_id": sidecar_sid,
                        "limit": 200,
                    })
                    for m in result.get("messages", []):
                        role = m.get("role", "unknown")
                        content = m.get("content", "")
                        if role == "user":
                            serialized.append({"type": "human", "content": content})
                        elif role == "assistant":
                            serialized.append({"type": "ai", "content": content})
                except Exception:
                    logger.debug("Failed to get messages for constify in session %s", session_id, exc_info=True)

    from api.const_session_store import save_const_session

    metadata = session.persistent_metadata()
    save_const_session(session.session_id, body.name, metadata, serialized)

    # 标记为 const
    session.is_const = True
    session.const_name = body.name

    return {
        "session_id": session.session_id,
        "is_const": True,
        "const_name": body.name,
    }


@router.post("/sessions/{session_id}/generate-title")
async def generate_session_title(session_id: str, request: Request):
    """根据会话内容使用 LLM 生成简洁标题。"""
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 从 sidecar 提取消息
    messages = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
            client = sidecar_mgr.client
        except Exception:
            logger.debug("[sessions] sidecar start failed, skip sidecar path", exc_info=True)
            client = None
        if client is not None:
            from api.pi_bridge.session_adapter import get_session_map
            smap = get_session_map()
            sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("get_messages", {
                        "session_id": sidecar_sid,
                        "limit": 20,
                    })
                    messages = result.get("messages", [])
                except Exception:
                    logger.debug("Failed to get messages for title generation in session %s", session_id, exc_info=True)

    if not messages:
        raise HTTPException(status_code=400, detail="没有消息可供生成标题")

    # 构建对话文本（截断长内容）
    conversation_lines = []
    for m in messages:
        role = m.get("role", "unknown")
        content = m.get("content", "")[:600]
        conversation_lines.append(f"[{role}]\n{content}")
    conversation_text = "\n\n".join(conversation_lines)

    system_prompt = """你是一个对话标题生成器。根据用户和助理的对话内容，生成一个简短的标题。

## 规则（必须严格遵守）

1. **忠实概括**：标题必须基于对话的实际内容，不能捏造或偏离用户真实提出的问题或主题。这是最根本的原则。
2. **核心主题**：准确抓住整个对话中最主要、最核心的主题或意图。如果用户问了多个问题，优先选择覆盖最广或最重要的那个。
3. **简洁凝练**：标题通常很短，一般为5-10个字，力求用最少的词概括最多信息。剔除冗余词语，保留关键词。
4. **区分度**：生成的标题应能明显区别于用户历史对话中的其他标题，便于快速定位和识别不同对话。
5. **通用可读**：不使用具体的"您"、"我"等指代词，也不包含"对话关于…"这样的描述性前缀。标题本身是名词性短语，直接陈述主题（如"Python爬虫入门"）。
6. **中性客观**：不添加情感色彩或主观评价（如不写成"令人困惑的数学问题"），也不使用指令式语气（如"请总结这个对话"）。

## 输出格式

只输出标题本身，不要有任何额外文字、引号或标点符号。"""

    prompt = f"{system_prompt}\n\n对话内容：\n{conversation_text}\n\n标题："

    title = None

    # 优先通过 sidecar RPC 调用 LLM（经过 OMP ModelRegistry 整体 Provider 路由）
    if sidecar_mgr is not None:
        try:
            await sidecar_mgr.start()
            client = sidecar_mgr.client
        except Exception:
            logger.debug("[sessions] sidecar start failed, skip sidecar path", exc_info=True)
            client = None
        if client is not None:
            try:
                # TITLE-FIX-001：此前调用不存在的 "chat" RPC 方法（sidecar 方法
                # 清单无此方法 → 必返 Unknown method），fallback 的 app.state.llm
                # 又从未被赋值 → 标题生成按钮 100% 失败。改用 headless_prompt
                # （真实存在的 RPC，走 OMP ModelRegistry 路由），并显式 30s 超时
                # 防止模型挂起时标题按钮无限转圈。
                result = await client.call("headless_prompt", {
                    "message": prompt,
                    "max_tokens": 50,
                }, timeout=30)
                raw = result.get("answer", "") or ""
                title = raw.strip().strip('"').strip("'")
            except Exception as e:
                logger.warning("[generate-title] sidecar RPC 失败，尝试直连: %s", e)

    # fallback：直连 LLM（当 sidecar 不可用或返回空内容时）
    if not title:
        try:
            llm = getattr(request.app.state, "llm", None)
            if llm is None:
                raise HTTPException(
                    status_code=503,
                    detail="标题生成需要 sidecar 连接，但 sidecar 不可用",
                )
            response = await llm.ainvoke(prompt)
            title = (
                response.content.strip().strip('"').strip("'")
                if hasattr(response, "content")
                else str(response).strip()
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"标题生成失败: {e}")

    title = title[:50] if title else "未命名会话"
    return {"title": title}


@router.delete("/sessions/{session_id}/const")
async def unconstify_session(session_id: str, request: Request):
    """取消固定，删除磁盘文件。"""
    # 修复 PATH-TRAVERSAL-001：session_id 只允许安全字符（uuid hex 等），
    # 拒绝路径分隔符/`..`——此前未校验直接拼 `_CONST_DIR / f"{session_id}.yaml"`，
    # Starlette 解码 %2F 后可穿越目录删除任意 .yaml
    if not session_id or "/" in session_id or "\\" in session_id or ".." in session_id or not _SAFE_SID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="非法的 session_id")

    from api.const_session_store import delete_const_session

    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")

    delete_const_session(session_id)
    session.is_const = False
    session.const_name = ""

    return {"status": "ok"}
