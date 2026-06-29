"""工具统计 API。"""

from fastapi import APIRouter

from tools import get_tool_stats, get_all_tools, TOOL_CATEGORIES, CORE_TOOLS

router = APIRouter()


@router.get("/tools/stats")
def tool_stats():
    """返回各工具的使用频率和分类信息。"""
    usage = get_tool_stats()
    all_tools = get_all_tools()
    return {
        "usage": usage,
        "total_tools": len(all_tools),
        "categories": TOOL_CATEGORIES,
        "core_tools": sorted(CORE_TOOLS),
    }
