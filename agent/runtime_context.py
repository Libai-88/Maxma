"""运行时配置摘要生成器。

为 agent 提供当前运行环境的配置快照，注入到 episodic_context 中，
让 LLM 每轮都能"看到"自己的配置全貌，减少执行路径的不确定性。

设计要点：
- 纯函数，无副作用，失败时返回空字符串（不阻塞主流程）
- 延迟导入，避免模块加载时的循环依赖
- 摘要精简（< 500 token），避免浪费上下文窗口
- 内容动态生成（每次调用时读取最新配置），但格式稳定
"""

import logging
import re
from itertools import islice

logger = logging.getLogger(__name__)

# 运行时配置来自可编辑的 provider/MCP 配置，不能让其中的任意文本改变
# 提示词的结构。以下上限同时控制单轮上下文成本和配置异常时的放大效应。
MAX_PROVIDER_ENTRIES = 6
MAX_MCP_SERVER_ENTRIES = 8
MAX_CATEGORY_ENTRIES = 12
MAX_TOOL_COUNT = 500
MAX_IDENTIFIER_CHARS = 72
MAX_CONTEXT_CHARS = 1_800
_UNSAFE_IDENTIFIER_CHARS = re.compile(r"[^\w .@:/+\-]")

# 工具分类中文名（与 TOOL_CATEGORIES 对应）
_CATEGORY_NAMES = {
    "system": "系统/诊断",
    "todo": "待办",
    "map": "地图",
    "network": "网络/搜索",
    "files": "文件",
    "task": "任务追踪",
    "sub_agent": "子Agent",
    "interaction": "用户交互",
    "entertainment": "娱乐",
    "memory": "记忆",
    "kb": "知识库",
    "config": "配置管理",
    "git": "Git",
}


def build_runtime_context(
    mcp_tool_count: int = 0,
    native_tool_count: int = 0,
    current_model_name: str | None = None,
) -> str:
    """生成运行时配置摘要文本。

    参数：
        mcp_tool_count: 当前已加载的 MCP 工具数量
        native_tool_count: 原生工具数量
        current_model_name: 当前使用的模型名称（可选）

    返回：
        格式化的配置摘要文本，失败时返回空字符串。
        内容会作为 episodic_context 的一部分 prepend 到 HumanMessage，
        不影响 SystemMessage 的稳定性（保持 DeepSeek prompt cache 命中）。
    """
    lines: list[str] = []

    # ── 模型提供商 — OMP ModelRegistry 管理
    provider_line = _build_provider_line(current_model_name)
    if provider_line:
        lines.append(f"- 模型提供商: {provider_line}")

    # ── MCP 服务器 ──
    mcp_line = _build_mcp_line(mcp_tool_count)
    if mcp_line:
        lines.append(f"- MCP 服务器: {mcp_line}")

    # ── 工具统计 ──
    tool_line = _build_tool_line(native_tool_count, mcp_tool_count)
    if tool_line:
        lines.append(f"- 启用工具: {tool_line}")

    # ── 工具分类概览（帮助 LLM 快速定位工具） ──
    category_line = _build_category_overview()
    if category_line:
        lines.append(f"- 工具分类: {category_line}")

    if not lines:
        return ""

    context = "[运行时配置]\n" + "\n".join(lines)
    # 保留完整行，避免在截断处留下看似有效的半个配置条目。
    if len(context) <= MAX_CONTEXT_CHARS:
        return context

    bounded_lines: list[str] = []
    remaining = MAX_CONTEXT_CHARS - len("[运行时配置]\n- 已截断")
    for line in lines:
        if len(line) > remaining:
            break
        bounded_lines.append(line)
        remaining -= len(line) + 1
    return "[运行时配置]\n" + "\n".join(bounded_lines) + "\n- 已截断"


def _safe_identifier(value: object, *, fallback: str = "未知") -> str:
    """将配置中的标识符转换为单行、无结构分隔符的短文本。"""
    text = str(value or "").replace("\r", " ").replace("\n", " ")
    text = " ".join(text.split())
    text = _UNSAFE_IDENTIFIER_CHARS.sub("", text).strip()
    if not text:
        return fallback
    if len(text) > MAX_IDENTIFIER_CHARS:
        return text[: MAX_IDENTIFIER_CHARS - 1].rstrip() + "…"
    return text


def _bounded_count(value: object) -> int:
    """返回安全、有限的非负工具数量。"""
    try:
        return min(MAX_TOOL_COUNT, max(0, int(value)))
    except (TypeError, ValueError, OverflowError):
        return 0


def _build_provider_line(current_model_name: str | None) -> str:
    """构建 provider 摘要行。

    OMP ModelRegistry 管理所有 provider，Python 端仅报告当前模型信息。
    """
    if current_model_name:
        return f"OMP ModelRegistry (current: {_safe_identifier(current_model_name)})"
    return "OMP ModelRegistry"


def _build_mcp_line(mcp_tool_count: int) -> str:
    """构建 MCP 服务器摘要行。"""
    try:
        servers = []
        if not servers:
            if mcp_tool_count > 0:
                return f"已加载 {mcp_tool_count} 个工具（配置信息不可用）"
            return "无"

        enabled = [
            s
            for s in islice(servers, MAX_MCP_SERVER_ENTRIES)
            if isinstance(s, dict) and s.get("enabled", False)
        ]
        if not enabled:
            return "无（全部已禁用）"

        parts: list[str] = []
        for s in enabled:
            sid = _safe_identifier(s.get("server_id"), fallback="未知服务器")
            count = _bounded_count(s.get("tool_count", 0))
            parts.append(f"{sid}({count}工具)")

        return ", ".join(parts)
    except Exception as e:
        logger.debug("[runtime_context] MCP 摘要生成失败: %s", e)
        if mcp_tool_count > 0:
            return f"已加载 {mcp_tool_count} 个工具"
        return ""


def _build_tool_line(native_count: int, mcp_count: int) -> str:
    """构建工具统计行。"""
    native_count = _bounded_count(native_count)
    mcp_count = _bounded_count(mcp_count)
    total = native_count + mcp_count
    if total == 0:
        return ""

    parts: list[str] = []
    if native_count > 0:
        parts.append(f"{native_count} 个原生")
    if mcp_count > 0:
        parts.append(f"{mcp_count} 个 MCP")
    return f"{' + '.join(parts)}，共 {total} 个"


def _build_category_overview() -> str:
    """构建工具分类概览（只列出有工具的分类）。"""
    try:
        TOOL_CATEGORIES: dict = {}
        all_tools: list = []

        tool_names = {t.name for t in all_tools}

        active_categories: list[str] = []
        for cat, names in islice(TOOL_CATEGORIES.items(), MAX_CATEGORY_ENTRIES):
            count = sum(1 for n in names if n in tool_names)
            if count > 0:
                display = _safe_identifier(_CATEGORY_NAMES.get(cat, cat), fallback="其他")
                active_categories.append(f"{display}({count})")

        return ", ".join(active_categories) if active_categories else ""
    except Exception as e:
        logger.debug("[runtime_context] 分类概览生成失败: %s", e)
        return ""
