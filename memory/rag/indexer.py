"""记忆索引器 — MemoryManager CRUD 钩子 → embedding → vector_store.upsert。

所有方法均为 best-effort：失败时记录日志但不抛异常，避免影响主 YAML 操作。
向量索引与 YAML 存储相互独立，向量库不可用时 YAML 操作照常进行。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from memory.rag.embedding import get_embedding_engine
from memory.rag.vector_store import COLLECTION_LONG_TERM, get_vector_store

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from memory.memory_manager import MemoryItem


def index_memory(memory_id: str, description: str, theme: str) -> None:
    """新增/更新记忆时同步索引到向量库。

    Args:
        memory_id: 记忆 ID（同时作为向量 ID）
        description: 记忆描述文本
        theme: 记忆分区（存入 metadata，支持过滤检索）
    """
    engine = get_embedding_engine()
    store = get_vector_store()
    if engine is None or store is None:
        return
    try:
        embeddings = engine.embed([description])
        if not embeddings:
            return
        store.upsert(
            collection=COLLECTION_LONG_TERM,
            ids=[memory_id],
            embeddings=embeddings,
            documents=[description],
            metadatas=[{"theme": theme}],
        )
    except Exception as e:
        logger.warning("[rag] index_memory failed for %s: %s", memory_id, e)


def remove_memory(memory_id: str) -> None:
    """删除记忆时从向量库移除。

    Args:
        memory_id: 记忆 ID
    """
    store = get_vector_store()
    if store is None:
        return
    try:
        store.delete(collection=COLLECTION_LONG_TERM, ids=[memory_id])
    except Exception as e:
        logger.warning("[rag] remove_memory failed for %s: %s", memory_id, e)


def reindex_all(items: dict[str, "MemoryItem"]) -> int:
    """全量重建索引（用于迁移现有记忆到向量库）。

    Args:
        items: memory_id -> MemoryItem 的映射

    Returns:
        成功索引的条目数
    """
    engine = get_embedding_engine()
    store = get_vector_store()
    if engine is None or store is None:
        return 0
    if not items:
        return 0
    try:
        ids = list(items.keys())
        descriptions = [item.description for item in items.values()]
        themes = [item.theme for item in items.values()]
        embeddings = engine.embed(descriptions)
        if len(embeddings) != len(ids):
            logger.warning("[rag] reindex embedding count mismatch")
            return 0
        store.upsert(
            collection=COLLECTION_LONG_TERM,
            ids=ids,
            embeddings=embeddings,
            documents=descriptions,
            metadatas=[{"theme": t} for t in themes],
        )
        logger.info("[rag] reindexed %d memories", len(ids))
        return len(ids)
    except Exception as e:
        logger.warning("[rag] reindex_all failed: %s", e)
        return 0
