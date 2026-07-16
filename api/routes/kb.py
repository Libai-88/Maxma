"""REST API — 通用知识库。

memory/ 包已移除，此功能不可用。所有端点返回 503。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/kb/documents")
async def list_documents(request: Request):
    """列出所有已索引文档（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.get("/kb/documents/{doc_id}")
async def get_document(doc_id: str, request: Request):
    """获取单个文档元数据（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.delete("/kb/documents/{doc_id}")
async def delete_document(doc_id: str, request: Request):
    """删除文档及其所有切块（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.post("/kb/documents")
async def upload_document(request: Request):
    """上传文档文件进行索引（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.post("/kb/documents/text")
async def index_text(request: Request):
    """索引纯文本内容（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.post("/kb/documents/url")
async def import_url(request: Request):
    """从 URL 导入内容（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")


@router.post("/kb/search")
async def search_kb(request: Request):
    """检索知识库（不可用）。"""
    raise HTTPException(status_code=503, detail="知识库功能不可用（memory/ 包已移除）")
