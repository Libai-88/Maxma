"""REST API — 会话 CRUD + Const 固定会话。"""

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.context_usage import estimate_context_usage
from agent.prompts import get_system_prompt_parts

logger = logging.getLogger(__name__)

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
        "permission_mode": session.permission_mode if enabled else "ask",
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
        raise HTTPException(status_code=404, detail="Session not found")
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
        raise HTTPException(status_code=404, detail="Session not found")
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
        raise HTTPException(status_code=404, detail="Session not found")

    if not _permission_modes_enabled():
        # The flag preserves the legacy approval semantics, so an inactive
        # endpoint must not leave a latent elevated value on the session.
        raise HTTPException(status_code=409, detail="Permission modes are unavailable")

    try:
        session.set_permission_mode(body.permission_mode)
    except ValueError:
        # The request model normally catches this first.  Keep the boundary
        # fail-closed if an alternative SessionState implementation rejects it.
        raise HTTPException(status_code=422, detail="Unsupported permission mode") from None

    return _permission_mode_metadata(session, enabled=True)


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, request: Request, limit: int = 50):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

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
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is not None:
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
                sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    result = await client.call("get_messages", {
                        "session_id": sidecar_sid,
                        "limit": limit,
                    })
                    return {
                        "session_id": session_id,
                        "messages": result.get("messages", []),
                        "total": result.get("total", 0),
                    }
                except Exception:
                    logger.debug("[messages] sidecar fetch failed for %s", session_id, exc_info=True)

    # fallback: 从 SessionMap 的 recent turns 获取
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as smap:
        turns = smap.get_recent_turns(session_id, count=limit)
    messages = []
    for t in turns:
        messages.append({"role": "user", "content": t.get("user", "")})
        messages.append({"role": "assistant", "content": t.get("assistant", "")})
    return {"session_id": session_id, "messages": messages, "total": len(messages)}


async def _sync_const_session_after_undo(session, deleted: int, *, sidecar_mgr=None):
    """Sync const session YAML after undo. sidecar 模式下从 sidecar 获取消息。"""
    if session.is_const and deleted > 0:
        from api.const_session_store import save_const_session

        try:
            # 从 sidecar 获取当前消息列表
            from api.pi_bridge.session_adapter import SessionMap
            sidecar_sid = None
            with SessionMap() as smap:
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
            await sidecar_mgr.start()
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
    if n < 1:
        return {"deleted_count": 0}
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── Sidecar path ──────────────────────────────────────────────
    mgr = getattr(request.app.state, "sidecar_manager", None)
    if mgr is not None:
        await mgr.start()
        client = mgr.client
        if client is not None:
            # 注入 sidecar manager 到 session
            session._sidecar_mgr = mgr
            # 优先从 SessionMap（持久化 SQLite）查找 sidecar session ID
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
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
                    session.message_count = max(0, session.message_count - deleted)
                    await _sync_const_session_after_undo(session, deleted, sidecar_mgr=mgr)
                    return {"deleted_count": deleted}
                except Exception:
                    logger.debug("[undo] sidecar undo failed for %s", session_id, exc_info=True)

    # sidecar 不可用时的降级响应
    raise HTTPException(status_code=503, detail="Undo 需要 sidecar 连接")


@router.get("/sessions/{session_id}/context-usage")
async def get_context_usage(session_id: str, request: Request):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    mgr = getattr(request.app.state, "provider_manager", None)
    max_tokens = 256_000
    model_name = ""
    if mgr is not None and mgr.count > 0:
        for provider in mgr.iter_enabled():
            max_tokens = provider.config.context_window
            model_name = provider.default_model
            break

    system_prompt = request.app.state.system_prompt or ""

    # sidecar 模式：从 sidecar 获取消息估算用量
    counting_messages = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is not None:
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
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


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    sm = request.app.state.session_manager
    session = await sm.get(session_id)

    # 若为 const 会话，先清理磁盘文件
    if session is not None and session.is_const:
        from api.const_session_store import delete_const_session

        delete_const_session(session_id)

    # BUG8 fix: 清理 sidecar session（防止内存泄漏）
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        await sidecar_mgr.start()
        if sidecar_mgr.client is not None:
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
                sidecar_sid = smap.get_sidecar_id(session_id)
            if not sidecar_sid and session is not None:
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
            if sidecar_sid:
                try:
                    await sidecar_mgr.client.call("destroy_session", {
                        "session_id": sidecar_sid,
                    })
                except Exception:
                    logger.debug("[delete] sidecar destroy failed for %s", sidecar_sid[:8], exc_info=True)
            # 清理 SessionMap 映射
            with SessionMap() as smap:
                smap.remove(session_id)

    if not await sm.delete(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# ── Const 固定会话 ────────────────────────────────────────────


@router.post("/sessions/{session_id}/const")
async def constify_session(session_id: str, body: ConstifyRequest, request: Request):
    """将当前会话固定为 const 持久化保存。"""
    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Agent 运行中禁止固定
    if session._active_task is not None and not session._active_task.done():
        raise HTTPException(status_code=409, detail="Agent 仍在运行中，无法固定会话")

    # 从 sidecar 提取消息
    serialized = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is not None:
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
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
        raise HTTPException(status_code=404, detail="Session not found")

    # 从 sidecar 提取消息
    messages = []
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is not None:
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is not None:
            from api.pi_bridge.session_adapter import SessionMap
            with SessionMap() as smap:
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

    try:
        llm = request.app.state.llm
        response = await llm.ainvoke(prompt)
        title = (
            response.content.strip().strip('"').strip("'")
            if hasattr(response, "content")
            else str(response).strip()
        )
        title = title[:50]
        if not title:
            title = "未命名会话"
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"标题生成失败: {e}")

    return {"title": title}


@router.delete("/sessions/{session_id}/const")
async def unconstify_session(session_id: str, request: Request):
    """取消固定，删除磁盘文件。"""
    from api.const_session_store import delete_const_session

    delete_const_session(session_id)

    sm = request.app.state.session_manager
    session = await sm.get(session_id)
    if session is not None:
        session.is_const = False
        session.const_name = ""

    return {"status": "ok"}
