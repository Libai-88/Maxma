"""WebSocket endpoint — streaming OMP sidecar proxy.

Thin WS↔JSON-RPC bridge: receives user messages, forwards to sidecar,
streams intermediate events back to frontend, and saves const sessions.
"""

import asyncio
import base64
import hashlib
import inspect
import json
import logging
import os
import re
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.prompts import build_system_prompt
from api.routes.tools import _BUILTIN_TOOLS as _CHAT_BUILTIN_TOOLS
from api.activity_hub import record as record_activity
from api.routes.providers import _decrypt_api_key, _find_provider, _load_providers
from api.const_session_store import save_const_session
from api.middleware.rate_limit import get_ws_rate_limiter
from api.pi_bridge.session_adapter import get_session_map
from api.session_manager import SessionState
from api.ws_protocol import WsEventType, WsMessageType, CLIENT_MESSAGE_TYPES
from api.yaml_store import yaml_file_lock
from app_paths import PROJECT_ROOT, PROVIDERS_YAML_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

_PUBLIC_TURN_ERROR = "后端处理失败，请稍后重试"


async def _get_sidecar_client(sidecar_mgr):
    """Return a sidecar client via the manager's ``get_client()`` lifecycle API.

    Supports both sync and async return values. Test doubles must implement
    ``get_client()`` rather than exposing a ``client`` attribute, so production
    code stays free of mock-aware type sniffing.
    """
    client = sidecar_mgr.get_client()
    if inspect.isawaitable(client):
        client = await client
    if client is None:
        raise RuntimeError("Sidecar client not available after start()")
    return client


async def _cancel_sidecar_turn(
    sidecar_mgr,
    sidecar_session_id: str | None,
    *,
    reason: str,
) -> None:
    """Best-effort cancellation that also works with legacy client fakes."""
    if sidecar_mgr is None or not sidecar_session_id:
        return
    try:
        await sidecar_mgr.start()
        client = await _get_sidecar_client(sidecar_mgr)
        await client.call("cancel", {"session_id": sidecar_session_id})
    except Exception:
        logger.warning(
            "[sidecar] Failed to cancel after %s for session %s",
            reason,
            sidecar_session_id[:8],
            exc_info=True,
        )


def _resolve_chat_model(provider_id: str, model_name: str) -> dict[str, str | int]:
    """Resolve the browser's provider/model selection for the sidecar."""
    requested_model = model_name.strip() or "gpt-4o"
    requested_provider = provider_id.strip()
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        provider = _find_provider(_load_providers(), requested_provider)

    if provider is None:
        return {
            "provider": requested_provider or "openai",
            "model": requested_model,
            "base_url": "",
            "api_key": "",
            "provider_type": "openai",
            "context_window": 128000,
        }

    models = provider.get("models")
    selected_model = requested_model
    if isinstance(models, list) and models and selected_model not in models:
        selected_model = str(models[0])
    return {
        "provider": str(provider.get("id") or requested_provider or "openai"),
        "model": selected_model,
        "base_url": str(provider.get("base_url") or ""),
        "api_key": _decrypt_api_key(provider.get("api_key")),
        "provider_type": str(provider.get("provider_type") or "openai"),
        "context_window": int(provider.get("context_window") or 128000),
    }


# ── Phase 2.2: Artifact 合成辅助 ──

_FILE_WRITING_TOOLS = frozenset({"write", "edit", "create"})

_MAX_ARTIFACT_BODY = 2000  # body 字符上限（前端 isInteractiveArtifact 限制 4000）


def _extract_file_path_from_output(output: str) -> str | None:
    """从工具输出字符串中提取文件路径。

    侧边栏将工具结果序列化为 JSON，格式如：
      {"content":[{"type":"text","text":"Successfully wrote 13 bytes to /path/to/file.txt"}],"details":{}}
    此函数尝试解析 JSON 并提取文件路径。
    """
    text = output
    # 尝试解析 JSON
    try:
        data = json.loads(output)
        if isinstance(data, dict):
            # 从 content 块提取文本
            content = data.get("content", [])
            if isinstance(content, list):
                texts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                if texts:
                    text = " ".join(texts)
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    # 匹配 "to /path/to/file" 或 "Edited /path/to/file" 中的路径
    for pattern in (
        r'(?:to|at|:)\s*(/[^\s,.;!?\'"]+)',   # Unix 绝对路径
        r'(?:to|at|:)\s*([A-Za-z]:\\[^\s,.;!?\'"]+)',  # Windows 绝对路径
    ):
        for match in re.finditer(pattern, text, re.IGNORECASE):
            path = match.group(1).strip().rstrip(".,;:!?\"'")
            if os.path.isfile(path):
                return os.path.normpath(path)

    # 兜底：扫描输出中所有存在的文件路径
    for word in text.split():
        word = word.strip().rstrip(".,;:!?\"'")
        if os.path.isfile(word):
            return os.path.normpath(word)

    return None


