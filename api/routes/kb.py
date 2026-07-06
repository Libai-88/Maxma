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

import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from memory.kb.document_loader import SUPPORTED_EXTENSIONS
from memory.kb.indexer import KBIndexer
from memory.kb.retriever import KBRetriever

logger = logging.getLogger(__name__)
router = APIRouter()

# 文件大小限制：50MB（防止内存耗尽）
MAX_FILE_SIZE = 50 * 1024 * 1024


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


def _parse_tavily_result(result_str: str) -> str:
    """解析 Tavily Extract 返回的 JSON，提取 Markdown 文本。

    kb.py 和 tool_kb_add.py 共用此函数。
    """
    import json

    try:
        result_data = json.loads(result_str)
        if isinstance(result_data, dict):
            return (
                result_data.get("formatted", "")
                or result_data.get("content", "")
                or result_data.get("markdown", "")
            )
        elif isinstance(result_data, list) and result_data:
            first = result_data[0]
            if isinstance(first, dict):
                return (
                    first.get("formatted", "")
                    or first.get("content", "")
                    or first.get("markdown", "")
                )
            return str(first)
    except (json.JSONDecodeError, IndexError, AttributeError):
        pass
    return result_str


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
    """删除文档及其所有切块（幂等：删除不存在的文档返回 200）。"""
    indexer = _get_indexer(request)
    # 幂等删除：即使文档不存在也返回成功
    indexer.delete_document(doc_id)
    return {"status": "deleted", "doc_id": doc_id}


@router.post("/kb/documents")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    doc_id: Optional[str] = None,
):
    """上传文档文件进行索引。

    支持的文件类型：txt, md, markdown, pdf, docx, csv, json
    文件大小限制：50MB
    """
    # 检查文件扩展名
    filename = file.filename or "unknown"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext}（支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}）",
        )

    # 读取文件内容（带大小限制）
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大（{len(content)} bytes），最大支持 {MAX_FILE_SIZE // (1024 * 1024)}MB",
        )

    # 保存到 KB_DIR（使用 UUID 避免文件名冲突）
    from app_paths import KB_DIR

    safe_filename = filename.replace("/", "_").replace("\\", "_")
    # 用 UUID 前缀避免同名文件互相覆盖
    unique_filename = f"{uuid.uuid4().hex[:8]}_{safe_filename}"
    save_path = KB_DIR / unique_filename
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
    Tavily 调用通过 asyncio.to_thread 异步化，避免阻塞事件循环。
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
        # 异步化同步调用，避免阻塞事件循环
        result_str = await asyncio.to_thread(extract_tool._run, urls=body.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"URL 内容提取失败: {e}")

    markdown = _parse_tavily_result(result_str)

    if not markdown.strip():
        raise HTTPException(status_code=502, detail="URL 内容提取为空")

    indexer = _get_indexer(request)
    return indexer.index_url(body.url, markdown, doc_id=body.doc_id)


# ── 检索 ──


class SearchBody(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)
    threshold: float = Field(default=0.3, ge=0.0, le=1.0)


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
