"""Tool: search_semantic — 检索语义记忆（结构化事实三元组）。"""

from pydantic import BaseModel, Field

from app_paths import SEMANTIC_MEMORY_PATH
from tools.base import ToolBase, format_error, format_success, register_tool


class SearchSemanticInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    query: str = Field(
        default="",
        description="检索查询文本，描述要查找的事实或知识（如'用户喜欢什么'、'项目的截止日期'）",
    )
    top_k: int = Field(
        default=5,
        description="返回的最大结果数（1-20）",
    )


@register_tool
class SearchSemanticTool(ToolBase):
    name: str = "search_semantic"
    description: str = (
        "检索语义记忆层 — 结构化事实三元组（subject-predicate-object）库。"
        "当用户询问已知的结构化事实（如'我住在哪里'、'项目什么时候截止'、'我喜欢什么音乐'）时使用。"
        "返回按语义相似度排序的事实列表。"
        "[调用积极性: 用户查询结构化事实或知识时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = SearchSemanticInput

    def _run(
        self,
        get_doc: bool = False,
        query: str = "",
        top_k: int = 5,
    ) -> str:
        if get_doc:
            return self._load_doc()

        if not query:
            return format_error("query 不能为空，请提供检索查询文本")

        if top_k < 1 or top_k > 20:
            top_k = max(1, min(20, top_k))

        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        results = sm.retrieve(query=query, top_k=top_k)

        if not results:
            return format_success({
                "count": 0,
                "items": [],
                "message": "未找到匹配的语义记忆事实",
            })

        # 格式化输出
        lines = []
        for item in results:
            lines.append(
                f"- {item['subject']} {item['predicate']} {item['object']} "
                f"(相似度 {item['similarity']:.0%})"
            )

        return format_success({
            "count": len(results),
            "items": results,
            "formatted": "\n".join(lines),
        })
