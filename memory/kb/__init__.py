"""通用知识库模块 — 文档加载、切块、索引、检索。

子模块：
- ``document_loader`` — 支持 txt/md/pdf/docx/csv/json 格式
- ``chunker`` — 按 token 数切块 + 重叠
- ``indexer`` — 文档 → 切块 → embedding → chromadb knowledge_base collection
- ``retriever`` — 查询 → embedding → 向量检索 → 返回 top_k 片段
"""

from memory.kb.document_loader import Document, load_document, SUPPORTED_EXTENSIONS
from memory.kb.chunker import Chunk, chunk_document
from memory.kb.indexer import KBIndexer, KB_DOC_META_PATH
from memory.kb.retriever import KBRetriever

__all__ = [
    "Document",
    "load_document",
    "SUPPORTED_EXTENSIONS",
    "Chunk",
    "chunk_document",
    "KBIndexer",
    "KB_DOC_META_PATH",
    "KBRetriever",
]
