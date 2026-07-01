"""工具（Tool）集中注册 — ALL_TOOLS 供 Agent 使用。"""

from collections import defaultdict

from langchain_core.tools import BaseTool

from tools.base import SharedAPIClient

# 懒加载 client，避免循环导入
_client: SharedAPIClient | None = None
_cached_tools: list[BaseTool] | None = None

# 工具使用统计（工具名 → 调用次数）
_tool_usage: dict[str, int] = defaultdict(int)


def record_tool_usage(tool_name: str) -> None:
    """记录一次工具调用（供回调函数调用）。"""
    _tool_usage[tool_name] += 1


def get_tool_stats() -> dict[str, int]:
    """返回所有工具的使用次数统计。"""
    return dict(_tool_usage)


def _get_client() -> SharedAPIClient:
    global _client
    if _client is None:
        _client = SharedAPIClient()
    return _client


def get_all_tools() -> list[BaseTool]:
    """返回所有已注册的 Tool 实例（带缓存，仅首次调用时加载）。"""
    global _cached_tools
    if _cached_tools is not None:
        return _cached_tools

    client = _get_client()

    # System
    from tools.system.tool_python import RunPythonTool
    from tools.system.tool_project_info import ProjectInfoTool
    from tools.system.tool_context_strategy import ContextStrategyTool
    from tools.system.tool_forget import ForgetTool
    from tools.system.tool_create_persona import CreatePersonaTool

    # Todo
    from tools.todo.tool_add import TodoAddTool
    from tools.todo.tool_list import TodoListTool
    from tools.todo.tool_complete import TodoCompleteTool
    from tools.todo.tool_uncomplete import TodoUncompleteTool
    from tools.todo.tool_delete import TodoDeleteTool
    from tools.todo.tool_update import TodoUpdateTool
    from tools.todo.tool_query import TodoQueryTool
    from tools.todo.tool_list_projects import TodoListProjectsTool
    from tools.todo.tool_list_sections import TodoListSectionsTool
    from tools.todo.tool_list_labels import TodoListLabelsTool

    # Map
    from tools.map.tool_nearby import NearbySearchTool
    from tools.map.tool_geocode import GeocodeTool
    from tools.map.tool_transit import TransitRouteTool
    from tools.map.tool_cycling import CyclingRouteTool
    from tools.map.tool_fuzzy_addr import FuzzyAddressTool

    # Network
    from tools.network.tool_weather import WeatherTool
    from tools.network.tool_holiday import HolidayCalendarTool
    from tools.network.tool_image_understand import ImageUnderstandTool
    from tools.network.tavily import TavilySearchTool, TavilyExtractTool
    from tools.network.playwright_tools import (
        BrowserBrowseTool,
        BrowserScreenshotTool,
        BrowserExtractTool,
    )

    # Files
    from tools.files.tool_file_read import FileReadTool
    from tools.files.tool_file_write import FileWriteTool
    from tools.files.tool_file_manage import FileManageTool
    from tools.files.tool_file_search import FileSearchTool
    from tools.files.tool_file_edit import FileEditTool

    # Task
    from tools.task.tool_tracker import TaskTrackerTool

    # SubAgent
    from tools.sub_agent.tool_call_sub_agent import CallSubAgentTool
    from tools.sub_agent.tool_parallel import ParallelExecuteTool

    # QuickTask
    from tools.quick_task.tool_quick_task import QuickTaskTool

    # Interaction
    from tools.interaction.tool_ask_qa import AskUserQATool
    from tools.interaction.tool_single_choice import AskUserSingleChoiceTool
    from tools.interaction.tool_multi_choice import AskUserMultiChoiceTool
    from tools.interaction.tool_ask_confirm import AskUserConfirmTool

    # Entertainment
    from tools.entertainment.tool_tarot import TarotTool

    # Memory
    from tools.memory.tool_list_memories import ListMemoriesTool
    from tools.memory.tool_read_memories import ReadMemoriesTool
    from tools.memory.tool_create_memory import CreateMemoryTool
    from tools.memory.tool_update_memory import UpdateMemoryTool
    from tools.memory.tool_delete_memory import DeleteMemoryTool
    from tools.memory.tool_merge_memories import MergeMemoriesTool
    from tools.memory.tool_search_memories import SearchMemoriesTool

    # Config (MCP / Skills / Macros / Providers / EnvVars / Whitelist)
    from tools.config.tool_manage_mcp import ManageMCPTool
    from tools.config.tool_manage_skills import ManageSkillsTool
    from tools.config.tool_manage_macros import ManageMacrosTool
    from tools.config.tool_manage_providers import ManageProvidersTool
    from tools.config.tool_manage_env_vars import ManageEnvVarsTool
    from tools.config.tool_manage_whitelist import ManageWhitelistTool

    # Git
    from tools.git.tool_git_status import GitStatusTool
    from tools.git.tool_git_diff import GitDiffTool
    from tools.git.tool_git_log import GitLogTool
    from tools.git.tool_git_commit import GitCommitTool
    from tools.git.tool_git_branch import GitBranchTool
    from tools.git.tool_git_push import GitPushTool
    from tools.git.tool_git_pr import GitPRTool

    _cached_tools = [
        # System
        RunPythonTool(client=client),
        ProjectInfoTool(client=client),
        ContextStrategyTool(client=client),
        ForgetTool(client=client),
        CreatePersonaTool(client=client),
        # Todo
        TodoAddTool(client=client),
        TodoListTool(client=client),
        TodoCompleteTool(client=client),
        TodoUncompleteTool(client=client),
        TodoDeleteTool(client=client),
        TodoUpdateTool(client=client),
        TodoQueryTool(client=client),
        TodoListProjectsTool(client=client),
        TodoListSectionsTool(client=client),
        TodoListLabelsTool(client=client),
        # Map
        NearbySearchTool(client=client),
        GeocodeTool(client=client),
        TransitRouteTool(client=client),
        CyclingRouteTool(client=client),
        FuzzyAddressTool(client=client),
        # Network
        WeatherTool(client=client),
        HolidayCalendarTool(client=client),
        ImageUnderstandTool(client=client),
        TavilySearchTool(client=client),
        TavilyExtractTool(client=client),
        BrowserBrowseTool(client=client),
        BrowserScreenshotTool(client=client),
        BrowserExtractTool(client=client),
        # Files
        FileReadTool(client=client),
        FileWriteTool(client=client),
        FileManageTool(client=client),
        FileSearchTool(client=client),
        FileEditTool(client=client),
        # Task
        TaskTrackerTool(client=client),
        # SubAgent
        CallSubAgentTool(client=client),
        ParallelExecuteTool(client=client),
        # QuickTask
        QuickTaskTool(client=client),
        # Interaction
        AskUserQATool(client=client),
        AskUserSingleChoiceTool(client=client),
        AskUserMultiChoiceTool(client=client),
        AskUserConfirmTool(client=client),
        # Entertainment
        TarotTool(client=client),
        # Memory
        ListMemoriesTool(client=client),
        ReadMemoriesTool(client=client),
        CreateMemoryTool(client=client),
        UpdateMemoryTool(client=client),
        DeleteMemoryTool(client=client),
        MergeMemoriesTool(client=client),
        SearchMemoriesTool(client=client),
        # Config
        ManageMCPTool(client=client),
        ManageSkillsTool(client=client),
        ManageMacrosTool(client=client),
        ManageProvidersTool(client=client),
        ManageEnvVarsTool(client=client),
        ManageWhitelistTool(client=client),
        # Git
        GitStatusTool(client=client),
        GitDiffTool(client=client),
        GitLogTool(client=client),
        GitCommitTool(client=client),
        GitBranchTool(client=client),
        GitPushTool(client=client),
        GitPRTool(client=client),
    ]
    return _cached_tools


