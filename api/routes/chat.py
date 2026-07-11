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
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent.graph import build_agent
from agent.model_routing import resolve_model_role
from agent.prompts import build_system_prompt, get_system_prompt_parts
from agent.think_path import ThinkPath, get_think_path
from app_paths import CONFIG_DIR
from agent.context_manager import commit_to_episodic, maybe_trim_checkpoint
from api import interaction
from api.callbacks.websocket_callback import WebSocketCallback
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
    from config.settings import get_settings
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


def _get_final_answer(event) -> str:
    """
    从 on_chain_end 事件提取原始 final_answer，
    返回 content。
    """
    output = event["data"].get("output", {})
    messages = output.get("messages", [])
    if not messages:
        return ""
    raw_final_answer = messages[-1]  # 最后一条message为Final Answer
    final_answer = (
        raw_final_answer.content
        if hasattr(raw_final_answer, "content")
        else str(raw_final_answer)
    )
    return final_answer


async def _get_recent_ai_messages(session, config, limit: int = 5) -> list[str]:
    """从 checkpoint 获取最近 N 条 AI 消息内容。"""
    try:
        cpt = await session.checkpointer.aget_tuple(config)
        if cpt is None:
            return []
        messages = cpt.checkpoint.get("channel_values", {}).get("messages", [])
        # 从后往前取 AI 消息（排除最后一条，因为那是当前回复）
        ai_messages = []
        for msg in reversed(messages[:-1]):
            if hasattr(msg, "type") and msg.type == "ai":
                content = msg.content if hasattr(msg, "content") else str(msg)
                if content:
                    ai_messages.append(content)
                    if len(ai_messages) >= limit:
                        break
        return ai_messages
    except Exception:
        return []


async def _stream_turn(
    graph,
    inputs,
    config,
    ws,
    session,
    system_prompt,
    model_name: str | None = None,
    max_tokens: int = 256_000,
) -> str:
    """流式执行 Agent 图，返回最终回答。"""
    final_answer = ""
    async for event in graph.astream_events(inputs, config=config, version="v2"):
        if event.get("event") == "on_chain_end" and event.get("name") == "agent":
            final_answer = _get_final_answer(event)
        # 一轮工具执行完毕，ToolMessage 已写入 checkpoint，推送上下文用量
        if event.get("event") == "on_chain_end" and event.get("name") == "tools":
            usage = await _calculate_context_usage(
                session,
                system_prompt,
                max_tokens=max_tokens,
                model_name=model_name or "",
            )
            await ws.send_json({"type": "context_usage", "payload": usage})

    # 事件未捕获到 final_answer 时，从 checkpoint 兜底提取
    if not final_answer:
        try:
            cpt = await session.checkpointer.aget_tuple(config)
            if cpt is not None:
                messages = cpt.checkpoint.get("channel_values", {}).get("messages", [])
                if messages:
                    last = messages[-1]
                    candidate = last.content if hasattr(last, "content") else str(last)
                    if candidate:
                        final_answer = candidate
        except Exception:
            logger.debug(
                "Failed to read fallback final_answer from checkpoint", exc_info=True
            )

    # 二级兜底：如果 final_answer 仍为空（如 executor 跳过最后一步后图直接结束，
    # LLM 未生成文字回复），从 checkpoint 中提取最后一个工具错误，
    # 包装为用户可见的提示，确保这一轮对话不会被"吞掉"。
    if not final_answer:
        try:
            cpt = await session.checkpointer.aget_tuple(config)
            if cpt is not None:
                messages = cpt.checkpoint.get("channel_values", {}).get("messages", [])
                # 从后往前找最后一个含错误标记的 ToolMessage
                for msg in reversed(messages):
                    if not isinstance(msg, ToolMessage):
                        continue
                    content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else str(msg.content)
                    )
                    if (
                        '"success": false' not in content
                        and '"success":false' not in content
                    ):
                        continue
                    # 提取错误信息
                    tool_err_msg = "工具执行失败"
                    try:
                        import json as _json

                        parsed = _json.loads(content)
                        if isinstance(parsed, dict) and parsed.get("success") is False:
                            tool_err_msg = parsed.get("error", tool_err_msg)
                    except (ValueError, TypeError):
                        tool_err_msg = content[:200]
                    tool_name = getattr(msg, "name", "") or "工具"
                    final_answer = (
                        f"抱歉，这一轮处理没能完成。\n\n"
                        f"**{tool_name}** 报告：{tool_err_msg}\n\n"
                        f"你可以调整后重试，或者告诉我换个方式处理。"
                    )
                    break
        except Exception:
            logger.debug(
                "Failed to extract tool error fallback from checkpoint", exc_info=True
            )

    # 三级兜底：所有提取均失败时，给用户一个明确的提示而非空白
    if not final_answer:
        final_answer = "（这一轮处理未生成文字回复，请查看工具执行结果或重新提问。）"

    return final_answer


