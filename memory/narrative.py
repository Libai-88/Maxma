"""记忆叙事模块 — 每轮对话后将裸消息送给 LLM，增量更新 memory.yaml。"""

import asyncio
import hashlib
import json
import logging
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Optional

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

# langgraph 已由 oh-my-pi sidecar 替代
_HAS_LANGGRAPH = False

from app_paths import MEMORY_CONFIG_PATH
from memory.memory_callback import MemoryToolCallback
from memory.memory_manager import (
    MAX_DESC_LENGTH,
    MemoryManager,
    projection_mutation_scope,
)
from memory.ltm_outbox import (
    LongTermMemoryOutbox,
    OutboxRetentionPolicy,
    ProjectionFenceLost,
    ProjectionWriterLease,
)

logger = logging.getLogger(__name__)


class LTMErrorKind(StrEnum):
    """Stable, non-sensitive reason codes for durable LTM failures."""

    AUTHENTICATION_FAILED = "authentication_failed"
    PERMISSION_DENIED = "permission_denied"
    INVALID_REQUEST = "invalid_request"
    INVALID_CONFIGURATION = "invalid_configuration"
    RATE_LIMITED = "rate_limited"
    TEMPORARY_UNAVAILABLE = "temporary_unavailable"
    NETWORK_ERROR = "network_error"
    UNKNOWN = "unknown_error"

    @property
    def permanent(self) -> bool:
        return self in {
            self.AUTHENTICATION_FAILED,
            self.PERMISSION_DENIED,
            self.INVALID_REQUEST,
            self.INVALID_CONFIGURATION,
        }


def _error_status_code(exc: BaseException) -> int | None:
    """Read HTTP status from supported client errors without importing clients."""
    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        response = getattr(exc, "response", None)
        status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code
    return None


def classify_ltm_error(exc: BaseException) -> LTMErrorKind:
    """Classify failures before an LTM retry without depending on provider SDKs."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        status_code = _error_status_code(current)
        if status_code == 401:
            return LTMErrorKind.AUTHENTICATION_FAILED
        if status_code == 403:
            return LTMErrorKind.PERMISSION_DENIED
        if status_code in {400, 405, 411, 413, 414, 415, 416, 417, 422, 431}:
            return LTMErrorKind.INVALID_REQUEST
        if status_code in {404, 410}:
            return LTMErrorKind.INVALID_CONFIGURATION
        if status_code == 451:
            return LTMErrorKind.PERMISSION_DENIED
        if status_code == 429:
            return LTMErrorKind.RATE_LIMITED
        if status_code in {408, 409, 423, 425} or (status_code is not None and status_code >= 500):
            return LTMErrorKind.TEMPORARY_UNAVAILABLE
        # 其他 4xx（非 408/409/423/425/429）fail-closed：归类为永久错误
        if status_code is not None and 400 <= status_code < 500:
            return LTMErrorKind.INVALID_REQUEST

        error_name = type(current).__name__
        if error_name == "AuthenticationError":
            return LTMErrorKind.AUTHENTICATION_FAILED
        if error_name == "PermissionDeniedError":
            return LTMErrorKind.PERMISSION_DENIED
        if error_name in {"BadRequestError", "UnprocessableEntityError"}:
            return LTMErrorKind.INVALID_REQUEST
        if error_name in {"NotFoundError", "ConfigurationError"}:
            return LTMErrorKind.INVALID_CONFIGURATION
        if error_name == "RateLimitError":
            return LTMErrorKind.RATE_LIMITED
        if isinstance(current, (TimeoutError, ConnectionError, OSError)) or error_name in {
            "APIConnectionError",
            "APITimeoutError",
            "ServiceUnavailableError",
            "InternalServerError",
            "ConnectError",
            "ReadTimeout",
            "WriteTimeout",
            "PoolTimeout",
        }:
            return LTMErrorKind.NETWORK_ERROR

        # Legacy SDKs can surface only a text message. Restrict this fallback
        # to unambiguous status/credential wording rather than broad substring
        # matching that would turn arbitrary model output into control flow.
        message = str(current).lower()
        if re.search(r"(?<!\\d)401(?!\\d)", message) and "api" in message:
            return LTMErrorKind.AUTHENTICATION_FAILED
        if re.search(r"(?<!\\d)403(?!\\d)", message) and (
            "permission" in message or "forbidden" in message
        ):
            return LTMErrorKind.PERMISSION_DENIED
        current = current.__cause__ or current.__context__
    return LTMErrorKind.UNKNOWN


def _is_unrecoverable_error(exc: Exception) -> bool:
    """Compatibility predicate retained for callers that only need permanence."""
    return classify_ltm_error(exc).permanent


# LTM CRUD agent 最大重试次数（超过后放弃，避免无限循环）
_MAX_LTM_RETRIES = 5


# Backwards-compatible module export used by api.health.
MEMORY_PATH = MEMORY_CONFIG_PATH


def _sanitize(text: str) -> str:
    """将多行文本折叠为单行，防止破坏 YAML 格式。"""
    return text.replace("\n", " ").replace("\r", " ")


_CORE_PRINCIPLES = """核心原则：
0. 对于记忆来讲，主观印象第一，客观事实第二。科技、事实等固定的客观事实必须简洁简练，不要尝试在记忆里写大量知识性质的东西。相反地，用户的喜好等主观印象可以相对正常地描写。每个记忆条目最长不超过三句话。
1. 并不是对话里提及的每一个细节都值得记录。你被要求只记录简洁的记忆。仅关注用户的喜好、用户与助理正在做的事、困难与解决方法这些部分。其它的细节应当直接丢弃。若你看到已有记忆记录里有条目违反这一规则（如列举了某目录下的文件夹、列举了某个软件的详细用法等），应主动编辑、进行精简。
2. 只基于对话内容记录事实，不编造不推测。信息少就少写，不要凑字数。新旧矛盾时以新信息为准。
3. 每条记忆一个独立事实，每次必须提供正确的 section。
4. 用第三人称自然语言描述。
5. 禁止使用"今天""明天""昨天""下周"等相对时间词汇，必须使用绝对日期写入记忆。已提供当前日期和星期几，请自行换算。
6. 少即是多。任何条目不能过长。每个记忆描述**不得超过 150 个中文字符（含标点）**。超过 150 字的记忆创建、更新或合并请求会被系统自动驳回。
7. 若内容超过 150 字，应主动拆分：保留核心事实，将次要信息另起一条独立条目。

