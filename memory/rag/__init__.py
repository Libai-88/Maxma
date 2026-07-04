"""RAG 子系统 — 基于 chromadb + ONNX Runtime 的本地向量检索。

模块组成：
- embedding: ONNX Runtime 嵌入引擎（transformers.AutoTokenizer + onnxruntime.InferenceSession），提供懒加载的文本嵌入
- vector_store: chromadb 封装，支持多 collection（长期/情景/语义/知识库）
- indexer: MemoryManager CRUD 钩子，同步索引到向量库

设计要点：
- 所有组件均支持优雅降级：依赖缺失时回退到 bigram Jaccard
- 模型懒加载：首次 embed() 时才下载/加载 ONNX embedding 模型
- 多 collection 隔离：长期记忆、情景记忆、语义记忆、知识库各自独立
- 不依赖 torch / sentence-transformers（体积优化 ~750MB）
"""

from memory.rag.embedding import EmbeddingEngine, get_embedding_engine, reset_embedding_engine
from memory.rag.vector_store import (
    COLLECTION_EPISODIC,
    COLLECTION_KB,
    COLLECTION_LONG_TERM,
    COLLECTION_SEMANTIC,
    VectorStore,
    get_vector_store,
    reset_vector_store,
)

__all__ = [
    "EmbeddingEngine",
    "get_embedding_engine",
    "reset_embedding_engine",
    "VectorStore",
    "get_vector_store",
    "reset_vector_store",
    "COLLECTION_LONG_TERM",
    "COLLECTION_EPISODIC",
    "COLLECTION_SEMANTIC",
    "COLLECTION_KB",
]
