"""WebSocket endpoint — streaming OMP sidecar proxy.

Thin WS↔JSON-RPC bridge: receives user messages, forwards to sidecar,
streams intermediate events back to frontend, and saves const sessions.
"""

import asyncio
import base64
import inspect
import json
import logging
import os
import time
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
# S2-4: 纯逻辑拆分——模型解析 / artifact 合成 / 回合上下文
from api.routes.chat_model import _resolve_chat_model
from api.routes.chat_artifacts import (
    _FILE_WRITING_TOOLS,
    _extract_file_path_from_output,
    _build_artifact_payload,
)
from api.routes.chat_turns import _new_turn_id, _calculate_context_usage

logger = logging.getLogger(__name__)

router = APIRouter()

_PUBLIC_TURN_ERROR = "后端处理失败，请稍后重试"

# PERF-TOOL-OUTPUT-001：工具输出过大——bash/launch 等工具可返回数 MB 输出，
# 全量经 WS 转发后：1) 前端存进 turn.events 并随 turns 全量 JSON.stringify
# 写入 localStorage（长会话每轮 800ms 防抖全量序列化，体积爆炸后主线程卡死）；
# 2) WS 消息本身巨大拖慢流式。转发前截断，UI 展示不受影响（截断提示明确）。
_MAX_TOOL_OUTPUT_LEN = 100_000  # 100KB
_MAX_TOOL_ERROR_LEN = 20_000   # 20KB

# MEMORY-EVENTS-001：OMP 不通过 AgentSession subscribe 流暴露 memory 事件，
# 前端 memory_* 卡片链路此前是端到端死代码。本后端在 turn 内识别"写类"
# 记忆工具的调用，在 done 之后合成 memory_start/memory_tool_*/memory_done
# 事件流（前端契约：memory 事件必须带与 done 一致的 turn_id、且在 done
# 之后到达——done handler 先设置 turn.turnId，memory 事件才能定位目标轮次）。
# 读类工具（search_memories）不合成事件，避免每次搜索都刷记忆卡片。
_MEMORY_WRITE_TOOLS = frozenset({"remember_memory"})


