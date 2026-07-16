"""工具统计 API。"""

from fastapi import APIRouter


router = APIRouter()


@router.get("/tools/stats")
def tool_stats():
    """返回各工具的使用频率和分类信息。"""
    return {
        "usage": {},
        "total_tools": 0,
        "categories": {},
        "core_tools": [],
    }