def _build_artifact_payload(file_path: str) -> dict | None:
    """读取文件并构建 InteractiveArtifact 负载。

    返回符合前端 InteractiveArtifact 类型的 dict，若文件不可读则返回 None。
    """
    if not os.path.isfile(file_path):
        return None
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (OSError, PermissionError):
        return None

    file_id = hashlib.md5(file_path.encode("utf-8")).hexdigest()  # 32 字符 hex
    filename = os.path.basename(file_path)
    token = base64.b64encode(file_path.encode("utf-8")).decode("ascii")

    # 截断并 sanitize body（不包含 HTML 标签）
    preview = content[:_MAX_ARTIFACT_BODY]
    if len(content) > _MAX_ARTIFACT_BODY:
        preview += "\n\n... (内容已截断)"
    preview = preview.replace("<", "&lt;").replace(">", "&gt;")

    return {
        "version": 1,
        "id": file_id,
        "type": "choice",
        "title": filename,
        "body": preview,
        "actions": [
            {"id": "preview", "label": "预览", "token": token, "style": "primary"},
            {"id": "open", "label": "打开", "token": token, "style": "secondary"},
        ],
    }


async def _get_messages_from_sidecar(
    session: SessionState,
    limit: int = 50,
    *,
    sidecar_mgr=None,
) -> list[dict]:
    """Fetch message history from sidecar.

    Uses SessionMap (SQLite) to look up the sidecar session ID, then calls
    the get_messages RPC. Returns empty list if sidecar is unavailable.
    """
    if sidecar_mgr is None:
        sidecar_mgr = getattr(session, "_sidecar_mgr", None)
    if sidecar_mgr is None:
        return []
    await sidecar_mgr.start()
    try:
        client = await _get_sidecar_client(sidecar_mgr)
    except RuntimeError:
        return []
    sm = get_session_map()
    sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        return []
    try:
        result = await client.call(
            "get_messages",
            {"session_id": sidecar_sid, "limit": limit},
        )
        return result.get("messages", [])
    except Exception:
        logger.debug("[sidecar] get_messages failed", exc_info=True)
        return []


