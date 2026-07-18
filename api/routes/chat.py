"""WebSocket endpoint — streaming OMP sidecar proxy.

Thin WS↔JSON-RPC bridge: receives user messages, forwards to sidecar,
streams intermediate events back to frontend, and saves const sessions.
"""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.prompts import build_system_prompt
from api.const_session_store import save_const_session
from api.middleware.rate_limit import get_ws_rate_limiter
from api.pi_bridge.session_adapter import SessionMap
from api.session_manager import SessionState

logger = logging.getLogger(__name__)

router = APIRouter()


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
    client = sidecar_mgr.client
    if client is None:
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
) -> str:
    """Execute a turn via oh-my-pi sidecar (Bun subprocess).

    Streams intermediate events (token, tool_start, tool_end, tool_error)
    to the frontend in real-time. Returns the final answer string.
    """
    app_state = ws.app.state

    # 1. Ensure sidecar is running
    mgr = app_state.sidecar_manager
    await mgr.start()
    client = mgr.client
    if client is None:
        raise RuntimeError("Sidecar client not available after start()")
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

        result = await client.call(
            "create_session",
            {
                "model": "gpt-4o",
                "system_prompt": _sidecar_system_prompt,
                "cwd": ".",
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
                    await ws.send_json(
                        {"type": "tool_start", "payload": {"tool_name": payload.get("tool_name", ""), "input": payload.get("input", "")}}
                    )
                elif evt_type == "tool_end":
                    await ws.send_json(
                        {"type": "tool_end", "payload": {"tool_name": payload.get("tool_name", ""), "output": payload.get("output", ""), "elapsed": payload.get("elapsed", 0)}}
                    )
                elif evt_type == "tool_error":
                    await ws.send_json(
                        {"type": "tool_error", "payload": {"tool_name": payload.get("tool_name", ""), "error": payload.get("error", "")}}
                    )
                elif evt_type == "error":
                    logger.warning("[sidecar] Error for session %s: %s", sidecar_sid[:8], payload.get("message", payload))
                    await ws.send_json(
                        {"type": "error", "payload": {"code": payload.get("code", "SIDECAR_ERROR"), "message": payload.get("message", "Sidecar error")}}
                    )
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
    unsubs.append(client.on("answer", _on_answer))
    unsubs.append(client.on("done", _on_done))

    # 4. Execute prompt via sidecar
    try:
        await client.call(
            "prompt",
            {"session_id": sidecar_sid, "message": user_message},
        )
        await asyncio.wait_for(turn_done.wait(), timeout=600)
    except asyncio.TimeoutError:
        logger.warning(
            "[sidecar] Turn timed out for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as e:
            logger.warning("[sidecar] Failed to cancel after timeout for session %s: %s", sidecar_sid[:8], e)
        if not final_answer:
            final_answer = "（Sidecar 处理超时，请重试）"
    except Exception as e:
        logger.exception(
            "[sidecar] Turn failed for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as cancel_err:
            logger.warning("[sidecar] Failed to cancel after error for session %s: %s", sidecar_sid[:8], cancel_err)
        if not final_answer:
            final_answer = f"（Sidecar 处理出错：{e}）"
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

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue

            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
                continue

            if msg.get("type") != "chat":
                continue

            payload = msg.get("payload", {})
            if not isinstance(payload, dict):
                continue
            user_message = str(payload.get("message", "")).strip()
            if not user_message:
                continue

            # Per-session rate limiting — prevent message flooding from
            # exhausting sidecar resources. WsSessionRateLimiter is the
            # per-session token bucket defined in rate_limit.py; the ASGI
            # middleware cannot throttle messages inside a long-lived WS.
            allowed, rate_limit_error = get_ws_rate_limiter().try_consume(session_id)
            if not allowed:
                await ws.send_json({"type": "error", "payload": rate_limit_error})
                continue

            system_prompt = build_system_prompt()

            final_answer = await _stream_turn_sidecar(
                ws, session, user_message, system_prompt,
            )

            if final_answer:
                await ws.send_json(
                    {"type": "answer", "payload": {"content": final_answer}}
                )
                session.message_count += 2

                # Save turn to SessionMap for history continuity
                try:
                    with SessionMap() as sm:
                        sm.append_turn(
                            session.session_id, user_message, final_answer
                        )
                except Exception:
                    logger.debug(
                        "[sidecar] Failed to save turn to SessionMap",
                        exc_info=True,
                    )

                # Const session auto-save to disk YAML
                if session.is_const:
                    await _save_const_session(
                        session, final_answer
                    )

            await ws.send_json(
                {
                    "type": "done",
                    "payload": {
                        "turn_id": _new_turn_id(payload.get("turn_id")),
                        "context_usage": await _calculate_context_usage(
                            session, system_prompt
                        ),
                    },
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        app_state.ws_registry.unregister(session_id)