class TurnStartError(Exception):
    """Raised when the sidecar cannot start or create a session.

    Carries a stable error code and a user-safe message so websocket_chat
    can surface the failure without leaking provider internals.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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


async def _destroy_sidecar_session(sidecar_mgr, session) -> None:
    """Best-effort destroy the sidecar session on WS disconnect.

    Keeps the SessionMap mapping (recent turns survive for context restore on
    reconnect) but frees the sidecar-side session — otherwise every chat leaves
    a session in the sidecar's `sessions` Map and RSS grows until the 1GB
    heartbeat restart kicks in repeatedly.
    """
    if sidecar_mgr is None:
        return
    sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        return
    client = getattr(sidecar_mgr, "client", None)
    if client is None or not getattr(client, "is_running", True):
        return  # sidecar unavailable — skip (avoid restarting it just to destroy)
    try:
        await client.call("destroy_session", {"session_id": sidecar_sid}, timeout=5)
        logger.info(
            "[sidecar] destroyed sidecar session %s on disconnect",
            sidecar_sid[:8],
        )
        # 修复 DESTROY-STATE-001：destroy 成功后清空映射与本地引用，
        # 避免下轮 stale 校验失败再走重建（重复 RPC 往返）
        try:
            from api.pi_bridge.session_adapter import get_session_map
            sm = get_session_map()
            sm.clear_sidecar_id(session.session_id)
        except Exception:
            pass
        session._sidecar_session_id = None
    except Exception:
        logger.debug(
            "[sidecar] Failed to destroy session %s on disconnect",
            sidecar_sid[:8],
            exc_info=True,
        )


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


def _turn_timeout_seconds() -> int:
    """单轮整体超时（SETTINGS-TIMEOUT-001）：读取配置的 turn_timeout，
    此前硬编码 600s 导致 .env 调优无效。"""
    try:
        from config.settings import get_settings
        return int(get_settings().turn_timeout) or 600
    except Exception:
        return 600


async def _stream_turn_sidecar(
    ws: WebSocket,
    session: SessionState,
    user_message: str,
    system_prompt: str,
    model_config: dict[str, str] | None = None,
    cancel_event: asyncio.Event | None = None,
    *,
    use_append: bool = False,
    turn_id: str = "",
) -> str:
    """Execute a turn via oh-my-pi sidecar (Bun subprocess).

    Streams all sidecar events (token, thinking_*, tool_*, ask_user,
    retry_*, notice, sub_session_created, memory_*, plan_* 等)
    to the frontend in real-time via transparent forwarding.
    Returns the final answer string.

    turn_id：当前轮次 ID（TURN-OWNERSHIP-001）。转发事件携带 turn_id，
    前端据此丢弃已终结轮次的迟到事件（cancel 后快速重发时的旧轮污染）。
    """
    model_config = model_config or {}
    app_state = ws.app.state

    # 1. Ensure sidecar is running. Failures here (sidecar not ready, RPC
    # client unavailable) surface as SIDECAR_UNAVAILABLE instead of
    # propagating as an opaque exception into _handle_turn_result.
    mgr = app_state.sidecar_manager
    try:
        await mgr.start()
        client = await _get_sidecar_client(mgr)
    except Exception as e:
        logger.exception(
            "[sidecar] Failed to start sidecar for session %s",
            session.session_id[:8],
        )
        raise TurnStartError(
            "SIDECAR_UNAVAILABLE", "Sidecar 未就绪，请检查后端日志"
        ) from e
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
            # 修复 CONTEXT-RESTORE-001：stale 校验失败只清 sidecar 映射，
            # 保留 turns 列供 get_recent_turns 恢复上下文（此前 remove 整行
            # 删除，最近 20 轮对话被不可逆删除且恢复功能从未生效）
            sm.clear_sidecar_id(session.session_id)

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

        # MAXTOKENS-END2END-001：用户设置的输出上限（首条消息 payload 存入
        # session._max_tokens）传给 sidecar 覆写 Model.maxTokens。
        _session_max_tokens = getattr(session, "_max_tokens", None) or 0

        # 原生提示词模式：走 OMP append_system_prompt（追加到 OMP 原生 prompt 之后），
        # 不传 system_prompt，避免整体替换 OMP 原生的 harness prompt。
        # 品牌模式：传 system_prompt（整体替换，旧行为）。
        _prompt_field = "append_system_prompt" if use_append else "system_prompt"
        try:
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
                    **({"max_tokens": _session_max_tokens} if _session_max_tokens else {}),
                },
            )
        except Exception as e:
            logger.exception(
                "[sidecar] create_session failed for session %s",
                session.session_id[:8],
            )
            raise TurnStartError(
                "PROVIDER_UNAVAILABLE",
                "模型服务不可用，请检查 Provider 配置",
            ) from e
        sidecar_sid = result.get("session_id")
        if not sidecar_sid:
            raise TurnStartError(
                "SIDECAR_UNAVAILABLE", "Sidecar 创建会话失败，请检查后端日志"
            )
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
    # MEMORY-EVENTS-001：本轮写类记忆工具活动（done 后统一合成 memory 事件流）
    memory_activity: list[dict] = []

    def _make_handler(evt_type: str):
        async def handler(sid: str, event: dict):
            if sid != sidecar_sid:
                return
            try:
                payload = event.get("payload", {})
                if evt_type == WsEventType.TOKEN:
                    # TURN-OWNERSHIP-001：TOKEN 事件必须携带 turn_id——
                    # 此前不带 turn_id 时，cancel 后事件队列里滞留的旧轮 token
                    # 无法被前端按"已终结轮次"过滤，会污染新轮的流式回复
                    await ws.send_json(
                        {"type": WsEventType.TOKEN, "payload": {"token": payload.get("token", ""), "turn_id": turn_id}}
                    )
                elif evt_type == WsEventType.TOOL_START:
                    record_activity(
                        "tool", "tool_start",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="调用工具",
                    )
                    # MEMORY-EVENTS-001：收集写类记忆工具活动，done 后合成
                    tool_name = payload.get("tool_name", "")
                    if tool_name in _MEMORY_WRITE_TOOLS:
                        memory_activity.append({
                            "kind": "start",
                            "tool_name": tool_name,
                            "input": payload.get("input", ""),
                        })
                    await ws.send_json(
                        {"type": WsEventType.TOOL_START, "payload": {"turn_id": turn_id, "tool_name": payload.get("tool_name", ""), "input": payload.get("input", "")}}
                    )
                elif evt_type == WsEventType.TOOL_END:
                    record_activity(
                        "tool", "tool_end",
                        session_id=session.session_id,
                        tool_name=payload.get("tool_name", ""),
                        message="工具执行完成",
                    )
                    tool_name = payload.get("tool_name", "")
                    if tool_name in _MEMORY_WRITE_TOOLS:
                        memory_activity.append({
                            "kind": "end",
                            "tool_name": tool_name,
                            "output": payload.get("output", ""),
                            "elapsed": payload.get("elapsed", 0),
                        })
                    # PERF-TOOL-OUTPUT-001：截断超大工具输出
                    raw_output = payload.get("output", "")
                    truncated = False
                    if isinstance(raw_output, str) and len(raw_output) > _MAX_TOOL_OUTPUT_LEN:
                        raw_output = raw_output[:_MAX_TOOL_OUTPUT_LEN] + "\n…（输出过长，已截断）"
                        truncated = True
                    await ws.send_json(
                        {"type": WsEventType.TOOL_END, "payload": {"turn_id": turn_id, "tool_name": tool_name, "output": raw_output, "elapsed": payload.get("elapsed", 0), "truncated": truncated}}
                    )
                    # Phase 2.2: 检测文件写入型工具，合成 artifact 事件
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
                    tool_name = payload.get("tool_name", "")
                    if tool_name in _MEMORY_WRITE_TOOLS:
                        memory_activity.append({
                            "kind": "error",
                            "tool_name": tool_name,
                            "error": payload.get("error", ""),
                        })
                    # PERF-TOOL-OUTPUT-001：错误详情同样截断
                    raw_error = payload.get("error", "")
                    if isinstance(raw_error, str) and len(raw_error) > _MAX_TOOL_ERROR_LEN:
                        raw_error = raw_error[:_MAX_TOOL_ERROR_LEN] + "\n…（错误详情过长，已截断）"
                    await ws.send_json(
                        {"type": WsEventType.TOOL_ERROR, "payload": {"turn_id": turn_id, "tool_name": tool_name, "error": raw_error}}
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
                                "turn_id": turn_id,
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
                # 修复 SIDECAR-DISCONNECT-001：sidecar 读循环死亡（崩溃/EOF）时
                # 立即醒转报错，而非静默挂起直到 600s 超时
                asyncio.create_task(client.disconnected.wait()),
            ]
            done, pending = await asyncio.wait(
                wait_tasks,
                timeout=_turn_timeout_seconds(),
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
                    await client.call("cancel", {"session_id": sidecar_sid}, timeout=5)
                except Exception as e:
                    logger.warning("[sidecar] Failed to cancel after cancel_event for session %s: %s", sidecar_sid[:8], e)
                if not final_answer:
                    final_answer = ""
                # MEMORY-EVENTS-001：返回本轮的写类记忆工具活动，由
                # _handle_turn_result 在 done 后合成 memory 事件流
                return (final_answer, memory_activity)
            if client.disconnected.is_set():
                raise RuntimeError("Sidecar disconnected during turn")
        else:
            # 非 cancel 路径同样联动断开事件
            disconnect_task = asyncio.create_task(client.disconnected.wait())
            turn_wait = asyncio.create_task(turn_done.wait())
            done, pending = await asyncio.wait(
                [turn_wait, disconnect_task],
                timeout=_turn_timeout_seconds(),
                return_when=asyncio.FIRST_COMPLETED,
            )
            for pending_task in pending:
                pending_task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            if not done:
                raise asyncio.TimeoutError
            if client.disconnected.is_set():
                raise RuntimeError("Sidecar disconnected during turn")
    except asyncio.TimeoutError:
        logger.warning(
            "[sidecar] Turn timed out for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid}, timeout=5)
        except Exception as e:
            logger.warning("[sidecar] Failed to cancel after timeout for session %s: %s", sidecar_sid[:8], e)
        raise
    except Exception as e:
        logger.exception(
            "[sidecar] Turn failed for session %s", sidecar_sid[:8]
        )
        try:
            await client.call("cancel", {"session_id": sidecar_sid}, timeout=5)
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

    # MEMORY-EVENTS-001：返回本轮的写类记忆工具活动（失败轮次同样返回，
    # 若工具已执行完毕，前端仍能显示记忆卡片；无活动时为空列表）
    return (final_answer, memory_activity)


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
    # turn 完成瞬间到达的非 PING 消息暂存于此，处理完 turn 后消费（避免静默丢弃）
    _deferred_msg: str | None = None
    # Context captured when a turn is started, used when it completes
    _turn_user_message: str = ""
    _turn_system_prompt: str = ""
    _turn_id: str = ""
    _turn_model_config: dict[str, str | int] = {}
    _turn_client_msg_id: str = ""

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
            task_result = task.result()
            # MEMORY-EVENTS-001：兼容旧签名——成功路径返回 (final_answer, memory_activity)
            final_answer = task_result
            memory_activity: list[dict] = []
            if isinstance(task_result, tuple) and len(task_result) == 2:
                final_answer, memory_activity = task_result
        except Exception as exc:
            logger.exception("[ws] Turn task failed for session %s", session_id[:8])
            error_code = "SIDECAR_UNAVAILABLE"
            error_message = _PUBLIC_TURN_ERROR
            if isinstance(exc, TurnStartError):
                error_code = exc.code
                error_message = exc.message
            error_trace_id = uuid.uuid4().hex
            record_activity(
                "turn", "turn_error",
                session_id=session.session_id,
                turn_id=_turn_id or "",
                level="error",
                trace_id=error_trace_id,
                message=error_message,
            )
            try:
                await ws.send_json(
                    {
                        "type": WsEventType.ERROR,
                        "payload": {
                            "turn_id": _new_turn_id(_turn_id),
                            "code": error_code,
                            "message": error_message,
                            "category": "system_error",
                            "trace_id": error_trace_id,
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
            if session._active_task is task:
                session._active_task = None
            return

        um = _turn_user_message
        sp = _turn_system_prompt
        tid = _turn_id

        if final_answer:
            await ws.send_json(
                {"type": WsEventType.ANSWER, "payload": {"turn_id": _new_turn_id(tid), "content": final_answer}}
            )
            session.message_count += 2
            # IDEMPOTENCY-001：turn 成功后才记录幂等 id（失败轮次可重试）
            if _turn_client_msg_id and _turn_client_msg_id not in session.recent_message_ids:
                session.recent_message_ids.append(_turn_client_msg_id)
                # IDEMPOTENCY-PERSIST-001：同时持久化到 SessionMap——
                # 后端重启后内存 deque 清空，持久化 id 保证断线重试不重复执行
                try:
                    sm = get_session_map()
                    sm.append_message_id(session.session_id, _turn_client_msg_id)
                except Exception:
                    logger.debug(
                        "[sidecar] Failed to persist message id",
                        exc_info=True,
                    )

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

        messages = await _get_messages_from_sidecar(session, limit=200)
        context_usage = await _calculate_context_usage(
            messages,
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

        # MEMORY-EVENTS-001：done 之后批量合成 memory 事件流。
        # 顺序要求：done handler 先设置 currentTurn.turnId 并把轮次推入
        # turns，memory 事件随后到达才能通过 turn_id 定位目标轮次；
        # 若先于 done 发送，前端找不到 turnId 会静默丢弃。
        if memory_activity:
            done_turn_id = _new_turn_id(tid)
            try:
                await ws.send_json({"type": WsEventType.MEMORY_START, "payload": {"turn_id": done_turn_id}})
                for act in memory_activity:
                    if act.get("kind") == "start":
                        await ws.send_json({
                            "type": WsEventType.MEMORY_TOOL_START,
                            "payload": {"turn_id": done_turn_id, "tool_name": act.get("tool_name", ""), "input": act.get("input", "")},
                        })
                    elif act.get("kind") == "end":
                        await ws.send_json({
                            "type": WsEventType.MEMORY_TOOL_END,
                            "payload": {"turn_id": done_turn_id, "tool_name": act.get("tool_name", ""), "output": act.get("output", ""), "elapsed": act.get("elapsed", 0)},
                        })
                    elif act.get("kind") == "error":
                        await ws.send_json({
                            "type": WsEventType.MEMORY_TOOL_ERROR,
                            "payload": {"turn_id": done_turn_id, "tool_name": act.get("tool_name", ""), "error": act.get("error", "")},
                        })
                await ws.send_json({"type": WsEventType.MEMORY_DONE, "payload": {"turn_id": done_turn_id}})
            except Exception:
                logger.debug("[memory] Failed to forward synthesized memory events", exc_info=True)

        record_activity(
            "turn", "turn_end",
            session_id=session.session_id,
            turn_id=tid or "",
            # PERF-ACTIVITY-001：完整回复不写入活动中心——长回复 × 1000 条
            # 环形缓冲会显著占用内存，message 只保留摘要
            message=(final_answer or "(本轮无最终回复)")[:500],
            payload={"context_usage": context_usage},
        )
        turn_task = None
        if session._active_task is not None and session._active_task.done():
            session._active_task = None

    try:
        while True:
            # 消费上一轮 turn 完成瞬间暂存的消息（避免静默丢弃）
            if _deferred_msg is not None:
                raw = _deferred_msg
                _deferred_msg = None
            # Process a completed turn before waiting for new messages
            elif turn_task and turn_task.done():
                await _handle_turn_result(turn_task)
                session.active_turn_ws = None  # CONN-MUTEX-001：turn 结束释放归属
                continue

            # Wait for a new message or the current turn to complete
            if turn_task and not turn_task.done():
                recv_task = asyncio.create_task(ws.receive_text())
                done, pending = await asyncio.wait(
                    [recv_task, turn_task],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if turn_task in done:
                    # 优先处理已到达的 ping 消息，避免 recv_task 取消后前端 pong 超时
                    if recv_task.done():
                        try:
                            raw = recv_task.result()
                            msg = json.loads(raw)
                            if isinstance(msg, dict) and msg.get("type") == WsMessageType.PING:
                                await ws.send_json({"type": "pong"})
                            else:
                                # 非 PING 消息暂存，处理完 turn 后消费，避免静默丢弃
                                _deferred_msg = raw
                        except (json.JSONDecodeError, Exception):
                            pass
                    else:
                        recv_task.cancel()
                        try:
                            await recv_task
                        except asyncio.CancelledError:
                            pass
                    await _handle_turn_result(turn_task)
                    session.active_turn_ws = None  # CONN-MUTEX-001：turn 结束释放归属
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
                # SESSION-ACTIVE-001：心跳刷新 last_active——否则长连接闲置期间
                # last_active 停留在连接建立时刻，TTL 清理会把活跃连接误判为过期
                session.last_active = time.time()
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

            # 修复 IDEMPOTENCY-001：client_msg_id 幂等去重。
            # 前端在发送失败（WS 断开）后重试时复用同一 id——同一逻辑消息
            # 只执行一次，避免写文件/bash 等副作用工具重复执行。
            # 注意：id 不在收到时立即记录——若轮次失败（PROMPT_ERROR/超时/
            # 断开）且前端认为未发送而重试，立即记录会把重试误判为重复丢弃
            # （消息静默丢失）。改为 turn 成功后记录（见 _handle_turn_result）。
            client_msg_id = payload.get("client_msg_id")
            if isinstance(client_msg_id, str) and client_msg_id:
                if client_msg_id in session.recent_message_ids:
                    logger.info(
                        "[ws] 重复 client_msg_id=%s 已忽略（幂等去重）", client_msg_id[:12]
                    )
                    continue

            # MAXTOKENS-END2END-001：记录用户设置的输出上限（会话创建时使用）
            _mt = payload.get("max_tokens")
            if isinstance(_mt, (int, float)) and _mt > 0:
                session._max_tokens = int(_mt)

            # 修复 CONN-MUTEX-001：同一 session 多 WS 连接互斥。
            # 跨连接并发 turn 会让双方订阅同一 sidecar session 的事件流，
            # 消息归属错乱。仅允许持有 active_turn_ws 的连接发起新 turn。
            if session.active_turn_ws is not None and session.active_turn_ws is not ws:
                await ws.send_json({
                    "type": WsEventType.ERROR,
                    "payload": {
                        "code": "BUSY",
                        "message": "另一窗口正在处理该会话，请稍后再试",
                        "category": "system_error",
                        "trace_id": uuid.uuid4().hex,
                    },
                })
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

            # If a previous turn is still running, tell the frontend instead of
            # silently dropping the message (前端 isStreaming 不会因此卡死)
            if turn_task and not turn_task.done():
                await ws.send_json(
                    {
                        "type": WsEventType.ERROR,
                        "payload": {
                            "code": "BUSY",
                            "message": "上一条消息仍在处理中，请稍后",
                            "category": "system_error",
                            "trace_id": uuid.uuid4().hex,
                        },
                    }
                )
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

            # 修复 PROMPT-LEN-001：提示词长度预检（仅日志警告，不截断——
            # OMP 的 compaction 预算会计入 prompt，超限由压缩策略处理）。
            # 提示词过大（用户自述/宏/AGENTS.md 很长）时，小上下文模型会
            # 直接 context length exceeded，此处提前暴露可诊断信号。
            _prompt_len = len(system_prompt) if system_prompt else 0
            if _prompt_len > 30000:
                logger.warning(
                    "[prompt] system_prompt 过大（%d 字符），小上下文模型可能超限",
                    _prompt_len,
                )

            turn_id = payload.get("turn_id")
            model_config = _resolve_chat_model(
                str(payload.get("provider_id") or ""),
                str(payload.get("model_name") or ""),
            )

            # 修复 MODEL-SWITCH-001：模型/提供商变更时销毁旧 sidecar session，
            # 下轮 _ensure_sidecar_session 用新模型重建（上下文恢复最近轮次）。
            # 此前 sidecar session 固定创建时模型，切换模型静默无效（UI 显示
            # 新模型、实际仍用旧模型）。
            _new_model_key = f"{model_config.get('provider')}/{model_config.get('model')}"
            if (
                getattr(session, "_sidecar_session_id", None)
                and session._last_model_key
                and session._last_model_key != _new_model_key
            ):
                logger.info(
                    "[model] 模型切换 %s → %s，重建 sidecar session",
                    session._last_model_key, _new_model_key,
                )
                await _destroy_sidecar_session(app_state.sidecar_manager, session)
            session._last_model_key = _new_model_key

            # Store context for completion handler
            _turn_user_message = user_message
            _turn_system_prompt = system_prompt
            _turn_id = turn_id
            _turn_model_config = model_config
            _turn_client_msg_id = client_msg_id if isinstance(client_msg_id, str) else ""

            # Reset cancel event for new turn
            cancel_event.clear()

            # CONN-MUTEX-001：记录 turn 归属连接，turn 结束后清除
            session.active_turn_ws = ws
            # F14-DELETE-CANCEL-001：turn 任务挂到 SessionState._active_task，
            # 供 DELETE /sessions 等路径取消进行中的 turn（此前只存局部变量）
            if session._active_task is not None and not session._active_task.done():
                session._active_task.cancel()

            # Start streaming as a background task so the message loop
            # remains responsive for cancel and auxiliary messages
            turn_task = asyncio.create_task(
                _stream_turn_sidecar(
                    ws, session, user_message, system_prompt,
                    model_config=model_config,
                    cancel_event=cancel_event,
                    use_append=_use_append,
                    turn_id=turn_id,
                )
            )
            session._active_task = turn_task
            # Go back to loop top — _handle_turn_result processes completion
            # via the asyncio.wait interleaving or the turn_task.done() check

    except WebSocketDisconnect:
        pass
    finally:
        # CONN-MUTEX-001：断开连接若持有 turn 归属则释放
        if session.active_turn_ws is ws:
            session.active_turn_ws = None
        if turn_task and not turn_task.done():
            cancel_event.set()
            await _cancel_sidecar_turn(
                app_state.sidecar_manager,
                getattr(session, "_sidecar_session_id", None),
                reason="WebSocket disconnect",
            )
            turn_task.cancel()
            await asyncio.gather(turn_task, return_exceptions=True)
        # 断开即销毁 sidecar session，防止会话在 sidecar 内存累积导致反复内存重启
        await _destroy_sidecar_session(
            app_state.sidecar_manager, session
        )
        # MULTI-WS-001：只注销本连接（其他窗口的同会话连接保持注册）
        app_state.ws_registry.unregister(session_id, ws)
