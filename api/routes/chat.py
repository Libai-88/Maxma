"""WebSocket 端点 — 流式 Agent 对话，含取消、用户交互和多轮上下文。"""

import asyncio
import json
import sys
import logging
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent.graph import build_agent
from agent.prompts import build_system_prompt, get_system_prompt_parts
from agent.context_manager import maybe_trim_checkpoint
from api import interaction
from api.callbacks.websocket_callback import WebSocketCallback
from api.const_session_store import save_const_session, serialize_messages
from api.context_usage import estimate_context_usage
from api.errors import ErrorCode, format_ws_error
from api.session_manager import SessionState
from tools import select_tools_for_query
from tools.base import format_error
from tools.path_security import check_path_access

logger = logging.getLogger(__name__)

router = APIRouter()

_LOCAL_REF_PREFIX = "local:"


def _get_provider_context(app_state) -> tuple[int, str]:
    """从 ProviderManager 获取默认 context_window 和 model_name。"""
    mgr = getattr(app_state, "provider_manager", None)
    if mgr is not None and mgr.count > 0:
        for provider in mgr.iter_enabled():
            return provider.config.context_window, provider.default_model
    return 256_000, ""


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

    refs_json = user_message[refs_start + len("__refs__"):refs_end]
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
        path_text = path_text[len(_LOCAL_REF_PREFIX):].strip()
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
                    {"type": "text", "text": "请简洁描述这张图片的主要内容，包括关键元素、场景和文字（如果有）。控制在 100 字以内。"},
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
            if hasattr(msg, 'type') and msg.type == 'ai':
                content = msg.content if hasattr(msg, 'content') else str(msg)
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
            logger.debug("Failed to read fallback final_answer from checkpoint", exc_info=True)
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
        logger.debug("Failed to read checkpoint for context usage estimation", exc_info=True)
        counting_messages = []

    return estimate_context_usage(
        messages=counting_messages,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
        model_name=model_name,
        system_prompt_parts=get_system_prompt_parts(),
    )


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
            logger.debug("Failed to send tool_error via WebSocket (connection may be closed)", exc_info=True)

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
_PATH_PATTERN = _re.compile(
    r"(?:[A-Za-z]:[\\/]|[\\/])(?:[\w .\-]+[\\/])*[\w .\-]+"
)


def _detect_project_path(message: str) -> str | None:
    """从用户消息中提取可能的项目根目录路径。"""
    matches = _PATH_PATTERN.findall(message)
    for m in matches:
        p = m.rstrip("\\/").rstrip()
        # 检查是否是目录
        from pathlib import Path as _Path
        if _Path(p).is_dir():
            # 检查是否像项目根目录（含 .git 或 package.json 或 pyproject.toml 等）
            markers = [".git", "package.json", "pyproject.toml", "Cargo.toml",
                       "go.mod", "requirements.txt", "setup.py"]
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