async def _calculate_context_usage(
    session,
    system_prompt,
    *,
    max_tokens: int = 256_000,
    model_name: str = "",
) -> dict:
    """
    从 checkpointer 拉取消息列表，估算上下文用量。
    返回字典，包括现用量、最大用量、占比、模型名称。
    """
    try:
        cpt = await session.checkpointer.aget_tuple(
            {"configurable": {"thread_id": session.session_id}}
        )
        if cpt is not None:
            channel_values = cpt.checkpoint.get("channel_values", {})
            counting_messages = channel_values.get("messages", [])
        else:
            counting_messages = []
    except Exception:
        logger.debug(
            "Failed to read checkpoint for context usage estimation", exc_info=True
        )
        counting_messages = []

    return estimate_context_usage(
        messages=counting_messages,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        model_name=model_name,
        system_prompt_parts=get_system_prompt_parts(),
    )


async def _maybe_notify_plan_degraded(graph, config, ws: WebSocket) -> None:
    """阶段 2.3：检测 plan 是否以降级状态完成，向前端推送 plan_degraded 事件。

    降级状态：plan_steps 中有步骤被 SKIPPED 或 FAILED（重规划失败 N 次后跳过步骤）。
    前端收到此事件后可提示用户"结果可能不完整"，并展示被跳过的步骤列表。

    幂等：仅在 is_degraded=True 时推送；无 plan 或 plan 正常完成时不推送。
    """
    try:
        state = await graph.aget_state(config)
    except Exception:
        return
    if state is None:
        return

    values = state.values or {}
    plan_steps = values.get("plan_steps") or []
    if not plan_steps:
        return  # 无计划，简单任务不处理

    step_status = values.get("step_status") or {}
    failure_count = values.get("failure_count", 0)
    replan_count = values.get("replan_count", 0)

    # 收集被跳过/失败的步骤
    skipped: list[dict] = []
    failed: list[dict] = []
    from agent.step_state import StepStatus

    for step_dict in plan_steps:
        idx = step_dict.get("index", 0)
        status_val = step_status.get(str(idx))
        if status_val == StepStatus.SKIPPED.value:
            skipped.append(
                {
                    "index": idx,
                    "description": step_dict.get("description", ""),
                }
            )
        elif status_val == StepStatus.FAILED.value:
            failed.append(
                {
                    "index": idx,
                    "description": step_dict.get("description", ""),
                }
            )

    if not skipped and not failed:
        return  # 正常完成，无需通知

    try:
        await ws.send_json(
            {
                "type": "plan_degraded",
                "payload": {
                    "skipped_steps": skipped,
                    "failed_steps": failed,
                    "failure_count": failure_count,
                    "replan_count": replan_count,
                    "message": (
                        f"执行计划以降级模式完成：{len(skipped)} 个步骤被跳过，"
                        f"{len(failed)} 个步骤失败。结果可能不完整，建议检查或重新提问。"
                    ),
                },
            }
        )
    except Exception:
        logger.debug("[degraded] ws send failed", exc_info=True)