反面例子：2026年6月23日，用户 和 Maxma 讨论了用声明式 YAML 配置（类似 providers.yaml 的模式）来管理 MCP 服务器的方案，目标是实现不写代码就能添加 MCP 服务器。方案包括新建 config/mcp_servers.yaml 以及可选的 POST /api/mcp/reload 热加载端点。

**不要**把记忆写成像反面例子一样。若出现，应立即修正。

**正面例子**：2026年6月23日，用户 和 Maxma 讨论了用 YAML 配置来管理 MCP 的方案，目标是实现不写代码就能添加 MCP 服务器。

**学习该正面例子的写法。留意其较短的句子长度和较少的技术细节。**
"""

_COLD_PREFIX = """你是一位"记忆叙事师"。根据对话记录，用第三人称撰写关于用户的简洁中文记忆。

你必须使用提供的工具来管理记忆：
- 先调用 read_memories 查看当前记忆（冷启动时为空）
- 使用 create_memory 逐条添加新事实，每次必须指定 section 参数
- 无需调用 update_memory 或 delete_memory（冷启动时没有旧记忆）

由于当前记忆为空，你必须创建新分区（1-4字中文名词）。

TTL 过期机制：
- create_memory 工具支持可选的 ttl 参数（秒数），用于让"瞬间"或"时效待办"分区的条目自动过期。
  - "瞬间"分区（如天气、当下心情、临时观察）：建议 ttl=86400（1 天）。
  - "时效待办"分区（如作业、考试、预约）：根据截止日期建议 ttl（如 7 天 = 604800 秒）。
  - 其他分区（身份/音乐/品味等）默认永久，不传 ttl。

"""

_UPDATE_PREFIX = """你是一位"记忆叙事师"。以下是当前记忆（每条带唯一ID和分区）和一轮新对话。请对比新旧信息，更新记忆。

你必须使用提供的工具来管理记忆：
- 先调用 read_memories 查看所有当前记忆（注意每条记忆的分区）
- 新信息用 create_memory 逐条添加，每次必须指定 section 参数
- 已有信息需要修正或补充时用 update_memory（通过 ID 指定）
- 与新信息矛盾或已过时的条目用 delete_memory 删除

记忆分区：优先使用已有分区；若记忆不适合任何已有分区或用户明确要求新建，可以创建新分区（1-4字中文名词）。
对于"瞬间"分区的条目，如果内容不再有意义可以删除；对于"时效待办"，到期后务必删除。