async def _run_agent_turn(
    ws: WebSocket,
    session: SessionState,
    user_message: str,
    private_mode: bool = False,
    auto_approve: bool = False,
    provider_id: str | None = None,
    model_name: str | None = None,
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
    session.auto_approve = auto_approve
    interaction.current_session_id.set(session.session_id)
    ws_callback = WebSocketCallback(ws)  # WebUI 回调函数系统

    # ── 多模态：自动描述用户附带的图片 ──────────────────────────
    user_message = await _process_image_refs(user_message)
    # ────────────────────────────────────────────────────────────

    # 获取默认上下文窗口大小和模型名（一次性解构，避免重复调用）
    default_max_tokens, fallback_model_name = _get_provider_context(app_state)

    # 动态 LLM 选择（Phase 2：每次消息独立指定提供商/模型）
    current_max_tokens = default_max_tokens
    if provider_id and model_name and hasattr(app_state, "provider_manager"):
        try:
            provider = app_state.provider_manager.get(provider_id)
            llm = provider.create_llm(model_name, temperature=0.7, streaming=True)
            current_model_name = model_name
            current_max_tokens = provider.config.context_window
        except KeyError:
            logger.warning(
                "[chat:%s] requested provider/model fallback: provider_id=%r model=%r not found; "
                "using default provider/model=%r",
                session.session_id[:8],
                provider_id,
                model_name,
                fallback_model_name or "<unknown>",
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

    if llm is None:
        await ws.send_json(
            format_ws_error(
                ErrorCode.NO_LLM,
                "No LLM provider configured. Add one in Model Settings first.",
            )
        )
        return

    system_prompt = build_system_prompt()

    # ── 项目上下文自动感知 ──────────────────────────────────────
    project_ctx = _get_project_context(session, user_message)
    if project_ctx:
        system_prompt = system_prompt + "\n\n" + project_ctx
    # ────────────────────────────────────────────────────────────

    # 动态工具过滤：根据用户消息选择相关工具子集，减少 token 消耗
    # 追加 MCP 工具，确保外部工具始终可用（只构建一次 Agent 图）
    mcp_tools = getattr(ws.app.state, "mcp_tools", None) or []
    turn_tools = select_tools_for_query(user_message, mcp_tools=list(mcp_tools))
    agent_maxma = build_agent(
        model=llm,
        tools=turn_tools,
        system_prompt=system_prompt,
        checkpointer=session.checkpointer,
        ws=ws,
    )
    session._graph = agent_maxma
    inputs = {"messages": [HumanMessage(content=user_message)]}
    config = {
        "configurable": {"thread_id": session.session_id},
        "callbacks": [ws_callback],
        "recursion_limit": 120,
    }

    # 上下文窗口保护：当对话历史过长时自动截断，防止超出模型上下文限制
    from api.context_usage import count_tokens
    system_prompt_tokens = count_tokens(system_prompt)
    await maybe_trim_checkpoint(
        agent_maxma, config, system_prompt_tokens, current_max_tokens, llm=llm
    )

    # 2. [执行轮次] 流式执行 Agent 图，副作用推送最终回答，另有config回调副作用
    final_answer = ""
    _run_error: str | None = None
    try:
        # turn 开始时推送当前上下文用量（含刚加入的 user message）
        initial_turn_usage = await _calculate_context_usage(
            session,
            system_prompt,
            max_tokens=current_max_tokens,
            model_name=current_model_name or "",
        )
        await ws.send_json({"type": "context_usage", "payload": initial_turn_usage})

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
        interaction.cancel_session(session.session_id)

        # 修复 checkpoint：为孤立 tool_calls 注入取消 ToolMessage，并通知前端
        try:
            await _inject_cancel_tool_messages(session, config, ws)
        except Exception as e:
            print(f"[cancel] checkpoint cleanup error: {e}", file=sys.stderr)

        await ws.send_json(
            format_ws_error(ErrorCode.CANCELLED, "生成已取消")
        )
    except Exception as e:
        # 清理可能挂起的用户交互 Future，防止阻塞后续交互
        interaction.cancel_session(session.session_id, "Agent 执行出错，交互已取消")
        _run_error = str(e)
        trace_id = uuid.uuid4().hex[:8]
        logger.error(
            f"[sub-agent:{session.session_id[:8]}] _run_agent_turn error: {e}",
            exc_info=True,
            extra={"trace_id": trace_id},
        )
        await ws.send_json(
            format_ws_error(
                ErrorCode.AGENT_ERROR,
                f"Agent 执行出错: {str(e)[:200]}",
                trace_id=trace_id,
            )
        )
    finally:
        if session._active_task is current_task:
            session._active_task = None
        context_usage = await _calculate_context_usage(
            session,
            system_prompt,
            max_tokens=current_max_tokens,
            model_name=current_model_name or "",
        )
        turn_id = uuid.uuid4().hex
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
    if final_answer:
        session.message_count += 2
    if not private_mode:
        # 增量发送：只传本轮消息给记忆消费者，避免每轮重复处理全量历史
        messages_for_memory = [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": final_answer},
        ]
        logger.info("[ltm] calling send_history, messages=%d (incremental)", len(messages_for_memory))
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
            metadata = {
                "created_at": session.created_at,
                "last_active": session.last_active,
                "message_count": session.message_count,
            }
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


async def _resume_sub_agent(ws: WebSocket, session: SessionState) -> asyncio.Task | None:
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
            msg = json.loads(raw)
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

                    auto_approve = payload.get("auto_approve", False)
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
                        )
                    )
                    session._active_task = agent_task  # 供外部 REST 接口查询活跃状态

                case "user_response":
                    payload = msg.get("payload", {})
                    interaction_id = payload.get("interaction_id", "")
                    response = payload.get("response", "")
                    if interaction_id:
                        interaction.resolve(interaction_id, response)

                case "plan_response":
                    payload = msg.get("payload", {})
                    plan_id = payload.get("plan_id", "")
                    action = payload.get("action", "")
                    modified_plan = payload.get("modified_plan", "")
                    if plan_id:
                        if action == "approve":
                            interaction.resolve(plan_id, "approve")
                        elif action == "reject":
                            interaction.resolve(plan_id, "reject")
                        elif action == "modify" and modified_plan:
                            interaction.resolve(plan_id, modified_plan)
                        else:
                            interaction.resolve(plan_id, "reject")

                case "cancel":
                    if agent_task and not agent_task.done():
                        agent_task.cancel()
                        agent_task = None

                case "update_auto_approve":
                    payload = msg.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    auto_approve_val = payload.get("auto_approve", False)
                    interaction.set_session_auto_approve(
                        session_id, auto_approve_val
                    )
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
