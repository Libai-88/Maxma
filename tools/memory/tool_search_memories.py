"""Tool: search_memories — 搜索记忆条目。"""

from pydantic import BaseModel, Field

from app_paths import MEMORY_CONFIG_PATH as MEMORY_PATH
from tools.base import ToolBase, format_error, format_success


class SearchMemoriesInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    keyword: str = Field(
        default="",
        description="搜索关键词，在记忆内容和分区名中模糊匹配",
    )
    section: str = Field(
        default="",
        description="可选，按分区过滤（如 '身份'、'音乐'、'品味' 等）",
    )
    since: str = Field(
        default="",
        description="可选，时间范围起始（格式 YYYY-MM-DD），仅返回此日期之后更新的条目",
    )


class SearchMemoriesTool(ToolBase):
    name: str = "search_memories"
    description: str = (
        "搜索长期记忆条目。支持按关键词、分区、时间范围过滤。"
        "当用户提到'我之前跟你说过关于 XX 的事'或需要回忆历史信息时使用。"
        "[调用积极性: 用户询问过去的对话或记忆时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = SearchMemoriesInput

    def _run(
        self,
        get_doc: bool = False,
        keyword: str = "",
        section: str = "",
        since: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        if not keyword and not section and not since:
            return format_error("至少需要提供 keyword、section 或 since 中的一个参数")

        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        results = mm.search(keyword=keyword, theme=section, since=since)

        if not results:
            return format_success({
                "count": 0,
                "items": [],
                "message": "未找到匹配的记忆条目",
            })

        # 格式化输出
        lines = []
        for item in results:
            lines.append(f"[{item['id']}] ({item['theme']}) {item['description']}")

        return format_success({
            "count": len(results),
            "items": results,
            "formatted": "\n".join(lines),
        })