async def _inject_cancel_tool_messages(session, config, ws: WebSocket) -> None:
    """为 checkpoint 中孤立的 tool_calls 注入统一格式的正常 ToolMessage，
    并通知前端使对应工具气泡进入错误状态。

    由 CancelledError 处理器调用，确保取消后 checkpoint 状态一致，
    下一条消息不会触发 "tool_calls without corresponding ToolMessage" 错误。

    注入的 ToolMessage 使用 status="success"（默认），content 套用 format_error()
    统一错误响应格式，使 LLM 在下一轮能正确识别工具调用已被取消。

    前端 tool_error 事件：如果对应工具气泡尚在 'running' 状态，则标记为 'error'；
    若工具从未启动过（无对应气泡）则事件被前端静默忽略。

    与 time_traveler.py 的 undo_rounds() 使用同一模式（graph.aupdate_state）。
    注意必需传入 as_node="tools"，否则 aupdate_state 评估路由时会从 model 节点的
    model_to_tools 条件边走，检测到人造 ToolMessage 后返回 "model" 但该边目的地
    不含 "model" 导致 KeyError 使写入失败。
    """
    graph = session._graph
    if graph is None:
        return

    try:
        state = await graph.aget_state(config)
    except Exception:
        logger.debug("Failed to get graph state for cancel cleanup", exc_info=True)
        return  # checkpoint 不可读时静默跳过

    messages = state.values.get("messages", [])
    if not messages:
        return

    # 从后往前找最后一个 AIMessage
    last_ai = None
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], AIMessage):
            last_ai = messages[i]
            break

    if last_ai is None:
        return

    tool_calls = getattr(last_ai, "tool_calls", [])
    if not tool_calls:
        return

    # 收集其后所有 ToolMessage 的 tool_call_id 集合
    try:
        idx = messages.index(last_ai)
    except ValueError:
        return
    following = messages[idx + 1 :]

    tool_msg_ids = {m.tool_call_id for m in following if isinstance(m, ToolMessage)}

    orphaned = [tc for tc in tool_calls if tc["id"] not in tool_msg_ids]
    if not orphaned:
        return  # checkpoint 已一致

    # 通知前端：使运行的工具体进入错误状态
    for tc in orphaned:
        try:
            await ws.send_json(
                {
                    "type": "tool_error",
                    "payload": {
                        "tool_name": tc["name"],
                        "error": "用户取消了该工具调用",
                    },
                }
            )
        except Exception:
            logger.debug(
                "Failed to send tool_error via WebSocket (connection may be closed)",
                exc_info=True,
            )

    # 生成取消 ToolMessage 并写入 checkpoint
    cancel_msgs = []
    for tc in orphaned:
        cancel_msgs.append(
            ToolMessage(
                content=format_error("用户取消了该工具调用"),
                name=tc["name"],
                tool_call_id=tc["id"],
            )
        )
    try:
        await graph.aupdate_state(config, {"messages": cancel_msgs}, as_node="tools")
    except Exception as e:
        print(
            f"[cancel] aupdate_state failed: {type(e).__name__}: {e}", file=sys.stderr
        )
        raise


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
    graph,
    config: dict,
    episodic_mm,
    session_id: str,
    turn_id: str,
) -> None:
    """Best-effort 将一个成功的 chat turn 投影到情景记忆。

    调用发生在客户端收到 ``done`` 事件后。情景记忆故障因此不会改变
    已完成对话的结果；存储层以 ``(session_id, turn_id)`` 保证重试幂等。
    """
    if episodic_mm is None:
        return
    try:
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


