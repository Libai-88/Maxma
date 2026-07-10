"""上下文窗口管理 — 滑动窗口截断与摘要。

本模块同时承载 4 层记忆架构中「短期记忆层（ShortTerm）」的职责：
- 滑动窗口截断与摘要（核心）
- ``commit_to_episodic``: 把当前 checkpoint 的摘要写入情景记忆层
- ``retrieve_from_episodic``: 按向量检索历史情景记忆
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Optional, Sequence

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, RemoveMessage, SystemMessage, ToolMessage

from api.context_usage import count_tokens

logger = logging.getLogger(__name__)

# 当上下文占比超过此阈值时触发截断
TRIM_THRESHOLD = 0.6

# 动态保留轮次参数
MIN_RECENT_TURNS_DEFAULT = 5
# 工具密集场景（平均每轮 3+ 工具调用）少保留
MIN_RECENT_TURNS_MIN = 3
# 纯文本场景多保留
MIN_RECENT_TURNS_MAX = 6


def truncate_text_head_tail(text: str, max_bytes: int = 4096) -> tuple[str, str]:
    """UTF-8 安全的 head+tail 硬截断。当压缩请求本身超窗时使用。"""
    encoded = text.encode('utf-8')
    if len(encoded) <= max_bytes:
        return text, ""
    # 保留前 1/3 和后 1/3
    head_size = max_bytes // 3
    tail_size = max_bytes - head_size - 20  # 留 20 字节给省略号
    # 找到不截断 UTF-8 多字节字符的安全位置
    head_bytes = encoded[:head_size]
    # 回退到最后一个完整字符
    while head_bytes and (head_bytes[-1] & 0xC0) == 0x80:
        head_bytes = head_bytes[:-1]
    # 如果回退后还是不完整，再回退一个字节
    if head_bytes:
        last = head_bytes[-1]
        if (last & 0xE0) == 0xC0 and len(head_bytes) < 2:
            head_bytes = head_bytes[:-1]
        elif (last & 0xF0) == 0xE0 and len(head_bytes) < 3:
            head_bytes = head_bytes[:-1]
        elif (last & 0xF8) == 0xF0 and len(head_bytes) < 4:
            head_bytes = head_bytes[:-1]

    tail_bytes = encoded[-tail_size:]
    # 跳过开头不完整的字符
    while tail_bytes and (tail_bytes[0] & 0xC0) == 0x80:
        tail_bytes = tail_bytes[1:]

    head = head_bytes.decode('utf-8', errors='ignore')
    tail = tail_bytes.decode('utf-8', errors='ignore')
    return head + "\n...(省略)...", "\n...(省略)...\n" + tail


def _calc_min_turns(messages: Sequence[BaseMessage]) -> int:
    """根据消息中 ToolMessage 的密度动态计算应保留的轮次数。

    工具调用密集时每条 turn 占用 token 多，少保留几轮；
    纯文本对话时每条 turn 轻量，多保留几轮。
    """
    total_turns = 0
    tool_count = 0
    for msg in messages:
        if isinstance(msg, HumanMessage):
            total_turns += 1
        elif isinstance(msg, ToolMessage):
            tool_count += 1

    if total_turns == 0:
        return MIN_RECENT_TURNS_DEFAULT

    avg_tools_per_turn = tool_count / total_turns
    if avg_tools_per_turn >= 3:
        return MIN_RECENT_TURNS_MIN
    elif avg_tools_per_turn >= 1:
        return MIN_RECENT_TURNS_DEFAULT
    else:
        return MIN_RECENT_TURNS_MAX


def _count_turns(messages: Sequence[BaseMessage]) -> int:
    """统计对话轮次数（一个 human + 后续 ai/tool 消息算一轮）。"""
    turns = 0
    for msg in messages:
        if isinstance(msg, HumanMessage):
            turns += 1
    return turns


def _find_trim_boundary(messages: Sequence[BaseMessage], min_turns: int) -> int:
    """找到截断边界：保留最近 min_turns 轮，返回截断点的索引。

    截断点一定在对话轮次边界上（HumanMessage 之前），
    不会切断一个 turn 的中间（避免丢失 tool_calls 对应的 ToolMessage）。
    """
    if len(messages) <= 1:
        return 0

    # 从后往前找，找到第 min_turns 个 HumanMessage 的位置
    human_count = 0
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            human_count += 1
            if human_count >= min_turns:
                return i
    return 0


# ── 实体提取（借鉴 Codex：被截断的消息中保留可重读的引用）────

_PATH_RE = re.compile(
    r"(?:[a-zA-Z]:[\\/]|[./~]|[\w.-]+/)[\w./\\-]+"
    r"(?:\.\w{1,5})?"  # 可选扩展名
)
_URL_RE = re.compile(r"https?://[^\s)>\]\"']+")


def _extract_entities(messages: Sequence[BaseMessage]) -> str:
    """从旧消息中提取文件路径、URL 等具体实体，作为"重读清单"。

    模型在后续对话中如果需要这些信息，可以用工具重新读取文件。
    """
    file_paths: set[str] = set()
    urls: set[str] = set()

    for msg in messages:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        if not content:
            continue

        # 提取文件路径（过滤掉太短或太像普通单词的匹配）
        for m in _PATH_RE.finditer(content):
            path = m.group(0).rstrip(".,;:!?")
            if len(path) > 4 and ("/" in path or "\\" in path):
                file_paths.add(path)

        # 提取 URL
        for m in _URL_RE.finditer(content):
            urls.add(m.group(0).rstrip(".,;:!?"))

    parts = []
    if file_paths:
        # 最多保留 20 个路径，避免过长
        sorted_paths = sorted(file_paths)[:20]
        parts.append("## 涉及的文件/路径\n" + "\n".join(f"- {p}" for p in sorted_paths))
    if urls:
        sorted_urls = sorted(urls)[:10]
        parts.append("## 涉及的 URL\n" + "\n".join(f"- {u}" for u in sorted_urls))

    return "\n\n".join(parts)


# ── 结构化摘要 prompt（借鉴 Claude Code compact 机制）────

_COMPACT_PROMPT = """请将以下对话历史压缩为一份结构化交接文档。

