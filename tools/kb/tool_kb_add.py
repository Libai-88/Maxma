"""Tool: kb_add_document — 向知识库添加文档。"""

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool
from tools.path_security import check_path_access


class KbAddDocumentInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    file_path: str = Field(
        default="",
        description="要添加到知识库的本地文件路径（支持 txt/md/pdf/docx/csv/json）",
    )
    url: str = Field(
        default="",
        description="要导入知识库的 URL（使用 Tavily Extract 提取内容后索引）",
    )
    text: str = Field(
        default="",
        description="要直接索引的纯文本内容",
    )
    doc_id: str = Field(
        default="",
        description="可选文档 ID（默认自动生成）",
    )


@register_tool
class KbAddDocumentTool(ToolBase):
    name: str = "kb_add_document"
    description: str = (
        "向知识库添加文档。支持三种方式："
        "file_path（本地文件）、url（从 URL 提取）、text（纯文本）。"
        "添加后文档会被切块、生成向量索引，供 kb_search 检索。"
        "[调用积极性: 用户要求把文件/URL/文本加入知识库时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = KbAddDocumentInput

    def _run(
        self,
        get_doc: bool = False,
        file_path: str = "",
        url: str = "",
        text: str = "",
        doc_id: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        # 三选一：file_path / url / text
        provided = sum(1 for v in [file_path, url, text] if v.strip())
        if provided == 0:
            return format_error("请提供 file_path、url 或 text 中的一个参数")
        if provided > 1:
            return format_error("请只提供 file_path、url 或 text 中的一个（不要同时提供多个）")

        from memory.kb.indexer import KBIndexer

        indexer = KBIndexer()
        effective_doc_id = doc_id.strip() or None

        try:
            if file_path.strip():
                # 安全校验：file_path 必须通过 MaxmaBlocker + 路径白名单检查
                access_error = check_path_access(file_path.strip())
                if access_error:
                    return format_error(access_error)
                result = indexer.index_file(file_path.strip(), doc_id=effective_doc_id)
            elif url.strip():
                # 使用 Tavily Extract 提取 URL 内容
                markdown = self._extract_url(url.strip())
                result = indexer.index_url(url.strip(), markdown, doc_id=effective_doc_id)
            else:  # text
                if not doc_id.strip():
                    return format_error("使用 text 参数时必须提供 doc_id")
                result = indexer.index_text(
                    content=text,
                    doc_id=doc_id,
                    filename=f"{doc_id}.txt",
                    source="agent_text",
                )
        except ValueError as e:
            return format_error(str(e))
        except Exception as e:
            return format_error(f"索引失败: {e}")

        return format_success(result)

    @staticmethod
    def _extract_url(url: str) -> str:
        """使用 Tavily Extract 从 URL 提取 Markdown 文本。"""
        from api.routes.kb import _parse_tavily_result
        from tools.network.tavily.tool_extract import TavilyExtractTool

        extract_tool = TavilyExtractTool()
        result_str = extract_tool._run(urls=url)
        return _parse_tavily_result(result_str)
