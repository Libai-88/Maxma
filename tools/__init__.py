"""工具（Tool）集中注册 — ALL_TOOLS 供 Agent 使用。"""

from __future__ import annotations

from collections import defaultdict
import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)

# 懒加载 client，避免循环导入
_client: SharedAPIClient | None = None
_client_lock = threading.Lock()  # 保护 _client 单例初始化
_cached_tools: list[BaseTool] | None = None
_cached_tools_lock = threading.Lock()  # 保护 _cached_tools 初始化
_registry_validated = False

# 工具使用统计（工具名 → 调用次数）
_tool_usage: dict[str, int] = defaultdict(int)


def record_tool_usage(tool_name: str) -> None:
    """记录一次工具调用（供回调函数调用）。"""
    _tool_usage[tool_name] += 1


def get_tool_stats() -> dict[str, int]:
    """返回所有工具的使用次数统计。"""
    return dict(_tool_usage)


def _get_client() -> SharedAPIClient:
    from tools.base import SharedAPIClient

    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = SharedAPIClient()
        return _client


def get_all_tools() -> list[BaseTool]:
    """返回所有已注册的 Tool 实例（带缓存，仅首次调用时加载）。

    通过 ``tools.registry.discover_tools()`` 扫描 ``tools/*/tool_*.py``，
    收集所有带 ``@register_tool`` 装饰器的类并实例化。
    新增工具只需在文件中加 ``@register_tool``，无需修改本文件。

    线程安全：通过 _cached_tools_lock 双重检查，避免重复实例化。
    """
    global _cached_tools
    if _cached_tools is not None:
        return _cached_tools
    with _cached_tools_lock:
        if _cached_tools is not None:
            return _cached_tools
        client = _get_client()

        from tools.registry import instantiate_tools

        tools_list = instantiate_tools(client)
        validate_tool_registry(tools_list)
        _cached_tools = tools_list
        return _cached_tools


def clear_tool_cache() -> None:
    """清除工具缓存，下次调用 get_all_tools() 时重新加载。"""
    global _cached_tools, _registry_validated
    with _cached_tools_lock:
        _cached_tools = None
        _registry_validated = False


def merge_tool_lists(
    primary_tools: list[BaseTool],
    secondary_tools: list[BaseTool] | None = None,
    *,
    log_collisions: bool = True,
) -> list[BaseTool]:
    """按名称合并两组工具，保留第一组优先级。"""
    merged = list(primary_tools)
    seen_names = {tool.name for tool in merged}

    for tool in secondary_tools or []:
        if tool.name in seen_names:
            if log_collisions:
                logger.warning(
                    "[tools] skip duplicate tool name from secondary toolset: %s",
                    tool.name,
                )
            continue
        merged.append(tool)
        seen_names.add(tool.name)

    return merged


class ToolRegistryError(RuntimeError):
    """工具注册表与实际工具装配结果不一致。"""


def _registered_tool_names(tools: list[BaseTool]) -> list[str]:
    return [str(tool.name) for tool in tools]