这不是普通摘要——这是后续对话的唯一上下文来源。必须保留具体实体（文件路径、函数名、人名、数值、配置项），不要模糊概括。

按以下格式输出：

## 当前任务状态
- 正在做的事：...
- 已完成的事：...
- 待办/阻塞项：...

## 关键实体
- 涉及的文件/路径：...（保留完整路径）
- 涉及的人名/术语：...
- 关键数值/配置：...

## 重要决策
- 决策内容（原因）

## 错误与解决
- 问题 → 解决方案

规则：
1. 每个具体实体（路径、名称、数值）必须原样保留，不要概括
2. 如果某个分类没有内容，直接跳过该分类
3. 摘要长度根据对话复杂度自适应：简单对话可以很短，复杂对话（>10轮或含大量工具调用）应更详细
4. 不要使用"用户讨论了..."这类叙述性语言，直接用结构化列表

对话历史：
{conversation}"""


def _summarize_old_messages(messages: Sequence[BaseMessage]) -> str:
    """将旧消息压缩为简短摘要文本（无 LLM 时的回退方案）。

    提取关键信息拼接：统计消息类型数量，保留最近用户消息摘要。
    同时追加实体提取结果作为"重读清单"。
    """
    summaries = []
    tool_count = 0
    ai_count = 0
    human_count = 0

    for msg in messages:
        if isinstance(msg, HumanMessage):
            human_count += 1
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            if len(content) > 100:
                content = content[:100] + "..."
            summaries.append(f"用户: {content}")
        elif isinstance(msg, AIMessage):
            ai_count += 1
        elif isinstance(msg, ToolMessage):
            tool_count += 1

    parts = []
    if human_count:
        parts.append(f"{human_count} 条用户消息")
    if ai_count:
        parts.append(f"{ai_count} 条 AI 回复")
    if tool_count:
        parts.append(f"{tool_count} 次工具调用")

    header = f"[历史对话摘要: {', '.join(parts)}]"

    result = header
    if summaries:
        recent = summaries[-3:]
        result = header + "\n" + "\n".join(recent)

    # 追加实体提取结果
    entities = _extract_entities(messages)
    if entities:
        result = f"{result}\n\n{entities}"

    return result


async def _llm_summarize(messages: Sequence[BaseMessage], llm, *, raise_on_error: bool = False) -> str:
    """使用 LLM 生成结构化交接文档式摘要（借鉴 Claude Code compact 机制）。

    特点：
    - 结构化模板：按任务状态、关键实体、决策、错误分类提取
    - 自适应长度：根据对话复杂度动态调整输入文本量
    - 实体保留：从旧消息中提取文件路径、URL 作为"重读清单"

    Args:
        messages: 待摘要的消息列表
        llm: LLM 实例
        raise_on_error: 为 True 时，LLM 调用失败将抛出异常（由调用方处理降级）；
            为 False（默认）时，内部回退到 ``_summarize_old_messages`` 提取式摘要。
    """
    # 自适应：根据消息数量调整每条消息截取长度
    msg_count = len(messages)
    if msg_count > 30:
        per_msg_limit = 100
    elif msg_count > 15:
        per_msg_limit = 200
    else:
        per_msg_limit = 400

    # 构造对话文本（过滤工具输出，避免幻觉）
    conversation_parts = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            conversation_parts.append(f"用户: {content[:per_msg_limit]}")
        elif isinstance(msg, AIMessage):
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            if content:
                conversation_parts.append(f"助手: {content[:per_msg_limit]}")

    if not conversation_parts:
        return _summarize_old_messages(messages)

    conversation_text = "\n".join(conversation_parts)

    try:
        from langchain_core.messages import HumanMessage as HM

        prompt = _COMPACT_PROMPT.format(conversation=conversation_text)
        response = await llm.ainvoke([HM(content=prompt)])
        summary = response.content if isinstance(response.content, str) else str(response.content)

        # 追加实体提取结果作为"重读清单"
        entities = _extract_entities(messages)
        if entities:
            summary = f"{summary.strip()}\n\n{entities}"

        return summary.strip()
    except Exception as e:
        logger.warning(f"LLM summarization failed, falling back to extraction: {e}")
        if raise_on_error:
            raise
        return _summarize_old_messages(messages)


def should_trim_context(
    messages: Sequence[BaseMessage],
    system_prompt_tokens: int,
    max_tokens: int,
) -> bool:
    """判断是否需要截断上下文。

    Args:
        messages: 当前对话消息列表
        system_prompt_tokens: 系统提示词占用的 token 数
        max_tokens: 模型上下文窗口上限

    Returns:
        True 如果当前上下文占比超过阈值且对话轮次足够多
    """
    min_turns = _calc_min_turns(messages)
    if len(messages) < min_turns * 2:
        return False

    # 估算当前 token 使用
    total_tokens = system_prompt_tokens
    for msg in messages:
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        total_tokens += count_tokens(content) + 4  # 格式化开销

    usage_ratio = total_tokens / max_tokens if max_tokens else 0
    return usage_ratio > TRIM_THRESHOLD


def trim_messages(
    messages: Sequence[BaseMessage],
    system_prompt_tokens: int,
    max_tokens: int,
) -> list[BaseMessage]:
    """截断消息列表，保留最近的对话轮次，旧消息替换为摘要。

    Args:
        messages: 原始消息列表
        system_prompt_tokens: 系统提示词 token 数
        max_tokens: 模型上下文窗口上限

    Returns:
        截断后的消息列表（可能包含一条摘要消息在开头）
    """
    if not should_trim_context(messages, system_prompt_tokens, max_tokens):
        return list(messages)

    min_turns = _calc_min_turns(messages)
    boundary = _find_trim_boundary(messages, min_turns)
    if boundary == 0:
        return list(messages)

    old_messages = messages[:boundary]
    kept_messages = messages[boundary:]

    # 生成旧消息摘要（回退到提取式）
    summary_text = _summarize_old_messages(old_messages)

    # 构造截断后的消息列表
    result: list[BaseMessage] = []

    # 保留开头的 SystemMessage（如果有）
    if kept_messages and isinstance(kept_messages[0], SystemMessage):
        result.append(kept_messages[0])
        kept_messages = kept_messages[1:]

    # 插入摘要作为 SystemMessage
    if summary_text:
        result.append(SystemMessage(content=f"[上下文压缩] {summary_text}"))

    result.extend(kept_messages)

    logger.info(
        f"Context trimmed: {len(old_messages)} messages → summary, "
        f"kept {len(kept_messages)} recent messages"
    )

    return result


async def maybe_trim_checkpoint(
    state,
    config: dict,
    *,
    llm=None,
    checkpointer=None,
    ws_callback=None,
    token_counter=None,
    max_tokens=None,
) -> dict:
    """检查 checkpoint 中的消息是否需要截断，如需则更新（cache-preserving 版本）。

    保留 SystemMessage 作为静态前缀（保护 prompt cache），
    只对动态消息（Human/AI/Tool）执行截断和摘要。

    Args:
        state: 状态 dict，至少包含 ``messages`` 键；也可传入 LangGraph
            agent（具有 ``aget_state``），此时会自动拉取 state 并将其作为
            checkpointer。
        config: LangGraph config (含 thread_id)
        llm: 可选 LLM 实例，用于生成高质量摘要
        checkpointer: 可选 LangGraph compiled agent，用于更新 checkpoint 状态
        ws_callback: 可选 WS 回调协程，签名 ``async def(msg: dict) -> None``，
            压缩成功时用于推送 ``context_compressed`` 事件
        token_counter: 可选的 token 计数函数，签名 ``f(messages) -> int``
        max_tokens: 模型上下文窗口上限

    Returns:
        dict，至少包含 ``"compressed"`` 字段；压缩成功时附带
        ``messages``/``removed_count``/``summary_preview``/
        ``context_usage_before``/``context_usage_after`` 等详情
    """
    try:
        # 向后兼容：如果传入的是 LangGraph agent，自动拉取 state
        if hasattr(state, "aget_state"):
            if checkpointer is None:
                checkpointer = state
            state_obj = await state.aget_state(config)
            if state_obj is None:
                return {"compressed": False}
            messages = state_obj.values.get("messages", [])
        else:
            messages = state.get("messages", []) if hasattr(state, "get") else []

        if not messages:
            return {"compressed": False}

        # 判断是否需要截断
        if token_counter is None or not max_tokens:
            return {"compressed": False}

        total_tokens = token_counter(messages)
        usage_ratio_before = total_tokens / max_tokens if max_tokens else 0
        if usage_ratio_before <= TRIM_THRESHOLD:
            return {"compressed": False}

        # 分离静态前缀（SystemMessage）和动态消息，保护 prompt cache 前缀
        static_prefix: list[BaseMessage] = []
        dynamic_messages: list[BaseMessage] = []
        for m in messages:
            if isinstance(m, SystemMessage):
                static_prefix.append(m)
            else:
                dynamic_messages.append(m)

        if not dynamic_messages:
            return {"compressed": False, "reason": "no dynamic messages"}

        # 计算保留轮次，但不强制要求消息数达到 min_turns*2 —— 当 token
        # 占比已超阈值时（由调用方通过 token_counter 判定），即使消息
        # 较少也应压缩。只需保证至少有 2 轮（1 轮压缩 + 1 轮保留）。
        actual_turns = _count_turns(dynamic_messages)
        if actual_turns < 2:
            return {"compressed": False}

        min_turns = _calc_min_turns(dynamic_messages)
        # 确保 min_turns 不超过 actual_turns-1，以便总能找到截断边界
        min_turns = min(min_turns, max(1, actual_turns - 1))

        boundary = _find_trim_boundary(dynamic_messages, min_turns)
        if boundary == 0:
            return {"compressed": False}

        old_messages = dynamic_messages[:boundary]
        retained_messages = dynamic_messages[boundary:]

        # 使用 LLM 摘要（如果可用）；LLM 失败时降级为 head+tail 硬截断
        compaction_fallback = None
        if llm is not None:
            try:
                summary_text = await _llm_summarize(old_messages, llm, raise_on_error=True)
            except Exception as e:
                logger.warning(
                    f"LLM summary failed, falling back to hard truncation: {e}"
                )
                # 降级：把较早的动态消息拼成文本做 head+tail 硬截断
                old_text = "\n\n".join(
                    (m.content if isinstance(m.content, str) else str(m.content))
                    for m in old_messages
                )
                head, tail = truncate_text_head_tail(old_text, max_bytes=4096)
                summary_text = f"[会话历史摘要-降级]\n{head}\n{tail}"
                compaction_fallback = "hard_truncation"
        else:
            summary_text = _summarize_old_messages(old_messages)

        if not summary_text:
            return {"compressed": False}

        # 追加文件操作上下文（保留本次会话操作过哪些文件的元信息）
        file_ops = extract_file_operations(dynamic_messages)
        if file_ops:
            summary_text = append_file_ops_to_summary(summary_text, file_ops)

        # 构造摘要消息
        summary_message = SystemMessage(content=f"[上下文压缩] {summary_text}")

        # 重组：静态前缀 + 摘要 + 保留的近期消息
        new_messages = static_prefix + [summary_message] + retained_messages

        # 更新 checkpointer（如果提供）
        if checkpointer is not None:
            update_msgs: list[BaseMessage] = []
            for msg in old_messages:
                msg_id = getattr(msg, "id", None)
                if msg_id:
                    update_msgs.append(RemoveMessage(id=msg_id))
            update_msgs.append(summary_message)

            await checkpointer.aupdate_state(
                config,
                {"messages": update_msgs},
            )
            logger.info(
                f"Checkpoint trimmed for thread {config.get('configurable', {}).get('thread_id', '?')}: "
                f"{len(old_messages)} dynamic messages removed, summary added"
            )

        # 估算压缩后上下文占比
        after_tokens = token_counter(new_messages)
        usage_ratio_after = after_tokens / max_tokens if max_tokens else 0

        # 构建压缩详情
        compress_detail = {
            "compressed": True,
            "messages": new_messages,
            "removed_count": len(old_messages),
            "summary_preview": summary_text[:200] if summary_text else "",
            "context_usage_before": usage_ratio_before,
            "context_usage_after": usage_ratio_after,
        }
        if compaction_fallback:
            compress_detail["compaction_fallback"] = compaction_fallback

        # 通过 WS 回调推送压缩事件（推送失败不影响压缩结果）
        if ws_callback:
            try:
                await ws_callback({
                    "type": "context_compressed",
                    "payload": {
                        "compressed": True,
                        "removed_count": len(old_messages),
                        "summary_preview": summary_text[:200] if summary_text else "",
                        "context_usage_before": usage_ratio_before,
                        "context_usage_after": usage_ratio_after,
                    },
                })
            except Exception:
                logger.debug("ws_callback push context_compressed failed", exc_info=True)

        # 记录到 Activity Hub（失败不影响压缩结果）
        try:
            from api.activity_hub import activity_hub
            activity_hub.add(
                category="compression",
                event_type="context_compressed",
                session_id=config.get("configurable", {}).get("thread_id", ""),
                message=f"上下文压缩：移除 {len(old_messages)} 条消息",
                payload={
                    "removed_count": len(old_messages),
                    "summary_preview": summary_text[:200] if summary_text else "",
                },
            )
        except Exception:
            logger.debug("activity_hub record context_compressed failed", exc_info=True)

        return compress_detail

    except Exception as e:
        logger.warning(f"Failed to trim checkpoint: {e}", exc_info=True)
        return {"compressed": False}


# ── 4 层记忆架构：情景记忆层接口 ──────────────────────────────


async def commit_to_episodic(
    graph,
    config: dict,
    episodic_mm,
    *,
    session_id: str = "",
    turn_id: str = "",
    llm=None,
) -> Optional[str]:
    """把当前 checkpoint 的对话摘要写入情景记忆层。

    在对话轮次结束时调用：从 checkpoint 取出当前消息列表，
    生成简短摘要后写入 ``EpisodicMemoryManager``。若 ``llm`` 可用则使用 LLM
    生成摘要，否则回退到 ``_summarize_old_messages`` 提取式摘要。

    Args:
        graph: LangGraph compiled agent
        config: LangGraph config（含 thread_id）
        episodic_mm: EpisodicMemoryManager 实例
        session_id: 会话 ID（可选）
        turn_id: 轮次 ID（可选）
        llm: 可选 LLM 实例，用于生成高质量摘要

    Returns:
        新建的 episode ID；失败时返回 None
    """
    if episodic_mm is None:
        return None
    try:
        state = await graph.aget_state(config)
        if state is None:
            return None
        messages = state.values.get("messages", [])
        if not messages:
            return None

        # 生成摘要
        if llm is not None:
            summary_text = await _llm_summarize(messages, llm)
        else:
            summary_text = _summarize_old_messages(messages)

        if not summary_text:
            return None

        # 统计消息数
        message_count = len(messages)

        episode_id = episodic_mm.add_episode(
            summary=summary_text,
            session_id=session_id,
            turn_id=turn_id,
            message_count=message_count,
        )
        logger.info(
            "[episodic] committed episode %s for session=%s turn=%s thread=%s (%d messages)",
            episode_id,
            session_id or "?",
            turn_id or "?",
            config.get("configurable", {}).get("thread_id", "?"),
            message_count,
        )
        return episode_id
    except Exception as e:
        logger.warning(
            "[episodic] commit failed for session=%s turn=%s: %s",
            session_id or "?",
            turn_id or "?",
            e,
            exc_info=True,
        )
        return None


def retrieve_from_episodic(
    query: str,
    episodic_mm,
    top_k: int = 3,
    *,
    session_id: str = "",
    include_cross_session: bool = False,
) -> str:
    """按向量检索历史情景记忆，返回可读文本（供注入系统提示词）。

    Args:
        query: 检索查询文本（通常是用户最近一条消息）
        episodic_mm: EpisodicMemoryManager 实例
        top_k: 返回的最大结果数
        session_id: 当前会话 ID。自动注入必须提供该值。
        include_cross_session: 仅供有意的手动历史查询使用；默认 False。

    Returns:
        格式化的情景记忆文本；若无结果返回空字符串
    """
    if episodic_mm is None or not query:
        return ""
    if not session_id and not include_cross_session:
        logger.warning("[episodic] refusing unscoped automatic retrieval")
        return ""
    try:
        results = episodic_mm.retrieve(
            query=query,
            top_k=top_k,
            session_id=None if include_cross_session else session_id,
        )
        if not results:
            return ""
        lines = ["## 相关历史对话"]
        for item in results:
            lines.append(
                f"- [{item.get('timestamp', '')}] "
                f"{item.get('summary', '')} "
                f"(相似度 {item.get('similarity', 0):.0%})"
            )
        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"[episodic] retrieve_from_episodic failed: {e}")
        return ""


# ── Fresh Compact：显式刷新（避免累积摘要信息损失）──────────────


async def fresh_compact(
    *,
    thread_id: str,
    llm,
    checkpointer,
    ws_callback=None,
) -> dict:
    """显式刷新：从 checkpointer 读取原始消息，重新生成摘要。

    与 maybe_trim_checkpoint 的累积压缩不同，fresh_compact 总是从
    原始消息重新生成摘要，避免累积信息损失。

    触发场景：
    1. 用户主动点击"刷新上下文"
    2. 检测到摘要被引用超过 N 次（信息损失累积）
    3. 用户明确切换话题
    """
    if checkpointer is None:
        return {"refreshed": False, "reason": "no checkpointer"}

    try:
        tuple_data = await checkpointer.aget_tuple(
            {"configurable": {"thread_id": thread_id}}
        )
    except Exception as e:
        logger.error(f"fresh_compact: failed to get tuple: {e}")
        return {"refreshed": False, "reason": f"checkpointer error: {e}"}

    if tuple_data is None:
        return {"refreshed": False, "reason": "no checkpoint found"}

    messages = tuple_data.checkpoint.get("messages", [])
    if not messages:
        return {"refreshed": False, "reason": "no messages"}

    # 分离 SystemMessage
    static_prefix = [m for m in messages if isinstance(m, SystemMessage)]
    dynamic = [m for m in messages if not isinstance(m, SystemMessage)]

    if len(dynamic) < 4:
        return {"refreshed": False, "reason": "too few messages to compact"}

    # 从原始动态消息生成摘要（不依赖旧摘要）
    # 保留最近 6 条不压缩
    to_compress = dynamic[:-6]
    retain = dynamic[-6:]

    summary_prompt = _build_summary_prompt(to_compress)
    try:
        from langchain_core.messages import HumanMessage as _HM
        response = await llm.ainvoke([_HM(content=summary_prompt)])
        summary_text = response.content if hasattr(response, 'content') else str(response)
        if not isinstance(summary_text, str):
            summary_text = str(summary_text)
    except Exception as e:
        logger.warning(f"fresh_compact: LLM failed, using hard truncation: {e}")
        old_text = "\n\n".join(
            (m.content if isinstance(m.content, str) else str(m.content))
            for m in to_compress
        )
        head, tail = truncate_text_head_tail(old_text, max_bytes=4096)
        summary_text = f"{head}\n{tail}"

    summary_msg = HumanMessage(content=f"[会话历史摘要-刷新]\n{summary_text}")
    new_messages = static_prefix + [summary_msg] + retain

    # 写回 checkpointer
    try:
        await checkpointer.aput(
            {"configurable": {"thread_id": thread_id}},
            {"messages": new_messages},
            {"source": "fresh_compact"},
        )
    except Exception as e:
        logger.error(f"fresh_compact: failed to write back: {e}")
        return {"refreshed": False, "reason": f"write back failed: {e}"}

    if ws_callback:
        try:
            await ws_callback({
                "type": "context_refreshed",
                "retained_count": len(retain),
                "summary_length": len(summary_text),
            })
        except Exception:
            pass

    return {
        "refreshed": True,
        "new_message_count": len(new_messages),
        "summary_length": len(summary_text),
    }


def _build_summary_prompt(messages) -> str:
    """构建摘要 prompt（引导 LLM 输出 5 段结构化格式）。"""
    lines = ["请总结以下对话，输出格式必须为：\n"]
    lines.append("## Goal")
    lines.append("<本次会话的核心目标>")
    lines.append("")
    lines.append("## Constraints")
    lines.append("- <约束1>")
    lines.append("- <约束2>")
    lines.append("")
    lines.append("## Progress")
    lines.append("- <已完成的进展>")
    lines.append("")
    lines.append("## Key Decisions")
    lines.append("- <关键决策>")
    lines.append("")
    lines.append("## Next Steps")
    lines.append("- <下一步>")
    lines.append("")
    lines.append("对话内容：\n")
    for m in messages:
        role = getattr(m, 'type', 'unknown')
        content = m.content if isinstance(m.content, str) else str(m.content)
        lines.append(f"[{role}] {content[:500]}")
    return "\n".join(lines)


# ── 文件操作上下文提取（压缩时保留文件操作元信息）──────────────


def extract_file_operations(messages: list) -> list[dict[str, str]]:
    """从消息列表中提取文件操作上下文（去重）。

    扫描所有 tool_call，识别 file_read / file_write / file_edit / file_delete，
    提取 path 和操作类型。相同 (path, op) 只保留一条。
    """
    FILE_TOOLS_OP_MAP = {
        "file_read": "read",
        "file_write": "write",
        "file_edit": "edit",
        "file_delete": "delete",
        "tool_file_read": "read",
        "tool_file_write": "write",
        "tool_file_edit": "edit",
    }

    seen: set[tuple[str, str]] = set()
    ops: list[dict[str, str]] = []

    for m in messages:
        tool_calls = getattr(m, 'tool_calls', None) or []
        if not tool_calls:
            continue
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            name = tc.get('name', '')
            args = tc.get('args', {}) or {}
            if name not in FILE_TOOLS_OP_MAP:
                continue
            path = args.get('path') or args.get('file_path') or ''
            if not path:
                continue
            op = FILE_TOOLS_OP_MAP[name]
            key = (path, op)
            if key in seen:
                continue
            seen.add(key)
            ops.append({"path": path, "op": op})

    return ops


def append_file_ops_to_summary(summary: str, file_ops: list[dict[str, str]]) -> str:
    """将文件操作上下文追加到摘要末尾。"""
    if not file_ops:
        return summary

    OP_LABEL = {
        "read": "读取",
        "write": "写入",
        "edit": "编辑",
        "delete": "删除",
    }

    lines = [summary, "", "## 本次会话文件操作"]
    for op in file_ops:
        label = OP_LABEL.get(op["op"], op["op"])
        lines.append(f"- {label}: {op['path']}")

    return "\n".join(lines)


# ── 结构化摘要格式（5 段固定格式）──────────────────────────────


@dataclass
class StructuredSummary:
    """结构化会话摘要（5 段固定格式）。"""
    goal: str = ""
    constraints: list[str] = field(default_factory=list)
    progress: list[str] = field(default_factory=list)
    key_decisions: list[str] = field(default_factory=list)
    next_steps: list[str] = field(default_factory=list)


def format_structured_summary(summary: StructuredSummary) -> str:
    """格式化结构化摘要为文本。"""
    lines: list[str] = []

    lines.append("## Goal")
    lines.append(summary.goal or "(未明确)")
    lines.append("")

    lines.append("## Constraints")
    if summary.constraints:
        for c in summary.constraints:
            lines.append(f"- {c}")
    else:
        lines.append("(无)")
    lines.append("")

    lines.append("## Progress")
    if summary.progress:
        for p in summary.progress:
            lines.append(f"- {p}")
    else:
        lines.append("(无)")
    lines.append("")

    lines.append("## Key Decisions")
    if summary.key_decisions:
        for d in summary.key_decisions:
            lines.append(f"- {d}")
    else:
        lines.append("(无)")
    lines.append("")

    lines.append("## Next Steps")
    if summary.next_steps:
        for s in summary.next_steps:
            lines.append(f"- {s}")
    else:
        lines.append("(无)")

    return "\n".join(lines)


_SECTION_PATTERN = re.compile(
    r'##\s*(?:Goal|目标)\s*\n(.*?)\n\s*##\s*(?:Constraints|约束)\s*\n(.*?)\n\s*##\s*(?:Progress|进展)\s*\n(.*?)\n\s*##\s*(?:Key Decisions|关键决策)\s*\n(.*?)\n\s*##\s*(?:Next Steps|下一步)\s*\n(.*?)(?=\n##\s|$)',
    re.DOTALL
)


def _parse_bullet_section(text: str) -> list[str]:
    """解析 bullet 列表段。"""
    items: list[str] = []
    for line in text.strip().split('\n'):
        line = line.strip()
        if line.startswith('- '):
            items.append(line[2:].strip())
        elif line and line not in ('(无)', '(未明确)'):
            items.append(line)
    return items


def parse_structured_summary(text: str) -> StructuredSummary:
    """解析结构化摘要文本。"""
    match = _SECTION_PATTERN.search(text)
    if not match:
        # 尝试宽松匹配
        return StructuredSummary(goal=text[:200] if text else "")

    goal_raw, constraints_raw, progress_raw, decisions_raw, next_raw = match.groups()

    goal = goal_raw.strip()
    if goal in ('(未明确)', '(无)'):
        goal = ""

    return StructuredSummary(
        goal=goal,
        constraints=_parse_bullet_section(constraints_raw),
        progress=_parse_bullet_section(progress_raw),
        key_decisions=_parse_bullet_section(decisions_raw),
        next_steps=_parse_bullet_section(next_raw),
    )
