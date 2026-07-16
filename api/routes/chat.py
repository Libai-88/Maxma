"""WebSocket 端点 — 流式 Agent 对话，含取消、用户交互和多轮上下文。"""

import asyncio
import json
import sys
import logging
import traceback
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent.model_routing import resolve_model_role
from agent.prompts import build_system_prompt, get_system_prompt_parts
from agent.think_path import ThinkPath, get_think_path
from app_paths import CONFIG_DIR
from agent.context_manager import commit_to_episodic
from api import interaction
from api.const_session_store import save_const_session, serialize_messages
from api.context_usage import estimate_context_usage
from api.errors import ErrorCode, format_ws_error
from api.metrics import get_metrics
from api.middleware.rate_limit import get_ws_rate_limiter
from api.diagnostics import error_collector
from api.session_manager import SessionState
from config.settings import get_settings
from tools import get_all_tools, merge_tool_lists
from tools.base import format_error
from tools.path_security import check_path_access

logger = logging.getLogger(__name__)

router = APIRouter()

_LOCAL_REF_PREFIX = "local:"
_MODEL_ROLES_PATH = CONFIG_DIR / "model_roles.yaml"


@dataclass(frozen=True)
class ThinkPathExecution:
    """Validated, opt-in execution preference for one chat turn.

    The browser can only submit a fixed ThinkPath id.  Resolving its role and
    selecting a provider happens server-side, so a client cannot smuggle an
    arbitrary provider role, model capability, or cost preference into a chat
    request.
    """

    path: ThinkPath | None = None
    provider: Any | None = None
    model_name: str | None = None


def _resolve_think_path_execution(
    think_path_id: object,
    *,
    think_path_enabled: bool,
    declarative_model_routing_enabled: bool,
    has_explicit_model_selection: bool,
    provider_manager: Any | None,
    model_roles_path: Path = _MODEL_ROLES_PATH,
) -> ThinkPathExecution:
    """Resolve a visible ThinkPath without weakening model-selection rules.

    A path is ignored unless its feature flag is on.  Explicit provider/model
    choices always win, and an unavailable/malformed declarative rule leaves
    the normal default route untouched.  This helper performs no I/O besides
    reading the local role configuration and never changes provider state.
    """
    if not think_path_enabled:
        return ThinkPathExecution()

    path = get_think_path(think_path_id if isinstance(think_path_id, str) else None)
    if path is None:
        return ThinkPathExecution()

    if (
        not declarative_model_routing_enabled
        or has_explicit_model_selection
        or provider_manager is None
    ):
        return ThinkPathExecution(path=path)

    try:
        role = resolve_model_role(model_roles_path, path.role)
        selected = provider_manager.select_for_role(role)
    except Exception:
        # Role routing is an optional convenience.  A bad local rule or an
        # unexpected provider implementation must never reject the message.
        logger.warning("[chat] ThinkPath model routing unavailable", exc_info=True)
        return ThinkPathExecution(path=path)

    if selected is None:
        return ThinkPathExecution(path=path)
    provider, model_name = selected
    if not isinstance(model_name, str) or not model_name.strip():
        return ThinkPathExecution(path=path)
    return ThinkPathExecution(path=path, provider=provider, model_name=model_name)


def _think_path_runtime_context(path: ThinkPath | None) -> str:
    """Return trusted, fixed execution guidance for a selected path only."""
    if path is None:
        return ""
    return (
        "[本轮执行偏好（用户已确认）]\n"
        f"采用“{path.label}”路径：{path.description}\n"
        f"预期深度：{path.depth}；预估成本：{path.estimated_cost}。"
    )


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


def _get_provider_context(app_state) -> tuple[int, str]:
    """从 ProviderManager 获取默认 context_window 和 model_name。"""
    mgr = getattr(app_state, "provider_manager", None)
    if mgr is not None and mgr.count > 0:
        for provider in mgr.iter_enabled():
            return provider.config.context_window, provider.default_model
    return 256_000, ""


