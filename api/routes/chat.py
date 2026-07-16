"""WebSocket 端点 — 流式 Agent 对话，含取消、用户交互和多轮上下文。"""

import asyncio
import json
import sys
import logging
import traceback
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.prompts import build_system_prompt, get_system_prompt_parts
from app_paths import CONFIG_DIR
from api import interaction
from api.const_session_store import save_const_session
from api.context_usage import estimate_context_usage
from api.errors import ErrorCode, format_ws_error
from api.metrics import get_metrics
from api.middleware.rate_limit import get_ws_rate_limiter
from api.diagnostics import error_collector
from api.session_manager import SessionState
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

_LOCAL_REF_PREFIX = "local:"
_MODEL_ROLES_PATH = CONFIG_DIR / "model_roles.yaml"


# 以下为向前兼容桩函数 — 供遗留测试导入。
# ThinkPath 和 provider 模型路由已迁移至 OMP ModelRegistry，
# Python 端不再执行 provider 选择逻辑。
class ThinkPathExecution:
    """Stub — ThinkPath 执行偏好。已弃用，OMP ModelRegistry 管理。"""
    path = None
    provider = None
    model_name = None


def _resolve_think_path_execution(*args, **kwargs) -> ThinkPathExecution:
    """Stub — ThinkPath 已弃用。返回空结果。"""
    return ThinkPathExecution()


def _think_path_runtime_context(path=None) -> str:
    """Stub — ThinkPath 已弃用。返回空字符串。"""
    return ""


def _effective_auto_approve(session: SessionState, requested: object) -> bool:
    """Prevent a delegated session from exceeding its parent's approval policy."""
    context = (
        getattr(session, "delegation_context", None)
        if getattr(session, "is_subagent", False)
        else None
    )
    if context is None:
        return bool(requested)
    return bool(requested) and bool(context.auto_approve)


async def _process_image_refs(user_message: str) -> str:
    """从用户消息中提取图片引用，自动描述图片内容并追加到消息末尾。

    流程：
    1. 解析 __refs__ 块中的 image 类型引用
    2. 对每个有 path 的图片调用 GLM-5V-Turbo 生成描述
    3. 将描述追加到用户消息文本末尾（在 __refs__ 之前）

    Returns:
        增强后的用户消息文本
    """
    import re

    # 提取 refs 块
    refs_start = user_message.rfind("__refs__")
    if refs_start == -1:
        return user_message

    refs_end = user_message.find("__/refs__", refs_start)
    if refs_end == -1:
        return user_message

    refs_json = user_message[refs_start + len("__refs__") : refs_end]
    try:
        refs_list = json.loads(refs_json)
    except (json.JSONDecodeError, ValueError):
        return user_message

    # 提取图片引用
    image_paths = []
    for ref_item in refs_list:
        if isinstance(ref_item, dict) and ref_item.get("type") == "image":
            path = ref_item.get("path", "")
            if path:
                image_paths.append((path, ref_item.get("label", "image")))

    if not image_paths:
        return user_message

    # 对每张图片生成描述
    descriptions = []
    for path, label in image_paths:
        try:
            desc = await _describe_image(path)
            if desc:
                descriptions.append(f"[图片 {label}: {desc}]")
        except Exception as e:
            logger.warning(f"Failed to describe image {path}: {e}")
            descriptions.append(f"[图片 {label}: 描述失败 - {str(e)[:80]}]")

    if not descriptions:
        return user_message

    # 将描述插入到 __refs__ 之前
    before_refs = user_message[:refs_start].rstrip()
    after_refs = user_message[refs_start:]
    desc_text = "\n\n" + "\n".join(descriptions)
    return before_refs + desc_text + "\n\n" + after_refs


def _resolve_local_image_ref(image_ref: str) -> Path:
    """将前端图片 ref 解析为已通过路径安全检查的本地路径。"""
    path_text = image_ref.strip()
    if path_text.startswith(_LOCAL_REF_PREFIX):
        path_text = path_text[len(_LOCAL_REF_PREFIX) :].strip()
    if not path_text:
        raise ValueError("图片路径为空")

    file_path = Path(path_text).expanduser().resolve(strict=False)
    return file_path


