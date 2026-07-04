"""Tool: search_episodic — 检索情景记忆（历史对话快照）。"""

from pydantic import BaseModel, Field

from app_paths import EPISODIC_MEMORY_PATH
from tools.base import ToolBase, format_error, format_success, register_tool


class SearchEpisodicInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    query: str = Field(
        default="",
        description="检索查询文本，描述要回忆的历史对话场景或主题",
    )
    top_k: int = Field(
        default=5,
        description="返回的最大结果数（1-20）",
    )


@register_tool
class SearchEpisodicTool(ToolBase):
    name: str = "search_episodic"
    description: str = (
        "检索情景记忆层 — 历史对话快照库。"
        "当用户问'上次我们聊到哪了'、'之前你说过什么'、'那次讨论 XX 是什么时候'时使用。"
        "返回按语义相似度排序的历史对话摘要。"
        "[调用积极性: 用户回忆历史对话场景时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = SearchEpisodicInput

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

        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        results = em.retrieve(query=query, top_k=top_k)

        if not results:
            return format_success({
                "count": 0,
                "items": [],
                "message": "未找到匹配的情景记忆（可能向量库未初始化，或无历史对话快照）",
            })

        # 格式化输出
        lines = []
        for item in results:
            lines.append(
                f"[{item['timestamp']}] (相似度 {item['similarity']:.0%}) "
                f"{item['summary']}"
            )

        return format_success({
            "count": len(results),
            "items": results,
            "formatted": "\n".join(lines),
        })