def _find_duplicate_names(names: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for name in names:
        if name in seen:
            duplicates.add(name)
        seen.add(name)
    return sorted(duplicates)


def validate_tool_registry(tools: list[BaseTool] | None = None) -> None:
    """校验工具分类/核心工具声明与实际装配工具名保持同步。

    不在模块 import 时运行；默认在 get_all_tools() 首次完成装配后运行一次。
    测试可传入轻量 fake tool 列表，避免触发真实工具初始化。
    """
    global _registry_validated
    if tools is None:
        if _registry_validated:
            return
        tools = get_all_tools()

    actual_names_list = _registered_tool_names(tools)
    actual_names = set(actual_names_list)
    categorized_names = {
        tool_name
        for category_tools in TOOL_CATEGORIES.values()
        for tool_name in category_tools
    }
    category_names = set(TOOL_CATEGORIES)
    keyword_categories = {
        category
        for categories in KEYWORD_TO_CATEGORIES.values()
        for category in categories
    }

    issues: list[str] = []
    duplicates = _find_duplicate_names(actual_names_list)
    if duplicates:
        issues.append(f"duplicate registered tool names: {duplicates}")

    missing_category_tools = sorted(categorized_names - actual_names)
    if missing_category_tools:
        issues.append(f"TOOL_CATEGORIES references unregistered tools: {missing_category_tools}")

    missing_core_tools = sorted(CORE_TOOLS - actual_names)
    if missing_core_tools:
        issues.append(f"CORE_TOOLS references unregistered tools: {missing_core_tools}")

    uncategorized_tools = sorted(actual_names - categorized_names)
    if uncategorized_tools:
        issues.append(f"registered tools missing from TOOL_CATEGORIES: {uncategorized_tools}")

    core_not_categorized = sorted(CORE_TOOLS - categorized_names)
    if core_not_categorized:
        issues.append(f"CORE_TOOLS missing from TOOL_CATEGORIES: {core_not_categorized}")

    unknown_keyword_categories = sorted(keyword_categories - category_names)
    if unknown_keyword_categories:
        issues.append(f"KEYWORD_TO_CATEGORIES references unknown categories: {unknown_keyword_categories}")

    if issues:
        raise ToolRegistryError("; ".join(issues))

    _registry_validated = True


# ── 工具分类与动态选择 ──────────────────────────────────────────

# 工具名称到分类的映射
TOOL_CATEGORIES: dict[str, list[str]] = {
    "system": ["run_python", "project_info", "context_strategy", "forget", "create_persona"],
    "todo": [
        "todo_add", "todo_list", "todo_complete", "todo_uncomplete",
        "todo_delete", "todo_update", "todo_query",
        "todo_list_projects", "todo_list_sections", "todo_list_labels",
    ],
    "map": [
        "nearby_search", "geocode_address", "get_transit_route",
        "get_cycling_route", "fuzzy_address_search",
    ],
    "network": [
        "get_current_weather", "holiday_calendar", "analyze_image",
        "tavily_search", "tavily_extract",
        "browser_browse", "browser_screenshot", "browser_extract",
    ],
    "files": [
        "file_read", "file_write", "file_manage",
        "file_search", "file_edit",
    ],
    "task": ["task_tracker"],
    "sub_agent": ["call_sub_agent", "parallel_execute", "quick_task"],
    "interaction": ["ask_user_qa", "ask_user_for_info", "ask_user_single_choice", "ask_user_multi_choice", "ask_user_confirm"],
    "entertainment": ["tarot"],
    "memory": [
        "list_memories", "read_memories", "create_memory",
        "update_memory", "delete_memory", "merge_memories", "search_memories",
        "search_episodic", "search_semantic",
    ],
    "kb": [
        "kb_search", "kb_add_document",
    ],
    "config": [
        "manage_mcp", "manage_skills", "manage_macros",
        "manage_providers", "manage_env_vars", "manage_whitelist",
    ],
    "git": [
        "git_status", "git_diff", "git_log",
        "git_commit", "git_branch", "git_push", "git_pr",
    ],
}

# 始终加载的核心工具（不受过滤影响）
CORE_TOOLS = {
    "run_python", "project_info", "context_strategy", "forget", "create_persona", "file_read", "file_write", "file_manage", "file_search", "file_edit",
    "task_tracker", "call_sub_agent", "parallel_execute", "quick_task",
    "ask_user_qa", "ask_user_for_info", "ask_user_single_choice", "ask_user_multi_choice", "ask_user_confirm",
    "list_memories", "read_memories", "create_memory", "update_memory", "delete_memory", "merge_memories", "search_memories", "search_episodic", "search_semantic",
    "kb_search", "kb_add_document",
    "manage_mcp", "manage_skills", "manage_macros", "manage_providers", "manage_env_vars", "manage_whitelist",
    "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_push", "git_pr",
}

# 关键词到工具分类的映射
KEYWORD_TO_CATEGORIES: dict[str, list[str]] = {
    "todo": ["todo"],
    "task": ["todo"],
    "待办": ["todo"],
    "任务": ["todo"],
    "map": ["map"],
    "地图": ["map"],
    "导航": ["map"],
    "路线": ["map"],
    "地点": ["map"],
    "weather": ["network"],
    "天气": ["network"],
    "搜索": ["network"],
    "search": ["network"],
    "网页": ["network"],
    "图片": ["network"],
    "浏览器": ["network"],
    "截图": ["network"],
    "screenshot": ["network"],
    "browser": ["network"],
    "爬取": ["network"],
    "联网": ["network"],
    "上网": ["network"],
    "互联网": ["network"],
    "网络": ["network"],
    "internet": ["network"],
    "web": ["network"],
    "查资料": ["network"],
    "查新闻": ["network"],
    "新闻": ["network"],
    "news": ["network"],
    "资讯": ["network"],
    "查找": ["network"],
    "tarot": ["entertainment"],
    "塔罗": ["entertainment"],
    "占卜": ["entertainment"],
    "mcp": ["config"],
    "MCP": ["config"],
    "skill": ["config"],
    "skills": ["config"],
    "技能": ["config"],
    "macro": ["config"],
    "macros": ["config"],
    "宏": ["config"],
    "服务器": ["config"],
    "工具配置": ["config"],
    "配置": ["config"],
    "提供商": ["config"],
    "provider": ["config"],
    "模型": ["config"],
    "API": ["config"],
    "api": ["config"],
    "环境变量": ["config"],
    "密钥": ["config"],
    "key": ["config"],
    "白名单": ["config"],
    "whitelist": ["config"],
    "路径": ["config"],
    "git": ["git"],
    "Git": ["git"],
    "提交": ["git"],
    "commit": ["git"],
    "分支": ["git"],
    "branch": ["git"],
    "代码": ["git"],
    "推送": ["git"],
    "push": ["git"],
    "PR": ["git"],
    "pr": ["git"],
    "pull request": ["git"],
    "diff": ["git"],
    "差异": ["git"],
    "项目": ["system"],
    "project": ["system"],
    "结构": ["system"],
    "技术栈": ["system"],
    "上下文": ["system"],
    "忘记": ["system"],
    "遗忘": ["system"],
    "forget": ["system"],
    "人格": ["system"],
    "persona": ["system"],
    "并行": ["sub_agent"],
    "parallel": ["sub_agent"],
    "同时": ["sub_agent"],
    "批量": ["sub_agent"],
    "记忆": ["memory"],
    "memory": ["memory"],
    "记得": ["memory"],
    "之前": ["memory"],
    "以前": ["memory"],
    "上次": ["memory"],
    "回忆": ["memory"],
    "历史对话": ["memory"],
    "情景": ["memory"],
    "事实": ["memory"],
    "知识": ["memory"],
    "知识库": ["kb"],
    "文档": ["kb"],
    "kb": ["kb"],
    "KB": ["kb"],
    "检索文档": ["kb"],
    "导入": ["kb"],
}


def select_tools_for_query(query: str, max_tools: int = 20, mcp_tools: list | None = None) -> list[BaseTool]:
    """根据用户查询动态选择相关工具子集。

    Args:
        query: 用户输入文本
        max_tools: 最大返回工具数（不含 MCP 工具）
        mcp_tools: 可选的 MCP 工具列表，始终追加到结果中

    Returns:
        过滤后的工具列表，包含核心工具 + 匹配查询的工具 + MCP 工具
    """
    all_tools = get_all_tools()
    query_lower = query.lower()

    # 收集匹配的分类
    matched_categories: set[str] = set()
    for keyword, categories in KEYWORD_TO_CATEGORIES.items():
        if keyword in query_lower:
            matched_categories.update(categories)

    # 收集要包含的工具名称
    included_tools: set[str] = set(CORE_TOOLS)
    for category in matched_categories:
        included_tools.update(TOOL_CATEGORIES.get(category, []))

    # 过滤工具列表
    filtered = [t for t in all_tools if t.name in included_tools]

    # 如果过滤后工具数少于上限，返回全部
    if len(filtered) <= max_tools:
        result = filtered
    else:
        # 否则优先返回核心工具
        core = [t for t in all_tools if t.name in CORE_TOOLS]
        non_core = [t for t in filtered if t.name not in CORE_TOOLS]
        result = core + non_core[:max_tools - len(core)]

    # 追加 MCP 工具（始终包含，不受过滤影响），若名称冲突则保留已选中的第一份。
    if mcp_tools:
        result = merge_tool_lists(result, list(mcp_tools), log_collisions=False)

    # ── 人格专属工具集过滤 ──
    # 如果当前人格的 SOUL 文件 frontmatter 中声明了 tools 列表，
    # 只保留允许的工具（MCP 工具不受限制）
    try:
        from agent.prompts import get_persona_allowed_tools
        allowed = get_persona_allowed_tools()
        if allowed is not None:
            all_native_names = {t.name for t in get_all_tools()}
            result = [
                t for t in result
                if t.name in allowed or t.name not in all_native_names
            ]
    except Exception:
        pass  # 解析失败时不限制

    return result
