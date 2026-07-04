"""REST API — 通用知识库。

端点：
- POST   /kb/documents        — 上传文档文件进行索引
- POST   /kb/documents/text   — 索引纯文本
- POST   /kb/documents/url    — 从 URL 导入（提取 Markdown 后索引）
- GET    /kb/documents         — 列出所有已索引文档
- GET    /kb/documents/{doc_id} — 获取单个文档元数据
- DELETE /kb/documents/{doc_id} — 删除文档及其切块
- POST   /kb/search            — 检索知识库
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from memory.kb.document_loader import SUPPORTED_EXTENSIONS
from memory.kb.indexer import KBIndexer
from memory.kb.retriever import KBRetriever

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_indexer(request: Request) -> KBIndexer:
    """获取或创建 KBIndexer 单例（存储在 app.state 上）。"""
    indexer = getattr(request.app.state, "kb_indexer", None)
    if indexer is None:
        indexer = KBIndexer()
        request.app.state.kb_indexer = indexer
    return indexer


def _get_retriever(request: Request) -> KBRetriever:
    """获取或创建 KBRetriever 单例。"""
    retriever = getattr(request.app.state, "kb_retriever", None)
    if retriever is None:
        retriever = KBRetriever()
        request.app.state.kb_retriever = retriever
    return retriever


# ── 文档管理 ──


@router.get("/kb/documents")
async def list_documents(request: Request):
    """列出所有已索引文档。"""
    indexer = _get_indexer(request)
    return {"items": indexer.list_documents()}


@router.get("/kb/documents/{doc_id}")
async def get_document(doc_id: str, request: Request):
    """获取单个文档元数据。"""
    indexer = _get_indexer(request)
    doc = indexer.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"文档 {doc_id} 不存在")
    return doc


@router.delete("/kb/documents/{doc_id}")
async def delete_document(doc_id: str, request: Request):
    """删除文档及其所有切块。"""
    indexer = _get_indexer(request)
    if not indexer.delete_document(doc_id):
        raise HTTPException(status_code=404, detail=f"文档 {doc_id} 不存在")
    return {"status": "deleted", "doc_id": doc_id}


@router.post("/kb/documents")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    doc_id: Optional[str] = None,
):
    """上传文档文件进行索引。

    支持的文件类型：txt, md, markdown, pdf, docx, csv, json
    """
    # 检查文件扩展名
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext}（支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}）",
        )

    # 读取文件内容
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")

    # 保存到 KB_DIR
    from app_paths import KB_DIR

    safe_filename = filename.replace("/", "_").replace("\\", "_")
    save_path = KB_DIR / safe_filename
    save_path.parent.mkdir(parents=True, exist_ok=True)
    save_path.write_bytes(content)

    # 索引
    indexer = _get_indexer(request)
    try:
        result = indexer.index_file(save_path, doc_id=doc_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return result


class IndexTextBody(BaseModel):
    content: str
    doc_id: str
    filename: str = ""
    source: str = ""


@router.post("/kb/documents/text")
async def index_text(body: IndexTextBody, request: Request):
    """索引纯文本内容。"""
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="内容不能为空")
    if not body.doc_id.strip():
        raise HTTPException(status_code=400, detail="doc_id 不能为空")

    indexer = _get_indexer(request)
    return indexer.index_text(
        content=body.content,
        doc_id=body.doc_id,
        filename=body.filename,
        source=body.source,
    )


class ImportUrlBody(BaseModel):
    url: str
    doc_id: Optional[str] = None


@router.post("/kb/documents/url")
async def import_url(body: ImportUrlBody, request: Request):
    """从 URL 导入内容（使用 Tavily Extract 提取 Markdown 后索引）。

    若 Tavily 不可用，返回 503。
    """
    if not body.url.strip():
        raise HTTPException(status_code=400, detail="url 不能为空")

    # 使用 Tavily Extract 提取 URL 内容
    try:
        from tools.network.tavily.tool_extract import TavilyExtractTool
    except ImportError:
        raise HTTPException(status_code=503, detail="Tavily Extract 工具不可用")

    extract_tool = TavilyExtractTool()
    try:
        result_str = extract_tool._run(urls=body.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"URL 内容提取失败: {e}")

    # 解析提取结果（tool_extract 返回 JSON 格式的结果）
    import json

    try:
        result_data = json.loads(result_str)
        # 提取 Markdown 内容
        if isinstance(result_data, dict):
            markdown = (
                result_data.get("formatted", "")
                or result_data.get("content", "")
                or result_data.get("markdown", "")
            )
        elif isinstance(result_data, list) and result_data:
            markdown = (
                result_data[0].get("formatted", "")
                or result_data[0].get("content", "")
                or result_data[0].get("markdown", "")
                if isinstance(result_data[0], dict)
                else str(result_data[0])
            )
        else:
            markdown = str(result_data)
    except (json.JSONDecodeError, IndexError, AttributeError):
        markdown = result_str

    if not markdown.strip():
        raise HTTPException(status_code=502, detail="URL 内容提取为空")

    indexer = _get_indexer(request)
    return indexer.index_url(body.url, markdown, doc_id=body.doc_id)


# ── 检索 ──


class SearchBody(BaseModel):
    query: str
    top_k: int = 5
    threshold: float = 0.3


@router.post("/kb/search")
async def search_kb(body: SearchBody, request: Request):
    """检索知识库。"""
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query 不能为空")

    retriever = _get_retriever(request)
    results = retriever.retrieve(
        query=body.query,
        top_k=body.top_k,
        threshold=body.threshold,
    )
    return {
        "query": body.query,
        "count": len(results),
        "items": results,
    }