def _build_runtime_context_for_agent(
    app_state, turn_tools, current_model_name: str | None
) -> str:
    """生成运行时配置摘要，注入到 agent 的 episodic_context。

    让 agent 每轮都能"看到"自己的配置全貌（providers/MCP/工具统计），
    减少执行路径的不确定性。失败时返回空字符串，不阻塞主流程。
    """
    try:
        from agent.runtime_context import build_runtime_context

        provider_manager = getattr(app_state, "provider_manager", None)
        native_count = sum(
            1
            for t in turn_tools
            if not t.name.split("_")[0].islower() or "_" not in t.name
        )
        # 更准确的统计：MCP 工具名通常带 server_id 前缀
        from tools import TOOL_CATEGORIES

        all_native_names: set[str] = set()
        for names in TOOL_CATEGORIES.values():
            all_native_names.update(names)
        native_count = sum(1 for t in turn_tools if t.name in all_native_names)
        mcp_count = len(turn_tools) - native_count

        return build_runtime_context(
            provider_manager=provider_manager,
            mcp_tool_count=mcp_count,
            native_tool_count=native_count,
            current_model_name=current_model_name,
        )
    except Exception as e:
        logger.warning("[chat] 运行时配置摘要生成失败: %s", e)
        return ""


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
    blocked = check_path_access(str(file_path))
    if blocked:
        raise PermissionError(blocked)
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


async def _get_recent_ai_messages(session, config, limit: int = 5) -> list[str]:
    """从 sidecar 获取最近 N 条 AI 消息内容（用于贴纸情感分析）。

    sidecar 模式下 config 为 None，改为从 sidecar RPC 获取消息历史。
    """
    messages = await _get_messages_from_sidecar(session, limit=limit * 3)
    ai_msgs = [m.get("content", "") for m in messages if m.get("role") == "assistant"]
    return ai_msgs[-limit:]


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

    # 3. 情景记忆：每轮对话以用户消息为查询检索相关历史，注入到 user_message
    _user_message_for_llm = user_message_for_llm
    try:
        _episodic_mm = getattr(app_state, "episodic_mm", None)
        if _episodic_mm is not None and user_message_for_llm:
            from agent.context_manager import retrieve_from_episodic
            _episodic_context = retrieve_from_episodic(
                user_message_for_llm,
                _episodic_mm,
                top_k=3,
                session_id=session.session_id,
            )
            if _episodic_context:
                _user_message_for_llm = (
                    f"[相关情景记忆]\n{_episodic_context}\n\n"
                    f"---\n\n{user_message_for_llm}"
                )
    except Exception:
        logger.warning("[sidecar] Episodic retrieval failed", exc_info=True)

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
        # Extract the answer but do NOT send to WS — the existing post-processing
        # in _run_agent_turn handles sticker processing + answer push.
        final_answer = event.get("payload", {}).get("content", "")

    async def _on_done(sid: str, event: dict):
        if sid != sidecar_sid:
            return
        turn_done.set()

    async def _on_error(sid: str, event: dict):
        """BUG5 fix: forward sidecar error events to the frontend."""
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
            "message": _user_message_for_llm,
        })
        # Wait for done event (sidecar signals completion)
        await asyncio.wait_for(turn_done.wait(), timeout=600)
    except asyncio.TimeoutError:
        logger.warning("[sidecar] Turn timed out for session %s", sidecar_sid)
        # BUG-2 fix: cancel sidecar work to prevent resource leak
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            pass
        if not final_answer:
            final_answer = "（Sidecar 处理超时，请重试）"
    except Exception as e:
        logger.exception("[sidecar] Turn failed for session %s", sidecar_sid)
        # BUG-2 fix: cancel sidecar work on error
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
    # 粗略估算：混合中英文约 2 字符/token
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

# 匹配 Windows / Unix 绝对路径
_PATH_PATTERN = _re.compile(r"(?:[A-Za-z]:[\\/]|[\\/])(?:[\w .\-]+[\\/])*[\w .\-]+")


