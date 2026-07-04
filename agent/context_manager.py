"""上下文窗口管理 — 滑动窗口截断与摘要。

本模块同时承载 4 层记忆架构中「短期记忆层（ShortTerm）」的职责：
- 滑动窗口截断与摘要（核心）
- ``commit_to_episodic``: 把当前 checkpoint 的摘要写入情景记忆层
- ``retrieve_from_episodic``: 按向量检索历史情景记忆
"""

import logging
import re
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


async def _llm_summarize(messages: Sequence[BaseMessage], llm) -> str:
    """使用 LLM 生成结构化交接文档式摘要（借鉴 Claude Code compact 机制）。

    特点：
    - 结构化模板：按任务状态、关键实体、决策、错误分类提取
    - 自适应长度：根据对话复杂度动态调整输入文本量
    - 实体保留：从旧消息中提取文件路径、URL 作为"重读清单"
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
    graph,
    config: dict,
    system_prompt_tokens: int,
    max_tokens: int,
    llm=None,
) -> bool:
    """检查 checkpoint 中的消息是否需要截断，如需则更新。

    Args:
        graph: LangGraph compiled agent
        config: LangGraph config (含 thread_id)
        system_prompt_tokens: 系统提示词 token 数
        max_tokens: 模型上下文窗口上限
        llm: 可选 LLM 实例，用于生成高质量摘要

    Returns:
        True 如果执行了截断
    """
    try:
        state = await graph.aget_state(config)
        if state is None:
            return False

        messages = state.values.get("messages", [])
        if not messages:
            return False

        if not should_trim_context(messages, system_prompt_tokens, max_tokens):
            return False

        min_turns = _calc_min_turns(messages)
        boundary = _find_trim_boundary(messages, min_turns)
        if boundary == 0:
            return False

        old_messages = messages[:boundary]
        kept_messages = messages[boundary:]

        # 增量摘要：提取旧消息中已有的压缩摘要，合并到新摘要中
        prev_summary_parts = []
        for msg in old_messages:
            if isinstance(msg, SystemMessage):
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                if content.startswith("[上下文压缩]"):
                    prev_summary_parts.append(content)

        # 使用 LLM 摘要（如果可用）或回退到提取式
        if llm is not None:
            summary_text = await _llm_summarize(old_messages, llm)
        else:
            summary_text = _summarize_old_messages(old_messages)

        # 如果有旧摘要，合并到当前摘要前面
        if prev_summary_parts:
            prev_text = "\n".join(prev_summary_parts)
            summary_text = f"{prev_text}\n{summary_text}"

        # 构造删除操作：为旧消息生成 RemoveMessage，并加上摘要
        update_msgs: list[BaseMessage] = []
        for msg in old_messages:
            msg_id = getattr(msg, "id", None)
            if msg_id:
                update_msgs.append(RemoveMessage(id=msg_id))

        if summary_text:
            update_msgs.append(SystemMessage(content=f"[上下文压缩] {summary_text}"))

        if not update_msgs:
            return False

        await graph.aupdate_state(
            config,
            {"messages": update_msgs},
        )
        logger.info(
            f"Checkpoint trimmed for thread {config.get('configurable', {}).get('thread_id', '?')}: "
            f"{len(messages)} → {len(old_messages)} removed, summary added"
        )
        return True

    except Exception as e:
        logger.warning(f"Failed to trim checkpoint: {e}", exc_info=True)
        return False


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
            "[episodic] committed episode %s for thread %s (%d messages)",
            episode_id,
            config.get("configurable", {}).get("thread_id", "?"),
            message_count,
        )
        return episode_id
    except Exception as e:
        logger.warning(f"[episodic] commit_to_episodic failed: {e}", exc_info=True)
        return None


def retrieve_from_episodic(
    query: str,
    episodic_mm,
    top_k: int = 3,
) -> str:
    """按向量检索历史情景记忆，返回可读文本（供注入系统提示词）。

    Args:
        query: 检索查询文本（通常是用户最近一条消息）
        episodic_mm: EpisodicMemoryManager 实例
        top_k: 返回的最大结果数

    Returns:
        格式化的情景记忆文本；若无结果返回空字符串
    """
    if episodic_mm is None or not query:
        return ""
    try:
        results = episodic_mm.retrieve(query=query, top_k=top_k)
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
