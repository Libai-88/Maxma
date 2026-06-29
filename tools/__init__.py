"""工具（Tool）集中注册 — ALL_TOOLS 供 Agent 使用。"""

from langchain_core.tools import BaseTool

from tools.base import SharedAPIClient

# 懒加载 client，避免循环导入
_client: SharedAPIClient | None = None
_cached_tools: list[BaseTool] | None = None


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

    # Interaction
    from tools.interaction.tool_ask_qa import AskUserQATool
    from tools.interaction.tool_single_choice import AskUserSingleChoiceTool
    from tools.interaction.tool_multi_choice import AskUserMultiChoiceTool

    # Entertainment
    from tools.entertainment.tool_tarot import TarotTool

    # Memory
    from tools.memory.tool_list_memories import ListMemoriesTool
    from tools.memory.tool_read_memories import ReadMemoriesTool
    from tools.memory.tool_create_memory import CreateMemoryTool
    from tools.memory.tool_update_memory import UpdateMemoryTool
    from tools.memory.tool_delete_memory import DeleteMemoryTool
    from tools.memory.tool_merge_memories import MergeMemoriesTool

    _cached_tools = [
        # System
        RunPythonTool(client=client),
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
        # Interaction
        AskUserQATool(client=client),
        AskUserSingleChoiceTool(client=client),
        AskUserMultiChoiceTool(client=client),
        # Entertainment
        TarotTool(client=client),
        # Memory
        ListMemoriesTool(client=client),
        ReadMemoriesTool(client=client),
        CreateMemoryTool(client=client),
        UpdateMemoryTool(client=client),
        DeleteMemoryTool(client=client),
        MergeMemoriesTool(client=client),
    ]
    return _cached_tools


def clear_tool_cache() -> None:
    """清除工具缓存，下次调用 get_all_tools() 时重新加载。"""
    global _cached_tools
    _cached_tools = None


# ── 工具分类与动态选择 ──────────────────────────────────────────

# 工具名称到分类的映射
TOOL_CATEGORIES: dict[str, list[str]] = {
    "system": ["run_python"],
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
    ],
    "files": [
        "file_read", "file_write", "file_manage",
        "file_search", "file_edit",
    ],
    "task": ["task_tracker"],
    "sub_agent": ["call_sub_agent"],
    "interaction": ["ask_user_qa", "ask_user_single_choice", "ask_user_multi_choice"],
    "entertainment": ["tarot"],
    "memory": [
        "list_memories", "read_memories", "create_memory",
        "update_memory", "delete_memory", "merge_memories",
    ],
}

# 始终加载的核心工具（不受过滤影响）
CORE_TOOLS = {
    "run_python", "file_read", "file_write", "file_manage", "file_search", "file_edit",
    "task_tracker", "call_sub_agent",
    "ask_user_qa", "ask_user_single_choice", "ask_user_multi_choice",
    "list_memories", "read_memories", "create_memory", "update_memory", "delete_memory", "merge_memories",
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
    "tarot": ["entertainment"],
    "塔罗": ["entertainment"],
    "占卜": ["entertainment"],
}


def select_tools_for_query(query: str, max_tools: int = 20) -> list[BaseTool]:
    """根据用户查询动态选择相关工具子集。

    Args:
        query: 用户输入文本
        max_tools: 最大返回工具数

    Returns:
        过滤后的工具列表，包含核心工具 + 匹配查询的工具
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
        return filtered

    # 否则优先返回核心工具
    core = [t for t in all_tools if t.name in CORE_TOOLS]
    non_core = [t for t in filtered if t.name not in CORE_TOOLS]
    return core + non_core[:max_tools - len(core)]