def _detect_project_path(message: str) -> str | None:
    """从用户消息中提取可能的项目根目录路径。"""
    matches = _PATH_PATTERN.findall(message)
    for m in matches:
        p = m.rstrip("\\/").rstrip()
        # 检查是否是目录
        from pathlib import Path as _Path

        if _Path(p).is_dir():
            # 检查是否像项目根目录（含 .git 或 package.json 或 pyproject.toml 等）
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
    # 已有缓存
    if session._project_context is not None:
        return session._project_context

    # 尝试从消息检测项目路径
    project_path = _detect_project_path(user_message)
    if project_path is None:
        return None

    # 扫描项目
    try:
        from agent.project_scanner import scan_project

        ctx = scan_project(project_path)
        text = ctx.to_prompt_text()
        # 缓存到 session
        session._project_context = text
        session._project_path = project_path
        return text
    except Exception as e:
        import logging

        logging.getLogger(__name__).warning("[project_scanner] 扫描失败: %s", e)
        return None


async def _project_completed_turn_to_episodic(
    *,
    user_message: str = "",
    assistant_message: str = "",
    episodic_mm,
    session_id: str,
    turn_id: str,
    graph=None,
    config: dict | None = None,
) -> None:
    """Best-effort 将一个成功的 chat turn 投影到情景记忆。

    sidecar 模式下 graph/config 为 None，直接使用传入的 user_message 和
    assistant_message 构造摘要，不再从 checkpoint 读取消息列表。
    """
    if episodic_mm is None:
        return
    try:
        # sidecar 模式：graph 为 None，使用直接传入的消息
        if graph is None:
            # 构造简单的摘要文本用于情景记忆
            summary_parts = []
            if user_message:
                user_preview = user_message[:200] + ("..." if len(user_message) > 200 else "")
                summary_parts.append(f"用户: {user_preview}")
            if assistant_message:
                asst_preview = assistant_message[:300] + ("..." if len(assistant_message) > 300 else "")
                summary_parts.append(f"助理: {asst_preview}")
            summary = "\n".join(summary_parts)
            if not summary:
                return
            # 写入情景记忆（add_episode 是同步方法）
            episode_id = episodic_mm.add_episode(
                summary=summary,
                session_id=session_id,
                turn_id=turn_id,
            )
            if episode_id is None:
                logger.debug(
                    "[episodic] no episode created for session=%s turn=%s",
                    session_id, turn_id,
                )
            return

        # LangGraph 路径（保留兼容，理论上 sidecar 模式不会到达）
        episode_id = await commit_to_episodic(
            graph,
            config,
            episodic_mm,
            session_id=session_id,
            turn_id=turn_id,
        )
        if episode_id is None:
            logger.warning(
                "[episodic] projection produced no episode for session=%s turn=%s",
                session_id,
                turn_id,
            )
    except Exception:
        logger.exception(
            "[episodic] projection failed after completed response for session=%s turn=%s",
            session_id,
            turn_id,
        )


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
    provider_id: str | None = None,
    model_name: str | None = None,
    think_path_id: str | None = None,
    turn_id: str | None = None,
):
    """
    在指定的session中编排一轮 Agent 对话。
    无返回值。
    以内置的 WebSocketCallback回调函数和前端通信系统作为副作用。

    若指定了 provider_id + model_name，则从 ProviderManager 动态创建 LLM；
    否则退化到 app_state.llm 全局 fallback。
    """
    # 1. [准备环境] 从 WebSocket 获取应用状态
    app_state = ws.app.state
    current_task = asyncio.current_task()
    # The memory id is assigned before any model work.  Callers can pass a
    # stable client/request id when retrying after reconnect; otherwise this
    # invocation gets one stable id for its full lifetime.
    turn_id = _new_turn_id(turn_id)
    interaction.current_session_id.set(session.session_id)
    # ── 多模态：自动描述用户附带的图片 ──────────────────────────
    user_message = await _process_image_refs(user_message)
    # ────────────────────────────────────────────────────────────

    # 获取默认上下文窗口大小和模型名（一次性解构，避免重复调用）
    default_max_tokens, fallback_model_name = _get_provider_context(app_state)

    # 子会话在创建时带有不可变的 DelegationContext。前端连接后也必须
    # 消费它，不能让客户端 payload 或之后的全局 provider 配置改变父任务
    # 已授权的模型、工具或预算。普通会话保持原有选择逻辑。
    delegation_context = (
        getattr(session, "delegation_context", None)
        if getattr(session, "is_subagent", False)
        else None
    )
    delegation_helpers = None
    auto_approve = _effective_auto_approve(session, auto_approve)
    session.auto_approve = auto_approve
    interaction.set_session_auto_approve(session.session_id, auto_approve)

    # 动态 LLM 选择（Phase 2：每次消息独立指定提供商/模型）
    # 阶段 3.3：指定 provider 失败时尝试 fallback 链（按 priority 排序）
    current_max_tokens = default_max_tokens
    current_provider_id = ""
    if provider_id and model_name and hasattr(app_state, "provider_manager"):
        try:
            provider = app_state.provider_manager.get(provider_id)
            llm = provider.create_llm(model_name, temperature=0.7, streaming=True)
            current_model_name = model_name
            current_max_tokens = provider.config.context_window
            current_provider_id = provider.config.id
        except KeyError:
            # 阶段 3.3：尝试 fallback 到下一个可用 provider
            fallback_provider = app_state.provider_manager.get_fallback(
                exclude_ids={provider_id} if provider_id else None
            )
            if fallback_provider is not None:
                logger.warning(
                    "[chat:%s] requested provider/model fallback: provider_id=%r model=%r not found; "
                    "switching to fallback provider=%r (priority=%d)",
                    session.session_id[:8],
                    provider_id,
                    model_name,
                    fallback_provider.config.id,
                    fallback_provider.config.priority,
                )
                llm = fallback_provider.create_llm(
                    fallback_provider.default_model,
                    temperature=0.7,
                    streaming=True,
                )
                current_model_name = fallback_provider.default_model
                current_max_tokens = fallback_provider.config.context_window
                current_provider_id = fallback_provider.config.id
            else:
                logger.warning(
                    "[chat:%s] requested provider/model fallback: provider_id=%r model=%r not found; "
                    "no fallback available, using default",
                    session.session_id[:8],
                    provider_id,
                    model_name,
                )
                llm = app_state.llm
                current_model_name = None
    elif provider_id or model_name:
        logger.warning(
            "[chat:%s] requested provider/model fallback: provider_id=%r model=%r incomplete or unavailable; "
            "using default provider/model=%r",
            session.session_id[:8],
            provider_id,
            model_name,
            fallback_model_name or "<unknown>",
        )
        llm = app_state.llm
        current_model_name = None
    else:
        llm = app_state.llm
        current_model_name = None

    # ThinkPath is a user-confirmed depth preference, not an opaque prompt
    # classifier.  It may opt into declarative routing only when the user did
    # not already select a provider/model in this same request.
    settings = get_settings()
    think_path_execution = _resolve_think_path_execution(
        think_path_id,
        think_path_enabled=settings.think_path_enabled,
        declarative_model_routing_enabled=settings.declarative_model_routing_enabled,
        has_explicit_model_selection=bool(provider_id or model_name),
        provider_manager=getattr(app_state, "provider_manager", None),
    )
    if think_path_execution.provider is not None:
        try:
            routed_provider = think_path_execution.provider
            routed_model_name = think_path_execution.model_name
            llm = routed_provider.create_llm(
                routed_model_name,
                temperature=0.7,
                streaming=True,
            )
            current_provider_id = routed_provider.config.id
            current_model_name = routed_model_name
            current_max_tokens = routed_provider.config.context_window
            logger.info(
                "[chat:%s] ThinkPath %s selected provider=%s model=%s",
                session.session_id[:8],
                think_path_execution.path.id if think_path_execution.path else "",
                current_provider_id,
                current_model_name,
            )
        except Exception:
            # Do not turn an optional selection preference into a chat outage.
            # The previously selected/default LLM remains intact.
            logger.warning(
                "[chat:%s] ThinkPath route creation failed; using normal selection",
                session.session_id[:8],
                exc_info=True,
            )

    if delegation_context is not None:
        from tools.sub_agent.delegation_context import (
            activate_delegation_context,
            bind_model_budget,
            prepare_delegated_tools,
            reset_delegation_context,
        )

        delegation_helpers = (
            activate_delegation_context,
            prepare_delegated_tools,
            reset_delegation_context,
        )
        if delegation_context.remaining_seconds() <= 0:
            error = RuntimeError("子 Agent 的委托时间预算已耗尽")
            if (
                session._pending_result is not None
                and not session._pending_result.done()
            ):
                session._pending_result.set_exception(error)
            await ws.send_json(
                format_ws_error(ErrorCode.AGENT_ERROR, "子 Agent 的委托时间预算已耗尽")
            )
            return
        llm = bind_model_budget(delegation_context)
        current_model_name = delegation_context.model_name or current_model_name
        if delegation_context.max_tokens > 0:
            current_max_tokens = min(current_max_tokens, delegation_context.max_tokens)

    if llm is None:
        error_collector.add_error(
            level="ERROR",
            category="llm",
            message="No LLM provider configured",
            session_id=session.session_id,
        )
        await ws.send_json(
            format_ws_error(
                ErrorCode.NO_LLM,
                "No LLM provider configured. Add one in Model Settings first.",
            )
        )
        return

    # A normal parent turn also activates a context.  This makes a top-level
    # delegation inherit the model actually selected for this request rather
    # than rediscovering app_state.llm inside the tool.
    if delegation_context is None:
        from tools.sub_agent.delegation_context import (
            activate_delegation_context,
            create_delegation_context,
            reset_delegation_context,
        )

        execution_context = create_delegation_context(
            app_state,
            session.session_id,
            model=llm,
            provider_id=current_provider_id,
            model_name=current_model_name,
            auto_approve=auto_approve,
        )
        delegation_helpers = (
            activate_delegation_context,
            None,
            reset_delegation_context,
        )
    else:
        execution_context = delegation_context

    system_prompt = build_system_prompt()

    # ── 项目上下文自动感知 ──────────────────────────────────────
    # 缓存优化：project_ctx 不再追加到 system_prompt，而是 prepend 到
    # user_message。这样 SystemMessage 保持完全稳定，有利于 DeepSeek
    # prompt cache 命中（project_ctx 仅在检测到项目路径时非空）。
    project_ctx = _get_project_context(session, user_message)
    # ────────────────────────────────────────────────────────────

    # 缓存优化：使用全量工具集 + MCP 工具，避免每轮工具集变化破坏
    # DeepSeek prompt cache（tools 字段是 prompt 前缀的一部分）。
    # 全量工具带来的额外 token 会被缓存，成本远低于缓存 miss。
    mcp_tools = getattr(ws.app.state, "mcp_tools", None) or []
    turn_tools = merge_tool_lists(
        get_all_tools(), list(mcp_tools), log_collisions=False
    )
    if delegation_context is not None:
        # This is the execution boundary, not merely prompt-time filtering.
        # ScopedTool validates path arguments immediately before each call.
        turn_tools = delegation_helpers[1](turn_tools, delegation_context)
    # 4 层架构：注入情景记忆管理器，启用 episodic_retriever 节点
    episodic_mm = getattr(ws.app.state, "episodic_mm", None)
    # B6：生成运行时配置摘要，让 agent 感知自身的 providers/MCP/工具配置全貌
    runtime_context_text = _build_runtime_context_for_agent(
        app_state, turn_tools, current_model_name
    )
    think_path_context = _think_path_runtime_context(think_path_execution.path)
    if think_path_context:
        runtime_context_text = "\n\n".join(
            part for part in (think_path_context, runtime_context_text) if part
        )

    # project_ctx prepend 到 user_message（不修改 system_prompt，保持缓存稳定）
    if project_ctx:
        user_message_for_llm = f"[项目上下文]\n{project_ctx}\n\n---\n\n{user_message}"
    else:
        user_message_for_llm = user_message

    # oh-my-pi sidecar: no LangGraph state
    config = None
    agent_maxma = None
    session._graph = None

    # 2. [执行轮次] 流式执行 Agent 图，副作用推送最终回答，另有config回调副作用
    final_answer = ""
    _run_error: str | None = None
    turn_completed = False
    context_token = None
    try:
        # turn 开始时推送当前上下文用量（含刚加入的 user message）
        initial_turn_usage = await _calculate_context_usage(
            session,
            system_prompt,
            max_tokens=current_max_tokens,
            model_name=current_model_name or "",
        )
        await ws.send_json({"type": "context_usage", "payload": initial_turn_usage})

        context_token = delegation_helpers[0](execution_context)
        if delegation_context is not None:
            async with asyncio.timeout(delegation_context.remaining_seconds()):
                final_answer = await _stream_turn_sidecar(
                    ws,
                    session,
                    user_message_for_llm,
                    system_prompt,
                    current_provider_id,
                    current_model_name,
                )
        else:
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
        # Sidecar mode: no graph state to inspect, trust the returned answer
        turn_completed = bool(final_answer)

        # 保存本轮对话到 SessionMap（用于侧边栏重启后恢复上下文）
        if final_answer and not private_mode:
            try:
                from api.pi_bridge.session_adapter import SessionMap
                with SessionMap() as sm:
                    sm.append_turn(session.session_id, user_message, final_answer)
            except Exception:
                logger.debug("[sidecar] Failed to save turn to SessionMap", exc_info=True)

        if final_answer:
            # 表情包处理：分层决策架构
            # 1. LLM 主动输出 [表情包:情绪] → 直接解析
            # 2. LLM 未输出 → 决策器判断是否补发
            from tools.sticker_utils import process_stickers

            ai_recent = await _get_recent_ai_messages(session, config, limit=5)
            processed_answer, _ = process_stickers(
                final_answer,
                user_message=user_message,
                ai_recent_messages=ai_recent,
            )
            final_answer = processed_answer
            await ws.send_json(
                {  # [向前端通信] 1. 向客户端推送最终答案
                    "type": "answer",
                    "payload": {"content": processed_answer},
                }
            )
    except asyncio.CancelledError:
        # 清理 interaction 挂起 Future
        await interaction.cancel_session(session.session_id)

        # sidecar 模式：通过 cancel RPC 中止 sidecar 中的生成
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

        # 注：原 LangGraph 路径的 checkpoint 清理和 interrupt AIMessage 注入
        # 在 sidecar 模式下不再需要 — cancel RPC 已中止生成，
        # sidecar 内部维护消息状态的一致性。

        await ws.send_json(format_ws_error(ErrorCode.CANCELLED, "生成已取消"))
    except Exception as e:
        # 清理可能挂起的用户交互 Future，防止阻塞后续交互
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
        # BUG-3 fix: protect finally block to avoid masking original exceptions
        try:
            if context_token is not None:
                delegation_helpers[2](context_token)
            if session._active_task is current_task:
                session._active_task = None
            context_usage = await _calculate_context_usage(
                session,
                system_prompt,
                max_tokens=current_max_tokens,
                model_name=current_model_name or "",
            )
            await ws.send_json(
                {  # [向前端通信] 3. 推送 turn 结束 + 上下文用量 + turn_id（用于记忆事件关联）
                    "type": "done",
                    "payload": {
                    "turn_id": turn_id,
                    "context_usage": context_usage,
                },
            }
        )
        except Exception:
            pass  # WS 已断开或 context_usage 计算失败时静默跳过

    # 3. [后处理] 增加消息计数器，将对话记录入长期记忆
    if final_answer:
        session.message_count += 2  # human + ai
    # sidecar 模式下错误轮次不增计数（sidecar 可能未保存用户消息）
    memory_eligible = turn_completed and bool(final_answer)
    if not private_mode and memory_eligible:
        if final_answer:
            await _project_completed_turn_to_episodic(
                user_message=user_message,
                assistant_message=final_answer,
                episodic_mm=episodic_mm,
                session_id=session.session_id,
                turn_id=turn_id,
            )
        # 增量发送：只传成功轮次给记忆消费者，避免错误提示污染 LTM。
        messages_for_memory = [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": final_answer},
        ]
        logger.info(
            "[ltm] calling send_history, messages=%d (incremental)",
            len(messages_for_memory),
        )
        try:
            await app_state.ltm.send_history(
                messages_for_memory,
                session_id=session.session_id,
                turn_id=turn_id,
            )
            logger.info("[ltm] send_history completed")
        except Exception as e:
            logger.error("[ltm] send_history failed: %s", e, exc_info=True)

    # 4. [Const 会话] 自动持久化到磁盘 YAML
    if final_answer and session.is_const:
        try:
            # sidecar 模式：从 sidecar 获取消息历史
            messages = await _get_messages_from_sidecar(session, limit=200)
            if messages:
                # 转换为 serialize_messages 兼容格式
                serialized = []
                for m in messages:
                    role = m.get("role", "unknown")
                    content = m.get("content", "")
                    if role == "user":
                        serialized.append({"type": "human", "content": content})
                    elif role == "assistant":
                        serialized.append({"type": "ai", "content": content})
                # 确保最后一条 AI 消息是 final_answer
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
    session._sub_agent_task = None  # 消费掉，防止重连后重复启动
    # 取消旧任务，等待其完成后再创建新任务，避免 checkpoint 竞态
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
    default_max_tokens, default_model = _get_provider_context(app_state)
    initial_usage = await _calculate_context_usage(
        session,
        app_state.system_prompt,
        max_tokens=default_max_tokens,
        model_name=default_model,
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
                # 客户端发送非 JSON 文本（心跳探针、协议错误等），忽略不中断连接
                continue
            if not isinstance(msg, dict):
                continue

            match msg.get("type", ""):
                case "ping":
                    await ws.send_json({"type": "pong", "payload": {}})

                case "chat":
                    if agent_task and not agent_task.done():
                        continue  # 已有 Agent 运行中，忽略本次输入

                    payload = msg.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    user_message = str(payload.get("message", "")).strip()
                    if not user_message:
                        continue

                    # 阶段 3.2：per-session 令牌桶限流
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
                    interaction.current_ws.set(ws)  # 供工具函数通过 WebSocket 推送交互
                    interaction.current_session_id.set(session_id)
                    interaction.set_session_auto_approve(session_id, auto_approve)

                    agent_task = asyncio.create_task(
                        _run_agent_turn(
                            ws,
                            session,
                            user_message,
                            private_mode=payload.get("private", False),
                            auto_approve=auto_approve,
                            provider_id=payload.get("provider_id"),
                            model_name=payload.get("model_name"),
                            think_path_id=payload.get("think_path_id"),
                            turn_id=payload.get("turn_id"),
                        )
                    )
                    session._active_task = agent_task  # 供外部 REST 接口查询活跃状态

                case "user_response":
                    payload = msg.get("payload", {})
                    interaction_id = payload.get("interaction_id", "")
                    response = payload.get("response", "")
                    if interaction_id:
                        await interaction.resolve(interaction_id, response)

                case "artifact_action":
                    # Artifact actions are never tool calls.  They can only
                    # resolve an already-pending interaction after the signed,
                    # session-bound token has been validated.

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
        pass  # 客户端断开是正常行为
    finally:
        app_state.ws_registry.unregister(session_id)
        if agent_task and not agent_task.done():
            agent_task.cancel()
        if session._active_task is agent_task:
            session._active_task = None
        interaction.clear_session_settings(session_id)
