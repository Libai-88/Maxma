"""WebSocket endpoint — streaming OMP sidecar proxy.

Thin WS↔JSON-RPC bridge: receives user messages, forwards to sidecar,
streams intermediate events back to frontend, and saves const sessions.
"""

import asyncio
import inspect
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.prompts import build_system_prompt
from api.activity_hub import record as record_activity
from api.routes.providers import _decrypt_api_key, _find_provider, _load_providers
from api.const_session_store import save_const_session
from api.middleware.rate_limit import get_ws_rate_limiter
from api.pi_bridge.session_adapter import SessionMap
from api.pi_bridge.sidecar_manager import SidecarManager
from api.session_manager import SessionState
from api.yaml_store import yaml_file_lock
from app_paths import PROJECT_ROOT, PROVIDERS_YAML_PATH

logger = logging.getLogger(__name__)

router = APIRouter()

_PUBLIC_TURN_ERROR = "后端处理失败，请稍后重试"


async def _get_sidecar_client(sidecar_mgr):
    """Return a sidecar client without treating Mock attributes as APIs.

    ``SidecarManager.get_client`` owns the production lifecycle guarantee. A
    few older tests use lightweight managers exposing only ``client``; plain
    ``MagicMock`` instances also fabricate a ``get_client`` attribute, so
    only an actual manager or a method defined by the manager's class may use
    that lifecycle API.
    """
    if isinstance(sidecar_mgr, SidecarManager) or getattr(
        type(sidecar_mgr), "get_client", None
    ) is not None:
        client = sidecar_mgr.get_client()
        if inspect.isawaitable(client):
            client = await client
    else:
        client = getattr(sidecar_mgr, "client", None)

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
    with SessionMap() as sm:
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
) -> str:
    """Execute a turn via oh-my-pi sidecar (Bun subprocess).

    Streams intermediate events (token, tool_start, tool_end, tool_error,
    ask_user, plan_proposed, plan_step_start, plan_step_end, plan_step_error,
    plan_completed) to the frontend in real-time.
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
    with SessionMap() as sm:
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
            with SessionMap() as sm:
                sm.remove(session.session_id)

    if not sidecar_sid:
        # Build system prompt with recent past turns for continuity
        _sidecar_system_prompt = system_prompt
        try:
            with SessionMap() as sm:
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

        # 计算生效的权限模式（功能未开启时强制 ask，与 sessions.py 保持一致），
        # 传给 sidecar 决定工具审批策略。
        try:
            from config.settings import get_settings
            _pm_enabled = bool(get_settings().permission_modes_enabled)
        except Exception:
            _pm_enabled = False
        _effective_permission_mode = session.permission_mode if _pm_enabled else "ask"

        result = await client.call(
            "create_session",
            {
                **model_config,
                "system_prompt": _sidecar_system_prompt,
                # B-002: forward the actual project root so the agent's logical
                # cwd resolves to the user's project (not the sidecar's bun-sidecar/
                # source directory). Must agree with MAXMA_PROJECT_ROOT env var set
                # in sidecar_manager.py (B-001).
                "cwd": str(PROJECT_ROOT),
                "permission_mode": _effective_permission_mode,
            },
        )
        sidecar_sid = result["session_id"]
        session._sidecar_session_id = sidecar_sid
        with SessionMap() as sm:
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
                if evt_type == "token":
                    await ws.send_json(
                        {"type": "token", "payload": {"token": payload.get("token", "")}}
                    )
                elif evt_type == "tool_start":
                    record_activity(
                        "tool", "tool_start",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="调用工具",
                    )
                    await ws.send_json(
                        {"type": "tool_start", "payload": {"tool_name": payload.get("tool_name", ""), "input": payload.get("input", "")}}
                    )
                elif evt_type == "tool_end":
                    record_activity(
                        "tool", "tool_end",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="工具执行完成",
                    )
                    await ws.send_json(
                        {"type": "tool_end", "payload": {"tool_name": payload.get("tool_name", ""), "output": payload.get("output", ""), "elapsed": payload.get("elapsed", 0)}}
                    )
                elif evt_type == "tool_error":
                    record_activity(
                        "tool", "tool_error",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        level="error",
                        message=str(payload.get("error", "")) or "工具执行出错",
                    )
                    await ws.send_json(
                        {"type": "tool_error", "payload": {"tool_name": payload.get("tool_name", ""), "error": payload.get("error", "")}}
                    )
                elif evt_type == "error":
                    logger.warning("[sidecar] Error for session %s: %s", sidecar_sid[:8], payload.get("message", payload))
                    record_activity(
                        "turn", "error",
                        session_id=session.session_id,
                        level="error",
                        message=str(payload.get("message", "")) or "Sidecar error",
                    )
                    await ws.send_json(
                        {"type": "error", "payload": {"code": payload.get("code", "SIDECAR_ERROR"), "message": payload.get("message", "Sidecar error")}}
                    )
                else:
                    # Generic forwarding for ask_user, plan_proposed, plan_step_start,
                    # plan_step_end, plan_step_error, plan_completed, etc.
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

    unsubs = []
    for evt_type in ("token", "tool_start", "tool_end", "tool_error", "error"):
        unsubs.append(client.on(evt_type, _make_handler(evt_type)))
    # Additional event types that just need generic forwarding
    for evt_type in ("ask_user", "plan_proposed", "plan_step_start", "plan_step_end", "plan_step_error", "plan_completed"):
        unsubs.append(client.on(evt_type, _make_handler(evt_type)))
    unsubs.append(client.on("answer", _on_answer))
    unsubs.append(client.on("done", _on_done))

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
                        "type": "error",
                        "payload": {
                            "code": "SIDECAR_UNAVAILABLE",
                            "message": "后端处理失败，请稍后重试",
                        },
                    }
                )
                await ws.send_json(
                    {
                        "type": "done",
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
                {"type": "answer", "payload": {"content": final_answer}}
            )
            session.message_count += 2

            try:
                with SessionMap() as sm:
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
                "type": "done",
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

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})
                continue

            # Whitelist of known message types — discard unknown
            KNOWN_TYPES = {
                "chat", "cancel", "user_response", "plan_response",
                "artifact_action", "update_auto_approve",
            }
            if msg_type not in KNOWN_TYPES:
                continue

            # ── Cancel ──
            if msg_type == "cancel":
                if turn_task and not turn_task.done():
                    cancel_event.set()
                    turn_task.cancel()
                    if session._sidecar_session_id:
                        try:
                            mgr = app_state.sidecar_manager
                            await mgr.start()
                            client = mgr.client
                            if client:
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

            # ── Auxiliary messages (forward to sidecar) ──
            if msg_type in ("user_response", "plan_response", "artifact_action", "update_auto_approve"):
                if session._sidecar_session_id:
                    try:
                        mgr = app_state.sidecar_manager
                        await mgr.start()
                        client = mgr.client
                        if client:
                            await client.call(
                                msg_type,
                                {
                                    "session_id": session._sidecar_session_id,
                                    **msg.get("payload", {}),
                                },
                            )
                    except Exception:
                        logger.debug(
                            "[ws] Failed to forward %s to sidecar",
                            msg_type,
                            exc_info=True,
                        )
                continue

            # ── Chat message ──
            payload = msg.get("payload", {})
            if not isinstance(payload, dict):
                continue
            user_message = str(payload.get("message", "")).strip()
            if not user_message:
                continue

            allowed, rate_limit_error = get_ws_rate_limiter().try_consume(session_id)
            if not allowed:
                await ws.send_json({"type": "error", "payload": rate_limit_error})
                continue

            # If a previous turn is still running, skip this message
            if turn_task and not turn_task.done():
                continue

            system_prompt = build_system_prompt()
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