TTL 过期机制：
- create_memory 工具支持可选的 ttl 参数（秒数），用于让"瞬间"或"时效待办"分区的条目自动过期。
  - "瞬间"分区（如天气、当下心情、临时观察）：建议 ttl=86400（1 天）。
  - "时效待办"分区（如作业、考试、预约）：根据截止日期建议 ttl（如 7 天 = 604800 秒）。
  - 其他分区（身份/音乐/品味等）默认永久，不传 ttl。
- update_memory 也支持 ttl 参数，可用于重置或取消过期时间（0 表示永久）。

"""

COLD_START_SYSTEM = _COLD_PREFIX + _CORE_PRINCIPLES
UPDATE_SYSTEM = _UPDATE_PREFIX + _CORE_PRINCIPLES


# ── 模块级 MemoryManager 引用 ──────────────────────────────

_current_mm: Optional[MemoryManager] = None
_projection_identity: ContextVar[tuple[str, str] | None] = ContextVar(
    "ltm_projection_identity", default=None
)


def _set_current_mm(mm: Optional[MemoryManager]) -> None:
    global _current_mm
    _current_mm = mm


@contextmanager
def _projection_scope(session_id: str | None, turn_id: str | None, mutation_guard=None):
    """Give tool calls stable per-turn operation IDs for target-side fencing."""
    identity = (
        (session_id, turn_id)
        if session_id is not None and turn_id is not None
        else None
    )
    identity_token = _projection_identity.set(identity)
    try:
        with projection_mutation_scope(mutation_guard):
            yield
    finally:
        _projection_identity.reset(identity_token)


def _projection_operation(
    action: str, arguments: dict[str, object]
) -> tuple[str | None, tuple[str, str] | None]:
    identity = _projection_identity.get()
    if identity is None:
        return None, None
    # The action and canonical arguments, rather than call ordinal, make a
    # replay safe even when an LLM takes a different read-only/tool-call path.
    payload = json.dumps(
        [identity[0], identity[1], action, arguments],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"ltm-op-{digest}", identity


# ── 格式化辅助 ──────────────────────────────────────────────


# 注入系统提示词的记忆条目上限，超出部分折叠
NARRATIVE_MAX_ITEMS = 40


def _format_narrative(items: list[dict]) -> str:
    """将 MemoryManager.show() 的输出格式化为人类可读的长记忆叙事文本。

    按更新时间降序排列（最近更新的记忆排在前面），
    超过 NARRATIVE_MAX_ITEMS 的条目折叠，并在末尾附加提示。
    """
    if not items:
        return ""

    # 按 latest_update_time 降序排列（最近更新的优先）
    sorted_items = sorted(
        items,
        key=lambda x: x.get("latest_update_time", ""),
        reverse=True,
    )

    # 容量上限
    total_count = len(sorted_items)
    visible_items = sorted_items[:NARRATIVE_MAX_ITEMS]
    folded_count = total_count - len(visible_items)

    by_theme: dict[str, list[dict]] = {}
    theme_order: list[str] = []
    for item in visible_items:
        theme = item["theme"]
        by_theme.setdefault(theme, []).append(item)
        if theme not in theme_order:
            theme_order.append(theme)
    lines = ["# 长期记忆索引"]
    for theme in theme_order:
        lines.append(f"- [{theme}](#{theme})")
    lines.extend(["", "---", ""])
    for theme in theme_order:
        lines.append(f"## {theme}")
        for item in by_theme[theme]:
            lines.append(f"- {item['description']}")
        lines.append("")

    if folded_count > 0:
        lines.append(f"（还有 {folded_count} 条较早记忆已折叠）")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def _format_entries_for_tool(items: list[dict]) -> str:
    """为 read_memories 工具格式化条目（按 theme 分组，带 ID）。"""
    if not items:
        return "（暂无记忆条目）"
    by_theme: dict[str, list[dict]] = {}
    theme_order: list[str] = []
    for item in items:
        theme = item["theme"]
        by_theme.setdefault(theme, []).append(item)
        if theme not in theme_order:
            theme_order.append(theme)
    lines = []
    for theme in theme_order:
        lines.append(f"## {theme}")
        for item in by_theme[theme]:
            lines.append(f"  [{item['id']}] {item['description']}")
        lines.append("")
    return "\n".join(lines).strip()


# ── get_narrative 缓存（基于文件 mtime）─────────────────────

_narrative_cache: str | None = None
_narrative_mtime: float = -1.0


def get_narrative() -> str:
    """读取当前记忆叙事，不存在则返回空字符串。

    基于 memory.yaml 的修改时间做缓存：文件未变化时直接返回上次结果，
    避免每次调用都创建 MemoryManager 并解析 YAML。
    支持人格专属记忆：如果当前人格配置了 memory: persona，
    则从独立的 memory_{persona}.yaml 读取。
    """
    global _narrative_cache, _narrative_mtime

    # 获取当前人格的记忆路径
    from agent.prompts import get_persona_memory_path

    memory_path = get_persona_memory_path()

    if not memory_path.exists():
        _narrative_cache = ""
        _narrative_mtime = -1.0
        return ""

    current_mtime = memory_path.stat().st_mtime
    if _narrative_cache is not None and current_mtime == _narrative_mtime:
        return _narrative_cache

    mm = MemoryManager(yaml_file=str(memory_path))
    _narrative_cache = _format_narrative(mm.show())
    _narrative_mtime = current_mtime
    return _narrative_cache


def invalidate_narrative_cache() -> None:
    """强制清空叙事缓存（供外部调用，例如 CRUD 写入后）。"""
    global _narrative_cache, _narrative_mtime
    _narrative_cache = None
    _narrative_mtime = -1.0


def _format_messages(messages: list[dict]) -> str:
    """将消息列表格式化为可读文本，过滤掉工具输出避免幻觉。"""
    lines = []
    for m in messages:
        role = m.get("role", "unknown")
        if role == "tool":
            continue
        content = str(m.get("content", ""))
        lines.append(f"[{role}]: {content}")
    return "\n".join(lines)


# ── CRUD 工具（模块级 @tool，委托给 _current_mm）─────────────────


@tool
def create_memory(content: str, section: str, ttl: Optional[int] = None) -> str:
    """添加一条新的记忆条目到指定分区。调用后返回该条目的唯一 ID。

    Args:
        content: 记忆内容，用第三人称中文描述用户的一个事实。
        section: 记忆分区。优先使用已有分区；若不适合任何已有分区或用户明确要求新建，可创建新分区（1-4字中文）：
            - "身份"（用户的基本身份信息：教育、职业、家乡等）
            - "音乐"（虚拟歌手、声库、歌曲、专辑、创作者）
            - "品味"（电影、美食、UP主、品牌偏好等）
            - "地点与路径"（具体地点和文件系统路径）
            - "瞬间"（即时观察和感受：天气、正在做的事、念头）
            - "时效待办"（有截止日期的事项：作业、预约、考试）
        ttl: 可选，过期时间（秒）。None 表示永久；建议"瞬间"分区设 86400（1 天）、
            "时效待办"分区根据截止日期设值。过期后条目会被自动清理。
    """
    content = _sanitize(content)
    if len(content) > MAX_DESC_LENGTH:
        return (
            f"驳回：记忆内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字），"
            f"请精简至 {MAX_DESC_LENGTH} 字以内，避免列举；或拆分为多条独立条目。"
        )
    if _current_mm is None:
        return "错误：记忆管理器未初始化。"
    operation_id, identity = _projection_operation(
        "create", {"content": content, "section": section, "ttl": ttl}
    )
    existing = _current_mm.get_projection_operation(operation_id)
    if existing is not None and isinstance(existing.get("result_id"), str):
        return f"已创建 [{existing['result_id']}] ({section}): {content}"
    # 智能合并检测：查找相似条目
    similar = _current_mm.find_similar(content, theme=section, threshold=0.65)
    if similar:
        top = similar[0]
        return (
            f"驳回：发现高度相似的已有记忆 [{top['id']}] ({top['theme']}) "
            f"「{top['description']}」（相似度 {top['similarity']:.0%}）。"
            f"请使用 update_memory 更新该条目，或使用 merge_memories 合并，而非新建。"
        )
    new_id = _current_mm.add(
        description=content,
        theme=section,
        ttl=ttl,
        projection_operation_id=operation_id,
        projection_identity=identity,
    )
    return f"已创建 [{new_id}] ({section}): {content}"


@tool
def read_memories() -> str:
    """查看当前所有记忆条目及其 ID 和分区。在增删改之前必须先调用此工具了解现有条目。"""
    if _current_mm is None:
        return "（暂无记忆条目）"
    result = _format_entries_for_tool(_current_mm.show())
    return result


@tool
def update_memory(id: str, content: str, reason: str) -> str:
    """根据 ID 更新一条已有记忆。

    Args:
        id: 要更新的记忆 ID（来自 read_memories 的输出）。
        content: 更新后的完整内容。
        reason: 修改原因，说明为什么要更新这条记忆。
    """
    content = _sanitize(content)
    if len(content) > MAX_DESC_LENGTH:
        return (
            f"驳回：更新后的记忆内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字），"
            f"请精简至 {MAX_DESC_LENGTH} 字以内，避免列举；或拆分为多条独立条目。"
        )
    if _current_mm is None:
        return "错误：记忆管理器未初始化。"
    operation_id, identity = _projection_operation(
        "update", {"id": id, "content": content, "reason": reason}
    )
    if _current_mm.get_projection_operation(operation_id) is not None:
        return f"已更新 [{id}]: {content}"
    try:
        _current_mm.update(
            id,
            reason=reason,
            new_description=content,
            projection_operation_id=operation_id,
            projection_identity=identity,
        )
    except ValueError:
        return f"错误：未找到 ID 为 {id} 的记忆条目。请先调用 read_memories 确认 ID。"
    return f"已更新 [{id}]: {content}"


@tool
def delete_memory(id: str, reason: str) -> str:
    """根据 ID 删除一条记忆。

    Args:
        id: 要删除的记忆 ID（来自 read_memories 的输出）。
        reason: 删除原因，说明为什么要删除这条记忆。
    """
    if _current_mm is None:
        return "错误：记忆管理器未初始化。"
    operation_id, identity = _projection_operation(
        "delete", {"id": id, "reason": reason}
    )
    if _current_mm.get_projection_operation(operation_id) is not None:
        return f"已删除 [{id}]"
    try:
        removed = _current_mm.delete(
            id,
            projection_operation_id=operation_id,
            projection_identity=identity,
        )
    except ValueError:
        return f"错误：未找到 ID 为 {id} 的记忆条目。请先调用 read_memories 确认 ID。"
    return f"已删除 [{id}]: {removed}"


@tool
def merge_memories(id1: str, id2: str, content: str, section: str, reason: str) -> str:
    """将两条相似记忆合并为一条，id1 保留、id2 被删除，同时保留两者的修改历史。

    当两条记忆描述同一事物（如分散的身份信息、同一首歌在不同分区的重复条目）
    时使用，避免碎片化。

    Args:
        id1: 合并后保留的记忆 ID（主条目）。
        id2: 合并后将被删除的记忆 ID（从条目）。
        content: 合并后的完整记忆内容，涵盖两条原条目的信息。
        section: 合并后的记忆分区。
        reason: 合并原因，说明为什么这两条记忆需要合并。
    """
    if len(content) > MAX_DESC_LENGTH:
        return (
            f"驳回：合并后的记忆内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字），"
            f"请精简至 {MAX_DESC_LENGTH} 字以内，避免列举；或保留两条各自独立。"
        )
    if _current_mm is None:
        return "错误：记忆管理器未初始化。"
    operation_id, identity = _projection_operation(
        "merge",
        {
            "id1": id1,
            "id2": id2,
            "content": content,
            "section": section,
            "reason": reason,
        },
    )
    if _current_mm.get_projection_operation(operation_id) is not None:
        return f"已合并 [{id2}] → [{id1}] ({section}): {content}"
    try:
        _current_mm.merge(
            id1,
            id2,
            content,
            section,
            reason,
            projection_operation_id=operation_id,
            projection_identity=identity,
        )
    except ValueError:
        return f"错误：未找到 ID 为 {id1} 或 {id2} 的记忆条目。请先调用 read_memories 确认 ID。"
    return f"已合并 [{id2}] → [{id1}] ({section}): {content}"


@tool
def search_memories(keyword: str = "", section: str = "", since: str = "") -> str:
    """搜索记忆条目。支持按关键词、分区、时间范围过滤。

    当用户提到'我之前跟你说过关于 XX 的事'或需要回忆历史信息时使用。

    Args:
        keyword: 搜索关键词，在记忆内容和分区名中模糊匹配
        section: 可选，按分区过滤（如 '身份'、'音乐'、'品味' 等）
        since: 可选，时间范围起始（格式 YYYY-MM-DD），仅返回此日期之后更新的条目
    """
    if _current_mm is None:
        return "（暂无记忆条目）"
    results = _current_mm.search(keyword=keyword, theme=section, since=since)
    if not results:
        return "未找到匹配的记忆条目"
    lines = []
    for item in results:
        lines.append(f"[{item['id']}] ({item['theme']}) {item['description']}")
    return "\n".join(lines)


# ── LongTermMemoryInterface ───────────────────────────────────


class LongTermMemoryInterface:
    """异步管线：逐轮对话消息 → asyncio.Queue → 后台 LLM 总结 → memory.yaml 写入。

    具备自恢复能力：若后台消费者协程意外退出，下次 send_history 时会自动重启。
    """

    def __init__(
        self,
        memory_path: str | Path,
        *,
        outbox_retention: OutboxRetentionPolicy | None = None,
        outbox_lease_seconds: float = 300,
        outbox_retry_base_seconds: float = 1,
        outbox_retry_max_seconds: float = 300,
        retry_policy_enabled: bool | None = None,
    ) -> None:
        self._memory_path = Path(memory_path)
        self._mm = MemoryManager(yaml_file=str(self._memory_path))
        self._outbox = LongTermMemoryOutbox(
            self._memory_path.with_suffix(
                self._memory_path.suffix + ".ltm-outbox.sqlite3"
            ),
            retention=outbox_retention,
            projection_target=self._memory_path,
            lease_seconds=outbox_lease_seconds,
            retry_base_seconds=outbox_retry_base_seconds,
            retry_max_seconds=outbox_retry_max_seconds,
        )
        # Preserve durable de-duplication for installations upgraded from the
        # JSON ledger. New completions are only ever written to SQLite.
        self._outbox.import_legacy_ledger(
            self._memory_path.with_suffix(self._memory_path.suffix + ".ltm-turns.json")
        )
        self._llm = None
        self._queue: asyncio.Queue | None = None
        self._consumer_task: asyncio.Task | None = None
        self._ws_registry = None
        # ``None`` preserves direct-library callers' historical behavior.
        # The app passes the default-off rollout setting explicitly.
        self._retry_policy_enabled = retry_policy_enabled

    @property
    def is_listening(self) -> bool:
        """后台消费者协程是否正在运行。"""
        return self._consumer_task is not None and not self._consumer_task.done()

    @property
    def memory_path(self) -> Path:
        """当前长期记忆 YAML 文件路径（公开访问，供 REST API 使用）。"""
        return self._memory_path

    def get_narrative(self) -> str:
        """读取当前记忆叙事，从实例自身的 _memory_path 读取。"""
        if not self._memory_path.exists():
            return ""
        mm = MemoryManager(yaml_file=str(self._memory_path))
        return _format_narrative(mm.show())

    def get_diagnostic_summary(self) -> dict[str, object]:
        """Expose a payload-free LTM status summary for runtime health checks."""
        return self._outbox.diagnostic_summary()

    def start_listening(self, llm, ws_registry=None) -> None:
        """保存 LLM 引用并确保后台消费者正在运行。

        幂等：若消费者已在运行则不重复创建；若消费者已死则自动重启。
        """
        self._llm = llm
        self._ws_registry = ws_registry
        self._ensure_consumer()

    def _ensure_consumer(self) -> None:
        """确保后台消费者协程正在运行，若已停止则重启。

        这是自恢复的关键：lifespan 因异常提前进入 shutdown 阶段后，
        消费者可能已被 stop_listening 终止，但服务器仍在服务请求。
        当 send_history 被调用时，此方法会重新拉起消费者。
        """
        if self._llm is None:
            logger.warning(
                "[ltm] _ensure_consumer: _llm is None, cannot start consumer"
            )
            return
        if self.is_listening:
            return
        # 消费者未运行（从未启动或已崩溃），重新创建
        try:
            if self._queue is None:
                self._queue = asyncio.Queue()
            self._consumer_task = asyncio.create_task(self._consumer(self._llm))
            # Wake the new consumer so durable work left by a prior process is
            # claimed without waiting for another user message.
            self._queue.put_nowait("outbox_wakeup")
            logger.info(
                "[ltm] consumer (re)started, task=%s", self._consumer_task.get_name()
            )
        except Exception as e:
            logger.error("[ltm] _ensure_consumer failed: %s", e, exc_info=True)

    async def send_history(
        self,
        turn_messages: list[dict],
        session_id: str | None = None,
        turn_id: str | None = None,
    ) -> None:
        """生产者：将本轮对话消息放入队列（非阻塞）。

        若消费者已停止，会自动重启（自恢复）。
        """
        if not turn_messages:
            return
        self._ensure_consumer()
        if self._queue is None:
            logger.warning(
                "[ltm] queue is None after _ensure_consumer, dropping history"
            )
            return
        if session_id and turn_id:
            created = self._outbox.enqueue(session_id, turn_id, list(turn_messages))
            await self._queue.put("outbox_wakeup")
            logger.debug(
                "[ltm] outbox.%s session=%s turn_id=%s",
                "enqueue" if created else "wake",
                session_id,
                turn_id,
            )
        else:
            # Older callers without a turn ID intentionally keep historic
            # at-least-once in-memory behavior and are not conflated.
            await self._queue.put((session_id, turn_id, list(turn_messages), None))

    async def stop_listening(self) -> None:
        """发送 None 哨兵并等待消费者排空队列。

        幂等：若消费者未运行则直接返回。
        """
        if self._queue is None or self._consumer_task is None:
            return
        # 只有消费者还在跑时才发哨兵
        if not self._consumer_task.done():
            await self._queue.put(None)
            try:
                await self._consumer_task
            except Exception as e:
                logger.warning("[ltm] error waiting for consumer to finish: %s", e)
        self._queue = None
        self._consumer_task = None

    async def _lease_heartbeat(
        self, job, stop: asyncio.Event, lease_lost: asyncio.Event
    ) -> None:
        """Keep a long-running LLM projection exclusively owned by this worker."""
        interval = max(0.01, self._outbox.lease_seconds / 3)
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                if not self._outbox.renew(job):
                    lease_lost.set()
                    logger.warning(
                        "[ltm] projection lease lost session=%s turn_id=%s",
                        job.session_id,
                        job.turn_id,
                    )
                    return

    async def _legacy_lease_heartbeat(
        self,
        lease: ProjectionWriterLease,
        stop: asyncio.Event,
        lease_lost: asyncio.Event,
    ) -> None:
        """Keep a legacy in-memory projection behind the shared writer lease."""
        interval = max(0.01, self._outbox.lease_seconds / 3)
        while True:
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                if not self._outbox.renew_projection_writer(lease):
                    lease_lost.set()
                    logger.warning("[ltm] legacy projection writer lease lost")
                    return

    async def _consumer(self, llm) -> None:
        """后台消费者协程：从队列取消息，调用 CRUD Agent，写入 memory.yaml。"""
        logger.info("[ltm] _consumer coroutine started")

        while True:
            if self._queue is None:
                logger.warning("[ltm] consumer exiting: queue is None")
                break
            queue = self._queue
            heartbeat_stop: asyncio.Event | None = None
            heartbeat_task: asyncio.Task | None = None
            legacy_writer_lease: ProjectionWriterLease | None = None
            lease_lost: asyncio.Event | None = None
            # Drain durable work before waiting. This both recovers tasks left
            # by a crashed process and avoids a wakeup-per-row requirement.
            job = self._outbox.claim_next()
            queue_item = False
            if job is not None:
                session_id, turn_id, turn_messages = (
                    job.session_id,
                    job.turn_id,
                    job.payload,
                )
            else:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=self._outbox.next_ready_delay()
                    )
                except asyncio.TimeoutError:
                    continue
                queue_item = True
            try:
                if job is None and item is None:
                    logger.info("[ltm] consumer received sentinel, shutting down")
                    break
                if job is None and item == "outbox_wakeup":
                    continue
                if job is None:
                    session_id, turn_id, turn_messages, _ = item
                    legacy_writer_lease = self._outbox.acquire_projection_writer()
                    if legacy_writer_lease is None:
                        # Legacy work has no durable task identity, so preserve
                        # its historical at-least-once delivery by retrying the
                        # same queue item after the identified writer releases.
                        await queue.put(item)
                        await asyncio.sleep(0.05)
                        continue
                logger.info(
                    "[ltm] consumer got session=%s turn_id=%s msgs=%d",
                    session_id,
                    turn_id,
                    len(turn_messages),
                )

                # 无论后续成功与否，先通知前端「开始处理」
                if self._ws_registry is not None and session_id:
                    ws = self._ws_registry.get(session_id)
                    if ws is not None:
                        try:
                            await ws.send_json(
                                {
                                    "type": "memory_start",
                                    "payload": {"turn_id": turn_id or ""},
                                }
                            )
                            logger.debug(
                                "[ltm] memory_start sent session=%s turn_id=%s",
                                session_id[:8],
                                (turn_id or "")[:8],
                            )
                        except Exception:
                            pass

                try:
                    heartbeat_stop = asyncio.Event()
                    lease_lost = asyncio.Event()
                    heartbeat_task = (
                        asyncio.create_task(
                            self._lease_heartbeat(job, heartbeat_stop, lease_lost)
                        )
                        if job is not None
                        else asyncio.create_task(
                            self._legacy_lease_heartbeat(
                                legacy_writer_lease, heartbeat_stop, lease_lost
                            )
                        )
                    )
                    _set_current_mm(self._mm)
                    items = self._mm.show()
                    messages_text = _format_messages(turn_messages)

                    if items:
                        system_prompt = UPDATE_SYSTEM
                        user_prompt = f"## 新一轮对话\n{messages_text}"
                    else:
                        system_prompt = COLD_START_SYSTEM
                        user_prompt = messages_text

                    now = datetime.now()
                    weekday_cn = [
                        "星期一",
                        "星期二",
                        "星期三",
                        "星期四",
                        "星期五",
                        "星期六",
                        "星期日",
                    ][now.weekday()]
                    user_prompt += (
                        f"\n\n--- 会话日期: {now.strftime('%Y-%m-%d')} {weekday_cn} ---"
                    )

                    crud_tools = [
                        create_memory,
                        read_memories,
                        update_memory,
                        delete_memory,
                        merge_memories,
                        search_memories,
                    ]
                    if not _HAS_LANGGRAPH:
                        logger.info("[ltm] langgraph not available, skipping CRUD agent")
                        continue

                    # CRUD agent 已由 oh-my-pi sidecar 替代
                    # 直接通过 memory tools 读写 YAML
                    logger.info("[ltm] oh-my-pi mode: LTM CRUD agent skipped")
                    try:
                        purged = self._mm.purge_expired()
                        if purged > 0:
                            logger.info("[ltm] purged %d expired item(s)", purged)
                    except ProjectionFenceLost:
                        raise
                    except Exception as exc:
                        logger.warning("[ltm] purge_expired failed: %s", exc)
                    invalidate_narrative_cache()
                    if job is not None:
                        if not self._outbox.complete(job):
                            logger.warning(
                                "[ltm] completion lease lost session=%s turn_id=%s",
                                session_id,
                                turn_id,
                            )
                        else:
                            self._mm.prune_projection_operations(
                                self._outbox.retained_identities()
                            )

                except asyncio.CancelledError:
                    # Cancellation must relinquish only this matching lease;
                    # otherwise shutdown leaves work unavailable until expiry.
                    if job is not None:
                        self._outbox.release_cancelled(job)
                    raise
                except Exception as e:
                    error_kind = classify_ltm_error(e)
                    retry_policy_enabled = self._retry_policy_enabled is not False
                    # 无论 flag 如何，永久错误和重试预算耗尽都 abandon
                    is_permanent = error_kind.permanent
                    budget_exhausted = job is not None and job.attempts >= _MAX_LTM_RETRIES
                    if job is not None and (is_permanent or budget_exhausted):
                        logger.error(
                            "[ltm] CRUD agent terminal error code=%s; abandoning projection",
                            error_kind.value,
                        )
                        self._outbox.abandon(job, error_kind.value, str(e))
                    elif job is not None and retry_policy_enabled and job.attempts >= _MAX_LTM_RETRIES:
                        logger.error(
                            "[ltm] CRUD agent retry budget exhausted after %d attempts code=%s",
                            _MAX_LTM_RETRIES,
                            error_kind.value,
                        )
                        self._outbox.abandon(job, "retry_budget_exhausted", str(e))
                    else:
                        logger.error(
                            "[ltm] CRUD agent retryable error code=%s",
                            error_kind.value,
                            exc_info=True,
                        )
                        if job is not None:
                            self._outbox.fail(
                                session_id,
                                turn_id,
                                job.lease_token,
                                str(e),
                                failure_code=error_kind.value,
                                fencing_token=job.fencing_token,
                            )
                finally:
                    if heartbeat_stop is not None:
                        heartbeat_stop.set()
                    if heartbeat_task is not None:
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass
                    # 无论异常与否，都通知前端本轮记忆处理完成
                    if self._ws_registry is not None and session_id:
                        ws = self._ws_registry.get(session_id)
                        if ws is not None:
                            try:
                                await ws.send_json(
                                    {
                                        "type": "memory_done",
                                        "payload": {"turn_id": turn_id or ""},
                                    }
                                )
                                logger.debug(
                                    "[ltm] memory_done sent session=%s turn_id=%s",
                                    session_id[:8],
                                    (turn_id or "")[:8],
                                )
                            except Exception as e:
                                logger.warning("[ltm] memory_done send error: %s", e)
                        else:
                            logger.warning(
                                "[ltm] ws_registry.get returned None for session=%s",
                                session_id[:8],
                            )
            finally:
                if legacy_writer_lease is not None:
                    try:
                        self._outbox.release_projection_writer(legacy_writer_lease)
                    except Exception as exc:
                        logger.warning(
                            "[ltm] legacy writer lease release failed: %s", exc
                        )
                if queue_item:
                    queue.task_done()