async def _stream_turn_sidecar(
    ws: WebSocket,
    session: SessionState,
    user_message: str,
    system_prompt: str,
    model_config: dict[str, str] | None = None,
    cancel_event: asyncio.Event | None = None,
    *,
    use_append: bool = False,
) -> str:
    """Execute a turn via oh-my-pi sidecar (Bun subprocess).

    Streams all sidecar events (token, thinking_*, tool_*, ask_user,
    retry_*, notice, sub_session_created, memory_*, plan_* 等)
    to the frontend in real-time via transparent forwarding.
    Returns the final answer string.
    """
    model_config = model_config or {}
    app_state = ws.app.state

    # 1. Ensure sidecar is running
    mgr = app_state.sidecar_manager
    await mgr.start()
    client = await _get_sidecar_client(mgr)
    session._sidecar_mgr = mgr

    # 2. Look up or create sidecar session
    sm = get_session_map()
    sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)

    # Validate existing sidecar session (stale after server restart)
    sidecar_valid = False
    if sidecar_sid:
        try:
            await client.call(
                "get_messages",
                {"session_id": sidecar_sid, "limit": 0},
            )
            sidecar_valid = True
        except Exception:
            logger.info(
                "[sidecar] Stale session %s — clearing mapping",
                sidecar_sid[:8],
            )
            sidecar_sid = None
            sm = get_session_map()
            sm.remove(session.session_id)

    if not sidecar_sid:
        # Build system prompt with recent past turns for continuity
        _sidecar_system_prompt = system_prompt
        try:
            sm = get_session_map()
            _past_turns = sm.get_recent_turns(session.session_id, count=5)
            if _past_turns:
                _history_lines = []
                for t in _past_turns:
                    _history_lines.append(f"用户: {t.get('user', '')}")
                    _history_lines.append(f"助理: {t.get('assistant', '')}")
                _history_text = "\n".join(_history_lines)
                _sidecar_system_prompt = (
                    f"{system_prompt}\n\n"
                    f"[历史对话上下文（共 {len(_past_turns)} 轮）]\n"
                    f"{_history_text}\n"
                )
                logger.info(
                    "[sidecar] Restored %d past turns for session %s",
                    len(_past_turns),
                    session.session_id[:8],
                )
        except Exception:
            logger.debug("[sidecar] Failed to restore past turns", exc_info=True)

        # 计算生效的权限模式传给 sidecar 决定工具审批策略。
        # permission_modes_enabled 关闭时（默认）用 "yolo"（自动批准所有工具），
        # 避免 always-ask 阻塞 write/exec 级别工具调用（B-014）。
        try:
            from config.settings import get_settings
            _pm_enabled = bool(get_settings().permission_modes_enabled)
        except Exception:
            _pm_enabled = False
        if session.auto_approve:
            _effective_permission_mode = "yolo"
        elif _pm_enabled:
            _effective_permission_mode = session.permission_mode
        else:
            _effective_permission_mode = "yolo"

        # 传入可用工具名列表，让 OMP session 正确注册 function calling
        _session_tools = [t["name"] for t in _CHAT_BUILTIN_TOOLS if isinstance(t, dict) and t.get("name")]

        # 原生提示词模式：走 OMP append_system_prompt（追加到 OMP 原生 prompt 之后），
        # 不传 system_prompt，避免整体替换 OMP 原生的 harness prompt。
        # 品牌模式：传 system_prompt（整体替换，旧行为）。
        _prompt_field = "append_system_prompt" if use_append else "system_prompt"
        result = await client.call(
            "create_session",
            {
                **model_config,
                _prompt_field: _sidecar_system_prompt,
                # B-002: forward the actual project root so the agent's logical
                # cwd resolves to the user's project (not the sidecar's bun-sidecar/
                # source directory). Must agree with MAXMA_PROJECT_ROOT env var set
                # in sidecar_manager.py (B-001).
                "cwd": str(PROJECT_ROOT),
                "permission_mode": _effective_permission_mode,
                "tools": _session_tools,
            },
        )
        sidecar_sid = result["session_id"]
        session._sidecar_session_id = sidecar_sid
        sm = get_session_map()
        sm.set_mapping(session.session_id, sidecar_sid)
        logger.info(
            "[sidecar] Created session %s for Maxma session %s",
            sidecar_sid[:8],
            session.session_id[:8],
        )

    # Keep the active sid on the in-memory session even when the persisted
    # mapping was reused, so disconnect/cancel paths can target this turn.
    session._sidecar_session_id = sidecar_sid

    # 3. Register event handlers to forward intermediate events to WS
    final_answer = ""
    turn_done = asyncio.Event()

    def _make_handler(evt_type: str):
        async def handler(sid: str, event: dict):
            if sid != sidecar_sid:
                return
            try:
                payload = event.get("payload", {})
                if evt_type == WsEventType.TOKEN:
                    await ws.send_json(
                        {"type": WsEventType.TOKEN, "payload": {"token": payload.get("token", "")}}
                    )
                elif evt_type == WsEventType.TOOL_START:
                    record_activity(
                        "tool", "tool_start",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="调用工具",
                    )
                    await ws.send_json(
                        {"type": WsEventType.TOOL_START, "payload": {"tool_name": payload.get("tool_name", ""), "input": payload.get("input", "")}}
                    )
                elif evt_type == WsEventType.TOOL_END:
                    record_activity(
                        "tool", "tool_end",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="工具执行完成",
                    )
                    await ws.send_json(
                        {"type": WsEventType.TOOL_END, "payload": {"tool_name": payload.get("tool_name", ""), "output": payload.get("output", ""), "elapsed": payload.get("elapsed", 0)}}
                    )
                    # Phase 2.2: 检测文件写入型工具，合成 artifact 事件
                    tool_name = payload.get("tool_name", "")
                    if tool_name in _FILE_WRITING_TOOLS:
                        output = payload.get("output", "")
                        file_path = _extract_file_path_from_output(output)
                        if file_path:
                            artifact = _build_artifact_payload(file_path)
                            if artifact:
                                await ws.send_json({"type": WsEventType.ARTIFACT, "payload": artifact})
                                logger.info(
                                    "[artifact] Synthesized artifact for %s (tool=%s, session=%s)",
                                    file_path, tool_name, session.session_id[:8],
                                )
                elif evt_type == WsEventType.TOOL_ERROR:
                    record_activity(
                        "tool", "tool_error",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        level="error",
                        message=str(payload.get("error", "")) or "工具执行出错",
                    )
                    await ws.send_json(
                        {"type": WsEventType.TOOL_ERROR, "payload": {"tool_name": payload.get("tool_name", ""), "error": payload.get("error", "")}}
                    )
                elif evt_type == WsEventType.ERROR:
                    # 前端 ChatWindow 渲染 errorTraceId（Trace 显示）和 errorCategory
                    # （样式/图标），但此前 sidecar 只给 code+message，两字段永远 null（A2）。
                    # 为每条 sidecar error 生成 trace_id，并按 code 映射 category。
                    error_code = str(payload.get("code", "SIDECAR_ERROR"))
                    error_message = str(payload.get("message", "")) or "Sidecar error"
                    error_trace_id = uuid.uuid4().hex
                    SYSTEM_ERROR_CODES = {
                        "AGENT_ERROR", "SIDECAR_ERROR", "PROMPT_ERROR",
                        "PROMPT_TIMEOUT", "SIDECAR_UNAVAILABLE",
                    }
                    error_category = "system_error" if error_code in SYSTEM_ERROR_CODES else "tool_error"
                    logger.warning(
                        "[sidecar] Error for session %s: %s (trace=%s)",
                        sidecar_sid[:8], error_message, error_trace_id,
                    )
                    record_activity(
                        "turn", "error",
                        session_id=session.session_id,
                        level="error",
                        trace_id=error_trace_id,
                        message=error_message,
                    )
                    await ws.send_json(
                        {
                            "type": WsEventType.ERROR,
                            "payload": {
                                "code": error_code,
                                "message": error_message,
                                "trace_id": error_trace_id,
                                "category": error_category,
                            },
                        }
                    )
                else:
                    # Generic transparent forwarding for all other subscribed events
                    await ws.send_json({"type": evt_type, "payload": payload})
            except Exception as e:
                logger.warning("[sidecar] Failed to forward %s event to WS: %s", evt_type, e)
        return handler

    async def _on_answer(sid: str, event: dict):
        nonlocal final_answer
        if sid == sidecar_sid:
            final_answer = event.get("payload", {}).get("content", "")

    async def _on_done(sid: str, event: dict):
        if sid == sidecar_sid:
            turn_done.set()

    async def _on_deferred(sid: str, event: dict):
        """Store deferred run data from sidecar and forward to WS."""
        if sid != sidecar_sid:
            return
        try:
            payload = event.get("payload", {})
            run_data = {
                "run_id": payload.get("run_id", ""),
                "parent_turn_id": payload.get("parent_turn_id"),
                "status": payload.get("status", "queued"),
                "result_ref": payload.get("result_ref"),
                "result": payload.get("result"),
                "cancel_reason": payload.get("cancel_reason"),
                "deadline_at": payload.get("deadline_at"),
                "attempts": payload.get("attempts", 0),
                "error_code": payload.get("error_code"),
            }
            mgr = getattr(app_state, "deferred_run_manager", None)
            if mgr:
                await mgr.add_or_update(session.session_id, run_data)
        except Exception as e:
            logger.warning("[deferred] Failed to store deferred run: %s", e)
        # Forward to frontend via WebSocket
        try:
            await ws.send_json({"type": WsEventType.DEFERRED_SUBAGENT_SUBMITTED, "payload": event.get("payload", {})})
        except Exception as e:
            logger.warning("[deferred] Failed to forward to WS: %s", e)

    unsubs = []
    for evt_type in (WsEventType.TOKEN, WsEventType.TOOL_START, WsEventType.TOOL_END, WsEventType.TOOL_ERROR, WsEventType.ERROR):
        unsubs.append(client.on(evt_type, _make_handler(evt_type)))
    # Generic forwarding for event types that need no per-type enrichment.
    # 所有 sidecar 发射的事件均透传到前端，前端 useChat.ts 有对应 handler。
    for evt_type in (
        WsEventType.ASK_USER,
        WsEventType.CONTEXT_COMPRESSED,
        WsEventType.CONTEXT_COMPRESSING,
        WsEventType.THINKING_START,
        WsEventType.THINKING_DELTA,
        WsEventType.THINKING_END,
        WsEventType.TOOL_UPDATE,
        WsEventType.RETRY_START,
        WsEventType.RETRY_END,
        WsEventType.TODO_REMINDER,
        WsEventType.NOTICE,
        WsEventType.IRC_MESSAGE,
        WsEventType.SUB_SESSION_CREATED,
        WsEventType.MEMORY_START,
        WsEventType.MEMORY_TOOL_START,
        WsEventType.MEMORY_TOOL_END,
        WsEventType.MEMORY_TOOL_ERROR,
        WsEventType.MEMORY_DONE,
        WsEventType.PLAN_PROPOSED,
        WsEventType.PLAN_STEP_START,
        WsEventType.PLAN_STEP_END,
        WsEventType.PLAN_STEP_ERROR,
        WsEventType.PLAN_COMPLETED,
    ):
        unsubs.append(client.on(evt_type, _make_handler(evt_type)))
    unsubs.append(client.on(WsEventType.ANSWER, _on_answer))
    unsubs.append(client.on(WsEventType.DONE, _on_done))
    unsubs.append(client.on(WsEventType.DEFERRED_SUBAGENT_SUBMITTED, _on_deferred))

    # 4. Execute prompt via sidecar
    record_activity(
        "turn", "turn_start",
        session_id=session.session_id,
        message=user_message,
    )
    try:
        await client.call(
            "prompt",
            {"session_id": sidecar_sid, "message": user_message},
        )
        # Wait for turn_done, cancel_event, or timeout
        if cancel_event:
            wait_tasks = [
                asyncio.create_task(turn_done.wait()),
                asyncio.create_task(cancel_event.wait()),
            ]
            done, pending = await asyncio.wait(
                wait_tasks,
                timeout=600,
                return_when=asyncio.FIRST_COMPLETED,
            )
            for pending_task in pending:
                pending_task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if not done:
                raise asyncio.TimeoutError
            if cancel_event.is_set():
                logger.info("[sidecar] Turn cancelled for session %s", sidecar_sid[:8])
                try:
                    await client.call("cancel", {"session_id": sidecar_sid})
                except Exception as e:
                    logger.warning("[sidecar] Failed to cancel after cancel_event for session %s: %s", sidecar_sid[:8], e)
                if not final_answer:
                    final_answer = ""
                return final_answer
        else:
            await asyncio.wait_for(turn_done.wait(), timeout=600)
    except asyncio.TimeoutError:
        logger.warning(
            "[sidecar] Turn timed out for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as e:
            logger.warning("[sidecar] Failed to cancel after timeout for session %s: %s", sidecar_sid[:8], e)
        raise
    except Exception as e:
        logger.exception(
            "[sidecar] Turn failed for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as cancel_err:
            logger.warning("[sidecar] Failed to cancel after error for session %s: %s", sidecar_sid[:8], cancel_err)
        if not final_answer:
            final_answer = _PUBLIC_TURN_ERROR
    finally:
        for unsub in unsubs:
            try:
                unsub()
            except Exception as e:
                logger.warning("[sidecar] Failed to unsubscribe handler: %s", e)

    return final_answer


async def _calculate_context_usage(
    session,
    system_prompt,
    *,
    max_tokens: int = 256_000,
    model_name: str = "",
) -> dict:
    """Estimate context usage from sidecar message history."""
    messages = await _get_messages_from_sidecar(session, limit=200)
    total_chars = sum(len(m.get("content", "")) for m in messages)
    total_chars += len(system_prompt or "")
    estimated_tokens = int(total_chars / 2)
    return {
        "estimated_tokens": estimated_tokens,
        "max_tokens": max_tokens,
        "percentage": min(
            100, int(estimated_tokens / max(max_tokens, 1) * 100)
        ),
        "message_count": len(messages),
        "model_name": model_name,
    }


def _new_turn_id(turn_id: object = None) -> str:
    """Return a validated client id or create one before execution begins."""
    if isinstance(turn_id, str):
        candidate = turn_id.strip()
        if candidate and len(candidate) <= 128:
            return candidate
    return uuid.uuid4().hex


async def _save_const_session(
    session: SessionState, final_answer: str
) -> None:
    """Persist const session messages to YAML on disk."""
    try:
        messages = await _get_messages_from_sidecar(session, limit=200)
        if not messages:
            return
        serialized = []
        for m in messages:
            role = m.get("role", "unknown")
            content = m.get("content", "")
            if role == "user":
                serialized.append({"type": "human", "content": content})
            elif role == "assistant":
                serialized.append({"type": "ai", "content": content})
        for item in reversed(serialized):
            if item.get("type") == "ai":
                item["content"] = final_answer
                break
        metadata = session.persistent_metadata()
        save_const_session(
            session.session_id, session.const_name, metadata, serialized
        )
    except Exception as e:
        logger.warning(
            "[const] Failed to save session %s: %s",
            session.session_id[:8], e,
        )


@router.websocket("/ws/chat/{session_id}")
async def websocket_chat(ws: WebSocket, session_id: str):
    """WebSocket chat endpoint — proxy to OMP sidecar."""
    await ws.accept()
    app_state = ws.app.state
    session = await app_state.session_manager.get_or_create(session_id)
    app_state.ws_registry.register(session_id, ws)

    turn_task: asyncio.Task | None = None
    cancel_event = asyncio.Event()
    # Context captured when a turn is started, used when it completes
    _turn_user_message: str = ""
    _turn_system_prompt: str = ""
    _turn_id: str = ""
    _turn_model_config: dict[str, str | int] = {}

    async def _handle_turn_result(
        task: asyncio.Task,
    ) -> None:
        """Process a completed turn task's result (send answer/done to WS)."""
        nonlocal turn_task
        if task.cancelled():
            # cancel 分支同时 cancel_event.set() + turn_task.cancel()：后者注入的
            # CancelledError 是 BaseException，逃过 _stream_turn_sidecar 的 except Exception，
            # task 以 cancelled=True 结束。若在此直接 return 不发 done，前端 isStreaming 会
            # 永久卡死。补发一个带 cancelled 标记的 done 闭合状态机（A1）。
            try:
                await ws.send_json(
                    {
                        "type": WsEventType.DONE,
                        "payload": {
                            "turn_id": _new_turn_id(_turn_id),
                            "cancelled": True,
                        },
                    }
                )
            except Exception:
                logger.debug("[ws] Failed to report cancellation done", exc_info=True)
            record_activity(
                "turn", "turn_cancelled",
                session_id=session.session_id,
                turn_id=_turn_id or "",
                message="对话轮次被取消",
            )
            turn_task = None
            return
        try:
            final_answer = task.result()
        except Exception:
            logger.exception("[ws] Turn task failed for session %s", session_id[:8])
            record_activity(
                "turn", "turn_error",
                session_id=session.session_id,
                turn_id=_turn_id or "",
                level="error",
                message="对话轮次处理失败",
            )
            try:
                await ws.send_json(
                    {
                        "type": WsEventType.ERROR,
                        "payload": {
                            "code": "SIDECAR_UNAVAILABLE",
                            "message": "后端处理失败，请稍后重试",
                        },
                    }
                )
                await ws.send_json(
                    {
                        "type": WsEventType.DONE,
                        "payload": {"turn_id": _new_turn_id(_turn_id)},
                    }
                )
            except Exception:
                logger.debug("[ws] Failed to report turn failure", exc_info=True)
            turn_task = None
            return

        um = _turn_user_message
        sp = _turn_system_prompt
        tid = _turn_id

        if final_answer:
            await ws.send_json(
                {"type": WsEventType.ANSWER, "payload": {"content": final_answer}}
            )
            session.message_count += 2

            try:
                sm = get_session_map()
                sm.append_turn(session.session_id, um, final_answer)
            except Exception:
                logger.debug(
                    "[sidecar] Failed to save turn to SessionMap",
                    exc_info=True,
                )

            if session.is_const:
                await _save_const_session(session, final_answer)

        context_usage = await _calculate_context_usage(
            session,
            sp,
            max_tokens=int(_turn_model_config.get("context_window") or 128000),
            model_name=str(_turn_model_config.get("model") or ""),
        )

        await ws.send_json(
            {
                "type": WsEventType.DONE,
                "payload": {
                    "turn_id": _new_turn_id(tid),
                    "context_usage": context_usage,
                },
            }
        )
        record_activity(
            "turn", "turn_end",
            session_id=session.session_id,
            turn_id=tid or "",
            message=final_answer or "(本轮无最终回复)",
            payload={"context_usage": context_usage},
        )
        turn_task = None

    try:
        while True:
            # Process a completed turn before waiting for new messages
            if turn_task and turn_task.done():
                await _handle_turn_result(turn_task)
                continue

            # Wait for a new message or the current turn to complete
            if turn_task and not turn_task.done():
                recv_task = asyncio.create_task(ws.receive_text())
                done, pending = await asyncio.wait(
                    [recv_task, turn_task],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if turn_task in done:
                    if not recv_task.done():
                        recv_task.cancel()
                    try:
                        await recv_task
                    except asyncio.CancelledError:
                        pass
                    await _handle_turn_result(turn_task)
                    continue
                raw = recv_task.result()
            else:
                raw = await ws.receive_text()

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue

            msg_type = msg.get("type")

            if msg_type == WsMessageType.PING:
                await ws.send_json({"type": "pong"})
                continue

            # Whitelist of known message types — discard unknown
            if msg_type not in CLIENT_MESSAGE_TYPES:
                logger.debug("[ws] Unknown message type: %s", msg_type)
                continue

            # ── Cancel ──
            if msg_type == WsMessageType.CANCEL:
                if turn_task and not turn_task.done():
                    cancel_event.set()
                    turn_task.cancel()
                    if session._sidecar_session_id:
                        try:
                            mgr = app_state.sidecar_manager
                            await mgr.start()
                            # A5: 用 get_client() 而非裸 mgr.client —— 当 RPC 读循环已崩
                            # 但进程仍活着时，mgr.client 可能为 None 或 is_running=False，
                            # 此处会 RuntimeError；get_client() 会透明重启 sidecar。
                            client = await _get_sidecar_client(mgr)
                            await client.call(
                                "cancel",
                                {"session_id": session._sidecar_session_id},
                            )
                        except Exception:
                            logger.debug(
                                "[ws] Failed to send cancel to sidecar",
                                exc_info=True,
                            )
                continue

            # ── Auxiliary messages ──
            # B1: 仅 user_response 在 sidecar 有 RPC handler（session-bridge.ts:1064）。
            # plan_response / artifact_action / update_auto_approve 此前被当 RPC 方法名
            # 透传，但 sidecar dispatcher 只认 10 个方法 → 必返 "Unknown method" 错误，
            # 后端 logger.debug 吞掉，功能从未生效（黑洞）。接通需 SDK 深改（plan-mode
            # 事件暴露到 subscribe 流 / ArtifactManager 事件化 / OMP 运行时 approvalMode
            # 切换），超 bridge 范围。此处不再黑洞转发，避免无谓 RPC + 错误往返。
            # 前端 send 函数保留（UI 不破坏），后续接通只需在此加分支。
            if msg_type == WsMessageType.USER_RESPONSE:
                if session._sidecar_session_id:
                    try:
                        mgr = app_state.sidecar_manager
                        await mgr.start()
                        client = await _get_sidecar_client(mgr)  # A5: 同 cancel
                        await client.call(
                            "user_response",
                            {
                                "session_id": session._sidecar_session_id,
                                **msg.get("payload", {}),
                            },
                        )
                    except Exception:
                        logger.debug(
                            "[ws] Failed to forward user_response to sidecar",
                            exc_info=True,
                        )
                continue

            if msg_type == "update_auto_approve":
                _payload = msg.get("payload", {})
                auto_approve = _payload.get("auto_approve", False)
                session.auto_approve = bool(auto_approve)
                logger.info("[ws] auto_approve updated to %s for session %s", session.auto_approve, session_id[:8])
                # Forward to sidecar if available
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
                if sidecar_sid:
                    try:
                        mgr = app_state.sidecar_manager
                        await mgr.start()
                        client = await _get_sidecar_client(mgr)
                        await client.call(
                            "set_auto_approve",
                            {"session_id": sidecar_sid, "auto_approve": auto_approve},
                        )
                        logger.info("[ws] Forwarded auto_approve=%s to sidecar session %s", auto_approve, sidecar_sid[:8])
                    except Exception:
                        logger.debug("[ws] Failed to forward auto_approve to sidecar", exc_info=True)
                continue

            if msg_type == "plan_response":
                _payload = msg.get("payload", {})
                plan_id = _payload.get("plan_id", "")
                action = _payload.get("action", "")
                modified_plan = _payload.get("modified_plan")
                sidecar_sid = getattr(session, "_sidecar_session_id", None)
                if sidecar_sid:
                    try:
                        mgr = app_state.sidecar_manager
                        await mgr.start()
                        client = await _get_sidecar_client(mgr)
                        plan_payload = {
                            "session_id": sidecar_sid,
                            "plan_id": plan_id,
                            "action": action,
                        }
                        if modified_plan:
                            plan_payload["modified_plan"] = modified_plan
                        await client.call("plan_action", plan_payload)
                        logger.info("[ws] Forwarded plan_response (action=%s) to sidecar session %s", action, sidecar_sid[:8])
                    except Exception:
                        logger.debug("[ws] Failed to forward plan_response to sidecar", exc_info=True)
                continue

            if msg_type == "artifact_action":
                _payload = msg.get("payload", {})
                artifact_id = _payload.get("artifact_id", "")
                action_id = _payload.get("action_id", "")
                token = _payload.get("token", "")
                logger.info("[ws] artifact_action received: artifact=%s action=%s", artifact_id, action_id)
                # Phase 2.2: 从 token 解码文件路径，读取文件内容
                file_content = None
                file_error = None
                if token:
                    try:
                        file_path = base64.b64decode(token).decode("utf-8")
                        if os.path.isfile(file_path):
                            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                                file_content = f.read()
                        else:
                            file_error = "File not found"
                    except Exception as e:
                        file_error = str(e)
                        logger.warning("[artifact] Failed to read file from token: %s", e)
                await ws.send_json({
                    "type": "artifact_result",
                    "payload": {
                        "artifact_id": artifact_id,
                        "action_id": action_id,
                        "status": "completed" if file_content is not None else "error",
                        "content": file_content,
                        "error": file_error,
                    },
                })
                continue

            payload = msg.get("payload", {})
            if not isinstance(payload, dict):
                continue
            user_message = str(payload.get("message", "")).strip()
            if not user_message:
                continue

            # ═══ 运行时配置注入 ═══
            # AGENTS.md 声明了每轮对话注入 [运行时配置]。若缺失，
            # 模型会反复"索取"此信息，以为前端忘记发送了。
            try:
                _rt_providers = _load_providers()
                _rt_active_providers = [p for p in (_rt_providers or []) if p.get("enabled")]
                _rt_builtin = len(_CHAT_BUILTIN_TOOLS) if isinstance(_CHAT_BUILTIN_TOOLS, list) else 0
                _rt_mcp_servers = getattr(app_state, "mcp_server_info", None)
                if _rt_mcp_servers is None:
                    _rt_mcp_count = 0
                    _rt_mcp_tools = 0
                elif isinstance(_rt_mcp_servers, list):
                    _rt_mcp_count = len(_rt_mcp_servers)
                    _rt_mcp_tools = sum(s.get("tool_count", 0) for s in _rt_mcp_servers)
                else:
                    _rt_mcp_count = _rt_mcp_servers.get("count", 0)
                    _rt_mcp_tools = _rt_mcp_servers.get("tools", 0)
                _rt_lines = ["[运行时配置]"]
                _rt_lines.append(f"模型提供商({len(_rt_active_providers)}):")
                for _rt_p in _rt_active_providers[:3]:
                    _rt_lines.append(f"  - {_rt_p.get('label', _rt_p.get('id','?'))} ({_rt_p.get('provider_type','?')})")
                if _rt_mcp_count > 0:
                    _rt_lines.append(f"MCP 服务器: {_rt_mcp_count} 个, {_rt_mcp_tools} 个工具")
                _rt_lines.append(f"可用工具: {_rt_builtin + _rt_mcp_tools} 个({_rt_builtin} 原生 + {_rt_mcp_tools} MCP)")
                _rt_summary = "\n".join(_rt_lines)
                user_message = f"{_rt_summary}\n\n{user_message}"
            except Exception:
                logger.debug("[runtime] Failed to inject runtime config", exc_info=True)

            allowed, rate_limit_error = get_ws_rate_limiter().try_consume(session_id)
            if not allowed:
                await ws.send_json({"type": WsEventType.ERROR, "payload": rate_limit_error})
                continue

            # If a previous turn is still running, skip this message
            if turn_task and not turn_task.done():
                continue

            # 原生提示词模式：用最小功能注入（build_append_prompt）走 append 通道，
            # 保留 OMP 原生 harness prompt；品牌增强（brand_enhancement）在功能注入后
            # 追加品牌增强块，只做锦上添花。品牌模式（native_prompt_mode=False）
            # 回退 build_system_prompt（整体替换，保留兼容）。
            try:
                from config.settings import get_settings
                _settings = get_settings()
                _native = bool(_settings.native_prompt_mode)
                _brand_enabled = bool(_settings.brand_enhancement)
            except Exception:
                _native = False
                _brand_enabled = False
            if _native:
                from agent.prompts import build_append_prompt, build_brand_prompt
                system_prompt = build_append_prompt()
                if _brand_enabled:
                    system_prompt = f"{system_prompt}\n\n{build_brand_prompt()}"
                _use_append = True
            else:
                system_prompt = build_system_prompt()
                _use_append = False

            turn_id = payload.get("turn_id")
            model_config = _resolve_chat_model(
                str(payload.get("provider_id") or ""),
                str(payload.get("model_name") or ""),
            )

            # Store context for completion handler
            _turn_user_message = user_message
            _turn_system_prompt = system_prompt
            _turn_id = turn_id
            _turn_model_config = model_config

            # Reset cancel event for new turn
            cancel_event.clear()

            # Start streaming as a background task so the message loop
            # remains responsive for cancel and auxiliary messages
            turn_task = asyncio.create_task(
                _stream_turn_sidecar(
                    ws, session, user_message, system_prompt,
                    model_config=model_config,
                    cancel_event=cancel_event,
                    use_append=_use_append,
                )
            )
            # Go back to loop top — _handle_turn_result processes completion
            # via the asyncio.wait interleaving or the turn_task.done() check

    except WebSocketDisconnect:
        pass
    finally:
        if turn_task and not turn_task.done():
            cancel_event.set()
            await _cancel_sidecar_turn(
                app_state.sidecar_manager,
                getattr(session, "_sidecar_session_id", None),
                reason="WebSocket disconnect",
            )
            turn_task.cancel()
            await asyncio.gather(turn_task, return_exceptions=True)
        app_state.ws_registry.unregister(session_id)