async def _is_memory_eligible_turn(graph, config: dict) -> bool:
    """Read the graph's explicit model outcome before persisting a turn.

    Provider failures are intentionally rendered as helpful AI messages by the
    graph.  Their text is not a reliable persistence signal, particularly
    across locales and provider implementations, so only an explicit success
    marker allows automatic episodic/LTM projection.
    """
    try:
        state = await graph.aget_state(config)
        values = getattr(state, "values", {}) if state is not None else {}
        succeeded = values.get("llm_invocation_succeeded")
        if succeeded is True:
            return True
        if succeeded is False:
            logger.info("[memory] skipping failed model turn")
        else:
            logger.warning("[memory] skipping turn without model outcome metadata")
    except Exception:
        logger.warning(
            "[memory] skipping turn with unreadable model outcome", exc_info=True
        )
    return False


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
    ws_callback = WebSocketCallback(ws)  # WebUI 回调函数系统
    ws_callback.session_id = session.session_id  # 供 Activity Hub 记录使用
    ws_callback.turn_id = turn_id

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
    agent_maxma = build_agent(
        model=llm,
        tools=turn_tools,
        system_prompt=system_prompt,
        checkpointer=session.checkpointer,
        ws=ws,
        episodic_mm=episodic_mm,
        runtime_context=runtime_context_text,
        episodic_session_id=session.session_id,
    )
    session._graph = agent_maxma
    # project_ctx prepend 到 user_message（不修改 system_prompt，保持缓存稳定）
    if project_ctx:
        user_message_for_llm = f"[项目上下文]\n{project_ctx}\n\n---\n\n{user_message}"
    else:
        user_message_for_llm = user_message
    inputs = {"messages": [HumanMessage(content=user_message_for_llm)]}
    config = {
        "configurable": {"thread_id": session.session_id},
        "callbacks": [ws_callback],
        "recursion_limit": 120,
    }

    # 上下文窗口保护：当对话历史过长时自动截断，防止超出模型上下文限制
    from api.context_usage import count_tokens

    system_prompt_tokens = count_tokens(system_prompt)

    # 包装 ws.send_json 为符合 ws_callback 签名的异步回调
    async def _compress_ws_callback(msg: dict):
        await ws.send_json(msg)

    await maybe_trim_checkpoint(
        agent_maxma,
        config,
        llm=llm,
        ws_callback=_compress_ws_callback,
        token_counter=lambda msgs: (
            system_prompt_tokens
            + sum(
                count_tokens(
                    m.content if isinstance(m.content, str) else str(m.content)
                )
                + 4
                for m in msgs
            )
        ),
        max_tokens=current_max_tokens,
        cache_preserving=settings.cache_preserving_compaction_enabled,
    )

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
                final_answer = await _stream_turn(
                    agent_maxma,
                    inputs,
                    config,
                    ws,
                    session,
                    system_prompt,
                    model_name=current_model_name,
                    max_tokens=current_max_tokens,
                )
        else:
            final_answer = await _stream_turn(
                agent_maxma,
                inputs,
                config,
                ws,
                session,
                system_prompt,
                model_name=current_model_name,
                max_tokens=current_max_tokens,
            )
        # This records execution outcome, rather than inferring it from a
        # localized fallback/error string.  The graph writes the marker even
        # when it turns a provider failure into a user-facing AI message.
        turn_completed = await _is_memory_eligible_turn(agent_maxma, config)

        # 阶段 2.3：重规划失败 N 次后优雅降级通知
        # 当 plan 以降级状态完成（有步骤被跳过/失败）时，向前端推送 plan_degraded 事件
        # 让用户知道结果可能不完整，可考虑手动介入或重新提问
        try:
            await _maybe_notify_plan_degraded(agent_maxma, config, ws)
        except Exception:
            logger.debug(
                "[degraded] failed to notify plan degraded state", exc_info=True
            )

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

        # 修复 checkpoint：为孤立 tool_calls 注入取消 ToolMessage，并通知前端
        try:
            await _inject_cancel_tool_messages(session, config, ws)
        except Exception as e:
            logger.warning("[cancel] checkpoint cleanup error: %s", e)

        # 向 checkpoint 注入一条"被中断"的 AIMessage，确保前端 loadHistoryFromBackend
        # 能取到非空 finalAnswer，避免用户感知为"整轮对话被吞掉"。
        # 注意：必须用 as_node="agent" 写入，否则 aupdate_state 路由会出错。
        try:
            interrupt_msg = AIMessage(
                content="（回复已中断——可能因网络断开或切换页面。请重新提问以继续。）"
            )
            await agent_maxma.aupdate_state(
                config, {"messages": [interrupt_msg]}, as_node="agent"
            )
        except Exception as e:
            logger.warning("[cancel] failed to inject interrupt AIMessage: %s", e)

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

    # 3. [后处理] 增加消息计数器，将对话记录入长期记忆
    # 修复：此前仅在 final_answer 非空时 +=2，错误轮次仍写 checkpointer（至少写入 HumanMessage）
    # 但计数不增 → message_count 与 checkpointer 实际消息数漂移，导致：
    # 1) undo 端点 max(0, count - deleted) 计算错误
    # 2) const 会话 YAML metadata.message_count 不准，重启后显示错误
    if final_answer:
        session.message_count += 2  # human + ai
    else:
        # Agent 出错：graph.ainvoke 已把 HumanMessage 写入 checkpointer，但没有 AI 回复
        session.message_count += 1
    memory_eligible = turn_completed and bool(final_answer)
    if not private_mode and memory_eligible:
        if final_answer:
            await _project_completed_turn_to_episodic(
                graph=agent_maxma,
                config=config,
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
            cpt = await session.checkpointer.aget_tuple(
                {"configurable": {"thread_id": session.session_id}}
            )
            raw_messages = (
                cpt.checkpoint.get("channel_values", {}).get("messages", [])
                if cpt
                else []
            )
            metadata = session.persistent_metadata()
            serialized = serialize_messages(raw_messages)
            for item in reversed(serialized):
                if item.get("type") == "ai":
                    item["content"] = final_answer
                    break
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
                    from config.settings import get_settings

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
