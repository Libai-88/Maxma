"""chromadb 向量存储封装。

支持多 collection 隔离：
- ``long_term_memory``: 长期记忆（与 YAML 同步）
- ``episodic``: 情景记忆（4 层架构，子任务 1.2）
- ``semantic``: 语义记忆（4 层架构，子任务 1.2）
- ``knowledge_base``: 知识库（子任务 1.4）

持久化路径：``DATA_DIR/vector_db``（见 ``app_paths.VECTOR_DB_DIR``）
距离度量：cosine（归一化向量下等价于内积）

优雅降级：chromadb 未安装时 ``get_vector_store()`` 返回 None。
"""

from __future__ import annotations

import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

# ── Collection 名称常量 ──
COLLECTION_LONG_TERM = "long_term_memory"
COLLECTION_EPISODIC = "episodic"
COLLECTION_SEMANTIC = "semantic"
COLLECTION_KB = "knowledge_base"

ALL_COLLECTIONS = [
    COLLECTION_LONG_TERM,
    COLLECTION_EPISODIC,
    COLLECTION_SEMANTIC,
    COLLECTION_KB,
]

# 全局单例
_store: "VectorStore | None" = None
_tried_init: bool = False
_init_lock = threading.Lock()  # 保护单例初始化（修复竞态：原实现两线程可同时进入 init）


class VectorStore:
    """chromadb 向量存储封装。"""

    def __init__(self, persist_dir: str):
        import chromadb

        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collections: dict[str, Any] = {}
        logger.info("[rag] vector store initialized at %s", persist_dir)

    def _get_collection(self, name: str):
        """获取或创建 collection（cosine 距离）。"""
        if name not in self._collections:
            self._collections[name] = self._client.get_or_create_collection(
                name=name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collections[name]

    def upsert(
        self,
        collection: str,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict] | None = None,
    ) -> None:
        """插入或更新向量。

        Args:
            collection: collection 名称
            ids: 向量 ID 列表
            embeddings: 嵌入向量列表
            documents: 原文列表
            metadatas: 元数据列表（如 theme、expires_at）
        """
        coll = self._get_collection(collection)
        coll.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas or [{}] * len(ids),
        )

    def delete(self, collection: str, ids: list[str]) -> None:
        """按 ID 删除向量。"""
        coll = self._get_collection(collection)
        coll.delete(ids=ids)

    def query(
        self,
        collection: str,
        query_embeddings: list[list[float]],
        n_results: int = 5,
        where: dict | None = None,
    ) -> list[dict]:
        """向量检索。

        Args:
            collection: collection 名称
            query_embeddings: 查询向量列表（通常只有一条）
            n_results: 每条查询返回的最大结果数
            where: 元数据过滤条件（如 {"theme": "身份"}）

        Returns:
            第一条 query 的结果列表，每项包含 id/document/metadata/distance
        """
        coll = self._get_collection(collection)
        result = coll.query(
            query_embeddings=query_embeddings,
            n_results=n_results,
            where=where,
        )
        # 整理为扁平结构（只取第一条 query 的结果）
        ids_list = result.get("ids", [[]])
        docs_list = result.get("documents", [[]])
        metas_list = result.get("metadatas", [[]])
        dists_list = result.get("distances", [[]])

        flattened = []
        if ids_list and ids_list[0]:
            for i, id_ in enumerate(ids_list[0]):
                flattened.append(
                    {
                        "id": id_,
                        "document": (
                            docs_list[0][i]
                            if docs_list and i < len(docs_list[0])
                            else ""
                        ),
                        "metadata": (
                            metas_list[0][i]
                            if metas_list and i < len(metas_list[0])
                            else {}
                        ),
                        "distance": (
                            dists_list[0][i]
                            if dists_list and i < len(dists_list[0])
                            else 0.0
                        ),
                    }
                )
        return flattened

    def count(self, collection: str) -> int:
        """返回 collection 中的向量数量。"""
        coll = self._get_collection(collection)
        return coll.count()

    def purge_expired(self, collection: str, before_timestamp: str) -> int:
        """删除 expires_at < before_timestamp 的条目。

        Args:
            collection: collection 名称
            before_timestamp: ISO 格式时间戳字符串

        Returns:
            删除的条目数
        """
        coll = self._get_collection(collection)
        try:
            result = coll.get(where={"expires_at": {"$lt": before_timestamp}})
            ids_to_delete = result.get("ids", [])
            if ids_to_delete:
                coll.delete(ids=ids_to_delete)
                logger.info(
                    "[rag] purged %d expired items from %s",
                    len(ids_to_delete),
                    collection,
                )
                return len(ids_to_delete)
        except Exception as e:
            logger.warning("[rag] purge_expired failed on %s: %s", collection, e)
        return 0


def get_vector_store() -> "VectorStore | None":
    """获取全局 VectorStore 单例。

    若 chromadb 未安装或初始化失败，返回 None，
    调用方应回退到基于关键词的相似度计算。

    线程安全：通过 _init_lock 保证仅初始化一次（修复 Bug 1.1 单例竞态）。

    Returns:
        VectorStore 实例，或 None（依赖不可用）
    """
    global _store, _tried_init
    # 双重检查：已初始化则直接返回，避免每次都抢锁
    if _store is not None or _tried_init:
        return _store
    with _init_lock:
        # 二次检查：可能在等锁期间已被其他线程初始化
        if _store is not None or _tried_init:
            return _store
        try:
            import chromadb  # noqa: F401
        except ImportError:
            logger.warning(
                "[rag] chromadb 未安装，find_similar 将回退到 bigram Jaccard。"
                " 安装依赖: pip install chromadb"
            )
            _tried_init = True  # 依赖缺失是环境问题，重试无意义
            return None
        try:
            from app_paths import VECTOR_DB_DIR

            VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)
            _store = VectorStore(persist_dir=str(VECTOR_DB_DIR))
            _tried_init = True  # 成功才标记，失败时允许后续重试
            return _store
        except Exception as e:
            # 不设置 _tried_init = True，允许后续重试
            logger.warning("[rag] vector store init failed (will retry on next call): %s", e)
            return None


def reset_vector_store() -> None:
    """重置 store 单例（仅用于测试）。

    线程安全：在 _init_lock 内重置，避免与正在进行的初始化竞争。
    """
    global _store, _tried_init
    with _init_lock:
        _store = None
        _tried_init = False