async def _describe_image(image_path: str) -> str:
    """调用 GLM-5V-Turbo 描述单张图片。"""
    import base64
    import mimetypes

    file_path = _resolve_local_image_ref(image_path)
    if not file_path.exists():
        raise FileNotFoundError(f"图片文件不存在: {image_path}")

    # 读取并编码图片
    image_bytes = file_path.read_bytes()
    mime = mimetypes.guess_type(str(file_path))[0] or "image/png"
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{mime};base64,{image_b64}"

    # 调用 GLM-5V-Turbo
    from zai import ZhipuAiClient

    settings = get_settings()
    if not settings.zhipuai_api_key:
        return "(图片描述不可用: 未配置智谱 API Key)"

    client = ZhipuAiClient(api_key=settings.zhipuai_api_key)

    response = await asyncio.to_thread(
        client.chat.completions.create,
        model="glm-5v-turbo",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {
                        "type": "text",
                        "text": "请简洁描述这张图片的主要内容，包括关键元素、场景和文字（如果有）。控制在 100 字以内。",
                    },
                ],
            }
        ],
        thinking={"type": "enabled"},
        stream=False,
    )

    return response.choices[0].message.content or "(无法描述)"


async def _get_messages_from_sidecar(
    session: "SessionState",
    limit: int = 50,
    *,
    sidecar_mgr=None,
) -> list[dict]:
    """从 sidecar 获取消息历史。sidecar 不可用时返回空列表。

    通过 SessionMap（SQLite 持久化）查找 sidecar session ID，
    然后调用 get_messages RPC 获取消息列表。

    Args:
        session: 会话状态
        limit: 最大消息数
        sidecar_mgr: SidecarManager 实例（必须由调用方传入）
    """
    if sidecar_mgr is None:
        sidecar_mgr = getattr(session, "_sidecar_mgr", None)
    if sidecar_mgr is None:
        return []
    await sidecar_mgr.start()
    client = sidecar_mgr.client
    if client is None:
        return []
    # 从 SessionMap 获取 sidecar session ID（持久化，重启后仍可用）
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as sm:
        sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)
    if not sidecar_sid:
        return []
    try:
        result = await client.call("get_messages", {
            "session_id": sidecar_sid,
            "limit": limit,
        })
        return result.get("messages", [])
    except Exception:
        logger.debug("[sidecar] get_messages failed", exc_info=True)
        return []