def clear_tool_cache() -> None:
    """清除工具缓存，下次调用 get_all_tools() 时重新加载。"""
    global _cached_tools
    _cached_tools = None


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
        "nearby_search", "geocode", "transit_route",
        "cycling_route", "fuzzy_address",
    ],
    "network": [
        "weather", "holiday_calendar", "image_understand",
        "tavily_search", "tavily_extract",
        "browser_browse", "browser_screenshot", "browser_extract",
    ],
    "files": [
        "file_read", "file_write", "file_manage",
        "file_search", "file_edit",
    ],
    "task": ["task_tracker"],
    "sub_agent": ["call_sub_agent", "parallel_execute", "quick_task"],
    "interaction": ["ask_user_qa", "ask_user_single_choice", "ask_user_multi_choice", "ask_user_confirm"],
    "entertainment": ["tarot"],
    "memory": [
        "list_memories", "read_memories", "create_memory",
        "update_memory", "delete_memory", "merge_memories", "search_memories",
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
    "ask_user_qa", "ask_user_single_choice", "ask_user_multi_choice", "ask_user_confirm",
    "list_memories", "read_memories", "create_memory", "update_memory", "delete_memory", "merge_memories", "search_memories",
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

    # 追加 MCP 工具（始终包含，不受过滤影响）
    if mcp_tools:
        result = result + list(mcp_tools)

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
