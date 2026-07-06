"""Tool: kb_search — 检索知识库。"""

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class KbSearchInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    query: str = Field(
        default="",
        description="检索查询（自然语言或关键词），从知识库中检索相关文档片段",
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=50,
        description="返回的最大结果数（默认 5，最大 50）",
    )
    threshold: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="相似度阈值（默认 0.3，低于此值的结果被过滤）",
    )


@register_tool
class KbSearchTool(ToolBase):
    name: str = "kb_search"
    description: str = (
        "检索知识库中的文档片段。支持自然语言语义检索。"
        "当用户询问知识库中的内容、上传的文档、或导入的 URL 时使用。"
        "[调用积极性: 用户询问知识库或上传文档内容时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = KbSearchInput

    def _run(
        self,
        get_doc: bool = False,
        query: str = "",
        top_k: int = 5,
        threshold: float = 0.3,
    ) -> str:
        if get_doc:
            return self._load_doc()

        if not query.strip():
            return format_error("query 不能为空")

        from memory.kb.retriever import KBRetriever

        retriever = KBRetriever()
        results = retriever.retrieve(query=query, top_k=top_k, threshold=threshold)

        if not results:
            return format_success({
                "count": 0,
                "items": [],
                "message": "未在知识库中找到匹配内容",
            })

        lines = []
        for i, r in enumerate(results, 1):
            score = r.get('score_percent', 0)
            lines.append(
                f"{i}. [{r.get('source_filename', '?')}] (相似度 {score}%)"
            )
            text = r.get("text", "")
            if len(text) > 300:
                text = text[:300] + "…"
            lines.append(f"   {text}")

        return format_success({
            "count": len(results),
            "items": results,
            "formatted": "\n".join(lines),
        })