async def _stream_turn_sidecar(
    ws: WebSocket,
    session: SessionState,
    user_message_for_llm: str,
    system_prompt: str,
    current_provider_id: str,
    current_model_name: str | None,
) -> str:
    """Execute a turn using oh-my-pi sidecar (Bun subprocess).

    Returns final_answer string for post-processing (stickers, memory, etc.).
    Intermediate events (token, tool_start, tool_end, tool_error) are streamed
    to the frontend via WS in real-time.

    The answer and done events are NOT sent here — the existing post-processing
    pipeline in _run_agent_turn handles those (including sticker processing).
    """
    app_state = ws.app.state

    # 1. Ensure sidecar is running
    mgr = app_state.sidecar_manager
    await mgr.start()
    client = mgr.client
    if client is None:
        raise RuntimeError("Sidecar client not available after start()")
    # 注入 sidecar manager 到 session，供下游函数（消息历史、context usage、
    # const 保存、情景记忆等）通过 session._sidecar_mgr 访问
    session._sidecar_mgr = mgr

    # 2. Look up sidecar session (persistent SessionMap, fallback to in-memory)
    from api.pi_bridge.session_adapter import SessionMap
    with SessionMap() as sm:
        sidecar_sid = sm.get_sidecar_id(session.session_id)
    if not sidecar_sid:
        sidecar_sid = getattr(session, "_sidecar_session_id", None)

    # 验证 sidecar session 是否仍然有效（服务器重启后旧 ID 过期）
    sidecar_valid = False
    if sidecar_sid:
        try:
            await client.call("get_messages", {
                "session_id": sidecar_sid, "limit": 0,
            })
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
        if current_provider_id:
            model_str = f"{current_provider_id}/{current_model_name or 'gpt-4o'}"
        else:
            model_str = current_model_name or "gpt-4o"

        # 首次创建 sidecar session，system_prompt 含人设/规则/技能
        # 从 SessionMap 恢复最近对话上下文（用于重启后重建）
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
                    len(_past_turns), session.session_id[:8],
                )
        except Exception:
            logger.debug("[sidecar] Failed to restore past turns", exc_info=True)

        result = await client.call("create_session", {
            "model": model_str,
            "system_prompt": _sidecar_system_prompt,
            "cwd": ".",
        })
        sidecar_sid = result["session_id"]
        session._sidecar_session_id = sidecar_sid
        with SessionMap() as sm:
            sm.set_mapping(session.session_id, sidecar_sid)
        logger.info(
            "[sidecar] Created session %s for Maxma session %s",
            sidecar_sid[:8], session.session_id[:8],
        )

    # 3. Register event handlers to forward intermediate events to WS
    final_answer = ""
    turn_done = asyncio.Event()

    async def _on_token(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        try:
            await ws.send_json({
                "type": "token",
                "payload": {"token": event.get("payload", {}).get("token", "")},
            })
        except Exception:
            pass

    async def _on_tool_start(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        try:
            payload = event.get("payload", {})
            await ws.send_json({
                "type": "tool_start",
                "payload": {
                    "tool_name": payload.get("tool_name", ""),
                    "input": payload.get("input", ""),
                },
            })
        except Exception:
            pass

    async def _on_tool_end(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        try:
            payload = event.get("payload", {})
            await ws.send_json({
                "type": "tool_end",
                "payload": {
                    "tool_name": payload.get("tool_name", ""),
                    "output": payload.get("output", ""),
                    "elapsed": payload.get("elapsed", 0),
                },
            })
        except Exception:
            pass

    async def _on_tool_error(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        try:
            payload = event.get("payload", {})
            await ws.send_json({
                "type": "tool_error",
                "payload": {
                    "tool_name": payload.get("tool_name", ""),
                    "error": payload.get("error", ""),
                },
            })
        except Exception:
            pass

    async def _on_answer(sid: str, event: dict):
        nonlocal final_answer
        if sid != sidecar_sid:
            return
        final_answer = event.get("payload", {}).get("content", "")

    async def _on_done(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        turn_done.set()

    async def _on_error(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        payload = event.get("payload", {})
        logger.warning(
            "[sidecar] Error event for session %s: %s",
            sidecar_sid[:8], payload.get("message", payload),
        )
        try:
            await ws.send_json({
                "type": "error",
                "payload": {
                    "code": payload.get("code", "SIDECAR_ERROR"),
                    "message": payload.get("message", "Sidecar error"),
                },
            })
        except Exception:
            pass

    # Register all event handlers
    unsubs = []
    for evt_type, handler in [
        ("token", _on_token),
        ("tool_start", _on_tool_start),
        ("tool_end", _on_tool_end),
        ("tool_error", _on_tool_error),
        ("answer", _on_answer),
        ("done", _on_done),
        ("error", _on_error),
    ]:
        unsub = client.on(evt_type, handler)
        unsubs.append(unsub)

    # 4. Execute prompt via sidecar
    try:
        await client.call("prompt", {
            "session_id": sidecar_sid,
            "message": user_message_for_llm,
        })
        await asyncio.wait_for(turn_done.wait(), timeout=600)
    except asyncio.TimeoutError:
        logger.warning("[sidecar] Turn timed out for session %s", sidecar_sid)
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            pass
        if not final_answer:
            final_answer = "（Sidecar 处理超时，请重试）"
    except Exception as e:
        logger.exception("[sidecar] Turn failed for session %s", sidecar_sid)
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            pass
        if not final_answer:
            final_answer = f"（Sidecar 处理出错：{e}）"
    finally:
        for unsub in unsubs:
            try:
                unsub()
            except Exception:
                pass

    return final_answer


async def _calculate_context_usage(
    session,
    system_prompt,
    *,
    max_tokens: int = 256_000,
    model_name: str = "",
) -> dict:
    """估算上下文用量。sidecar 模式下从消息历史估算。

    从 sidecar 获取消息列表，用字符数粗略估算 token 用量。
    返回字典包括估算用量、最大用量、占比、消息数。
    """
    messages = await _get_messages_from_sidecar(session, limit=200)
    total_chars = sum(len(m.get("content", "")) for m in messages)
    total_chars += len(system_prompt or "")
    estimated_tokens = int(total_chars / 2)
    return {
        "estimated_tokens": estimated_tokens,
        "max_tokens": max_tokens,
        "percentage": min(100, int(estimated_tokens / max(max_tokens, 1) * 100)),
        "message_count": len(messages),
        "model_name": model_name,
    }



# ── 项目上下文自动感知 ──────────────────────────────────────────

import re as _re

_PATH_PATTERN = _re.compile(r"(?:[A-Za-z]:[\\/]|[\\/])(?:[\w .\-]+[\\/])*[\w .\-]+")


def _detect_project_path(message: str) -> str | None:
    """从用户消息中提取可能的项目根目录路径。"""
    matches = _PATH_PATTERN.findall(message)
    for m in matches:
        p = m.rstrip("\\/").rstrip()
        from pathlib import Path as _Path

        if _Path(p).is_dir():
            markers = [
                ".git",
                "package.json",
                "pyproject.toml",
                "Cargo.toml",
                "go.mod",
                "requirements.txt",
                "setup.py",
            ]
            if any((_Path(p) / marker).exists() for marker in markers):
                return p
    return None


def _get_project_context(session: SessionState, user_message: str) -> str | None:
    """获取项目上下文：优先用缓存，否则尝试从消息检测并扫描。"""
    if session._project_context is not None:
        return session._project_context

    project_path = _detect_project_path(user_message)
    if project_path is None:
        return None

    try:
        from agent.project_scanner import scan_project

        ctx = scan_project(project_path)
        text = ctx.to_prompt_text()
        session._project_context = text
        session._project_path = project_path
        return text
    except Exception as e:
        import logging

        logging.getLogger(__name__).warning("[project_scanner] 扫描失败: %s", e)
        return None


def _new_turn_id(turn_id: object = None) -> str:
    """Return a validated client id or create one before execution begins."""
    if isinstance(turn_id, str):
        candidate = turn_id.strip()
        if candidate and len(candidate) <= 128:
            return candidate
    return uuid.uuid4().hex


async def _run_agent_turn(
    ws: WebSocket,
    session: SessionState,
    user_message: str,
    private_mode: bool = False,
    auto_approve: bool = False,
    turn_id: str | None = None,
):
    """
    在指定的 session 中编排一轮 Agent 对话。
    无返回值。
    以内置的 WebSocket 回调函数和前端通信系统作为副作用。

    使用 oh-my-pi sidecar 作为唯一的执行路径。
    OMP ModelRegistry 管理所有 provider，Python 端不再管理 LLM provider。
    """
    # 1. [准备环境] 从 WebSocket 获取应用状态
    app_state = ws.app.state
    current_task = asyncio.current_task()
    turn_id = _new_turn_id(turn_id)
    interaction.current_session_id.set(session.session_id)
    # ── 多模态：自动描述用户附带的图片 ──────────────────────────
    user_message = await _process_image_refs(user_message)
    # ────────────────────────────────────────────────────────────

    # OMP ModelRegistry 管理所有 provider，Python 端使用默认值
    current_max_tokens = 256_000
    current_provider_id = ""
    current_model_name = None

    auto_approve = _effective_auto_approve(session, auto_approve)
    session.auto_approve = auto_approve
    interaction.set_session_auto_approve(session.session_id, auto_approve)

    system_prompt = build_system_prompt()

    # ── 项目上下文自动感知 ──────────────────────────────────────
    project_ctx = _get_project_context(session, user_message)
    # ────────────────────────────────────────────────────────────

    # 使用全量工具集 + MCP 工具
    mcp_tools = getattr(ws.app.state, "mcp_tools", None) or []
    turn_tools = list(mcp_tools)

    # project_ctx prepend 到 user_message
    if project_ctx:
        user_message_for_llm = f"[项目上下文]\n{project_ctx}\n\n---\n\n{user_message}"
    else:
        user_message_for_llm = user_message

    # oh-my-pi sidecar: no LangGraph state
    config = None
    agent_maxma = None
    session._graph = None

    # 2. [执行轮次] 流式执行 — sidecar 唯一路径
    final_answer = ""
    _run_error: str | None = None
    turn_completed = False
    try:
        initial_turn_usage = await _calculate_context_usage(
            session,
            system_prompt,
            max_tokens=current_max_tokens,
            model_name=current_model_name or "",
        )
        await ws.send_json({"type": "context_usage", "payload": initial_turn_usage})

        _turn_timeout = 600
        try:
            _turn_timeout = get_settings().turn_timeout
        except Exception:
            pass
        async with asyncio.timeout(_turn_timeout):
            final_answer = await _stream_turn_sidecar(
                ws,
                session,
                user_message_for_llm,
                system_prompt,
                current_provider_id,
                current_model_name,
            )
        turn_completed = bool(final_answer)

        # 保存本轮对话到 SessionMap
        if final_answer and not private_mode:
            try:
                from api.pi_bridge.session_adapter import SessionMap
                with SessionMap() as sm:
                    sm.append_turn(session.session_id, user_message, final_answer)
            except Exception:
                logger.debug("[sidecar] Failed to save turn to SessionMap", exc_info=True)

        if final_answer:
            await ws.send_json(
                {
                    "type": "answer",
                    "payload": {"content": final_answer},
                }
            )
    except asyncio.CancelledError:
        await interaction.cancel_session(session.session_id)

        try:
            sidecar_mgr = getattr(ws.app.state, "sidecar_manager", None)
            if sidecar_mgr and sidecar_mgr.client:
                from api.pi_bridge.session_adapter import SessionMap
                with SessionMap() as sm:
                    sidecar_sid = sm.get_sidecar_id(session.session_id)
                if not sidecar_sid:
                    sidecar_sid = getattr(session, "_sidecar_session_id", None)
                if sidecar_sid:
                    await sidecar_mgr.client.call("cancel", {"session_id": sidecar_sid})
        except Exception as e:
            logger.debug("[cancel] sidecar cancel RPC failed: %s", e)

        await ws.send_json(format_ws_error(ErrorCode.CANCELLED, "生成已取消"))
    except Exception as e:
        await interaction.cancel_session(
            session.session_id, "Agent 执行出错，交互已取消"
        )
        _run_error = str(e)
        trace_id = uuid.uuid4().hex[:8]
        logger.error(
            f"[sub-agent:{session.session_id[:8]}] _run_agent_turn error: {e}",
            exc_info=True,
            extra={"trace_id": trace_id},
        )
        error_collector.add_exception(
            e,
            category="agent",
            message=f"Agent 执行出错: {str(e)[:200]}",
            trace_id=trace_id,
            session_id=session.session_id,
        )
        await ws.send_json(
            format_ws_error(
                ErrorCode.AGENT_ERROR,
                f"Agent 执行出错: {str(e)[:200]}",
                trace_id=trace_id,
            )
        )
    finally:
        try:
            if session._active_task is current_task:
                session._active_task = None
            context_usage = await _calculate_context_usage(
                session,
                system_prompt,
                max_tokens=current_max_tokens,
                model_name=current_model_name or "",
            )
            await ws.send_json(
                {
                    "type": "done",
                    "payload": {
                    "turn_id": turn_id,
                    "context_usage": context_usage,
                },
            }
            )
        except Exception:
            pass

    # 3. [后处理] 增加消息计数器
    if final_answer:
        session.message_count += 2  # human + ai

    # 4. [Const 会话] 自动持久化到磁盘 YAML
    if final_answer and session.is_const:
        try:
            messages = await _get_messages_from_sidecar(session, limit=200)
            if messages:
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
            print(
                f"[const] 自动保存会话 {session.session_id[:8]} 失败: {e}",
                file=sys.stderr,
            )

    # 5. [Sub-agent] 如果有待处理的 pending_result，resolve 它
    if session._pending_result is not None and not session._pending_result.done():
        if _run_error:
            print(
                f"[sub-agent:{session.session_id[:8]}] resolving pending_result with run error",
                file=sys.stderr,
            )
            session._pending_result.set_exception(
                RuntimeError(f"子 Agent 执行失败: {_run_error}")
            )
        elif final_answer:
            print(
                f"[sub-agent:{session.session_id[:8]}] resolving pending_result with answer",
                file=sys.stderr,
            )
            session._pending_result.set_result(final_answer)
        else:
            print(
                f"[sub-agent:{session.session_id[:8]}] resolving pending_result with exception (empty answer)",
                file=sys.stderr,
            )
            session._pending_result.set_exception(
                RuntimeError("Sub-agent 未能产生有效回答")
            )


async def _resume_sub_agent(
    ws: WebSocket, session: SessionState
) -> asyncio.Task | None:
    """WebSocket 重连时，若会话有未完成的 sub-agent 任务则自动恢复执行。"""
    if session._sub_agent_task is None or session._pending_result is None:
        return None
    if session._pending_result.done():
        return None
    task = session._sub_agent_task
    session._sub_agent_task = None
    if session._active_task is not None and not session._active_task.done():
        session._active_task.cancel()
        try:
            await asyncio.wait_for(session._active_task, timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        session._active_task = None
    interaction.current_ws.set(ws)
    interaction.current_session_id.set(session.session_id)
    agent_task = asyncio.create_task(
        _run_agent_turn(ws, session, task, private_mode=False)
    )
    session._active_task = agent_task
    return agent_task


@router.websocket("/ws/chat/{session_id}")
async def websocket_chat(ws: WebSocket, session_id: str):
    """WebSocket 聊天端点 — 接收用户消息、驱动 Agent、处理取消和用户交互。"""
    await ws.accept()

    # ── 初始化会话 ────────────────────────────────────────
    app_state = ws.app.state
    session = await app_state.session_manager.get_or_create(session_id)

    # 注册 WebSocket 到注册表，供后台记忆 consumer 推送事件
    app_state.ws_registry.register(session_id, ws)

    # ── 推送初始上下文用量 ─────────────────────────────────
    initial_usage = await _calculate_context_usage(
        session,
        app_state.system_prompt,
        max_tokens=256_000,
        model_name="",
    )
    await ws.send_json({"type": "context_usage", "payload": initial_usage})

    # ── 断线重连时恢复 sub-agent ──────────────────────────
    agent_task = await _resume_sub_agent(ws, session)

    # ── 消息主循环 ────────────────────────────────────────
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue

            match msg.get("type", ""):
                case "ping":
                    await ws.send_json({"type": "pong", "payload": {}})

                case "chat":
                    if agent_task and not agent_task.done():
                        continue

                    payload = msg.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    user_message = str(payload.get("message", "")).strip()
                    if not user_message:
                        continue

                    allowed, rate_err = get_ws_rate_limiter().try_consume(session_id)
                    if not allowed:
                        get_metrics().record_rate_limit("ws")
                        error_collector.add_error(
                            level="WARNING",
                            category="rate_limit",
                            message=f"WebSocket 限流: {rate_err}",
                            session_id=session_id,
                        )
                        await ws.send_json({"type": "error", "payload": rate_err})
                        continue

                    auto_approve = _effective_auto_approve(
                        session, payload.get("auto_approve", False)
                    )
                    interaction.current_ws.set(ws)
                    interaction.current_session_id.set(session_id)
                    interaction.set_session_auto_approve(session_id, auto_approve)

                    agent_task = asyncio.create_task(
                        _run_agent_turn(
                            ws,
                            session,
                            user_message,
                            private_mode=payload.get("private", False),
                            auto_approve=auto_approve,
                            turn_id=payload.get("turn_id"),
                        )
                    )
                    session._active_task = agent_task

                case "user_response":
                    payload = msg.get("payload", {})
                    interaction_id = payload.get("interaction_id", "")
                    response = payload.get("response", "")
                    if interaction_id:
                        await interaction.resolve(interaction_id, response)

                case "artifact_action":
                    if not get_settings().interactive_artifacts_enabled:
                        continue
                    try:
                        from api.artifacts.schema import (
                            ArtifactActionResponse,
                            artifact_action_authorizer,
                        )

                        response = ArtifactActionResponse.model_validate(
                            msg.get("payload", {})
                        )
                        authorized = artifact_action_authorizer.authorize(
                            response, session_id=session_id
                        )
                    except (TypeError, ValueError):
                        continue
                    if authorized is None:
                        continue
                    if await interaction.resolve(
                        authorized.interaction_id, authorized.action_id
                    ):
                        artifact_action_authorizer.consume(authorized)

                case "plan_response":
                    payload = msg.get("payload", {})
                    plan_id = payload.get("plan_id", "")
                    action = payload.get("action", "")
                    modified_plan = payload.get("modified_plan", "")
                    if plan_id:
                        if action == "approve":
                            await interaction.resolve(plan_id, "approve")
                        elif action == "reject":
                            await interaction.resolve(plan_id, "reject")
                        elif action == "modify" and modified_plan:
                            await interaction.resolve(plan_id, modified_plan)
                        else:
                            await interaction.resolve(plan_id, "reject")

                case "cancel":
                    if agent_task and not agent_task.done():
                        agent_task.cancel()
                        agent_task = None

                case "update_auto_approve":
                    payload = msg.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    auto_approve_val = _effective_auto_approve(
                        session, payload.get("auto_approve", False)
                    )
                    interaction.set_session_auto_approve(session_id, auto_approve_val)
                    session.auto_approve = auto_approve_val

    except WebSocketDisconnect:
        pass
    finally:
        app_state.ws_registry.unregister(session_id)
        if agent_task and not agent_task.done():
            agent_task.cancel()
        if session._active_task is agent_task:
            session._active_task = None
        interaction.clear_session_settings(session_id)
