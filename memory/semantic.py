"""语义记忆层（Semantic Memory）— 结构化事实三元组库。

从对话/文档中抽取 ``subject-predicate-object`` 三元组，去重后写入
JSON 文件 + chromadb ``semantic`` collection，支持按向量检索结构化事实。

数据模型::

    {
      "fact_xxxx": {
        "subject": "用户",
        "predicate": "喜欢",
        "object": "古典音乐",
        "source": "dialogue",
        "timestamp": "2026-07-04 12:00:00",
        "ttl": null,
        "expires_at": null
      }
    }

默认永久存储（知识事实不轻易遗忘）。
优雅降级：chromadb/embedding 不可用时仅写 JSON，跳过向量索引。
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import secrets
from typing import Optional

import portalocker

from memory.memory_manager import _compute_expires_at, _is_expired

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class SemanticMemoryManager:
    """语义记忆管理器 — JSON 持久化 + chromadb 向量检索。

    Args:
        json_file: JSON 存储路径
    """

    def __init__(self, json_file: str):
        self._json_file = json_file
        self._ensure_file_exists()

    def _ensure_file_exists(self) -> None:
        dir_path = os.path.dirname(self._json_file)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)
        if not os.path.exists(self._json_file):
            with open(self._json_file, "w", encoding="utf-8") as f:
                json.dump({}, f, ensure_ascii=False, indent=2)

    @property
    def _lock_path(self) -> str:
        return self._json_file + ".lock"

    @staticmethod
    def _generate_id() -> str:
        return "fact_" + secrets.token_hex(4)

    def _read_all(self) -> dict:
        with open(self._json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        return data

    def _write_all(self, data: dict) -> None:
        with open(self._json_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _fact_text(self, subject: str, predicate: str, obj: str) -> str:
        """将三元组渲染为可读文本（用于 embedding 和展示）。"""
        return f"{subject} {predicate} {obj}"

    def add_fact(
        self,
        subject: str,
        predicate: str,
        obj: str,
        source: str = "dialogue",
        ttl: Optional[int] = None,
    ) -> str:
        """添加一个事实三元组。

        若已有相同 (subject, predicate, object) 的事实，则更新 timestamp 而非重复创建。

        Args:
            subject: 主体（如「用户」）
            predicate: 谓词（如「喜欢」）
            obj: 客体（如「古典音乐」）
            source: 来源（dialogue/document/manual）
            ttl: 可选 TTL（秒），None 表示永久

        Returns:
            事实 ID（新建或已存在的）
        """
        fact_id = self._generate_id()
        expires_at = _compute_expires_at(ttl) if ttl else None
        record = {
            "subject": subject,
            "predicate": predicate,
            "object": obj,
            "source": source,
            "timestamp": _now(),
            "ttl": ttl,
            "expires_at": expires_at,
        }
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            # 去重：检查是否已有相同三元组
            for existing_id, existing in data.items():
                if (
                    existing.get("subject") == subject
                    and existing.get("predicate") == predicate
                    and existing.get("object") == obj
                ):
                    # 更新 timestamp 和 source
                    existing["timestamp"] = record["timestamp"]
                    existing["source"] = source
                    if ttl is not None:
                        existing["ttl"] = ttl
                        existing["expires_at"] = expires_at
                    self._write_all(data)
                    # 同步向量库
                    self._index_fact(
                        existing_id,
                        self._fact_text(subject, predicate, obj),
                        existing,
                    )
                    return existing_id
            # 新建
            data[fact_id] = record
            self._write_all(data)
        # 同步向量库
        self._index_fact(fact_id, self._fact_text(subject, predicate, obj), record)
        return fact_id

    def _index_fact(self, fact_id: str, fact_text: str, record: dict) -> None:
        """将事实写入 chromadb semantic collection（best-effort）。"""
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_SEMANTIC, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                return
            embeddings = engine.embed([fact_text])
            if not embeddings:
                return
            store.upsert(
                collection=COLLECTION_SEMANTIC,
                ids=[fact_id],
                embeddings=embeddings,
                documents=[fact_text],
                metadatas=[{
                    "subject": record["subject"],
                    "predicate": record["predicate"],
                    "timestamp": record["timestamp"],
                    "expires_at": record.get("expires_at") or "",
                }],
            )
        except Exception as e:
            logger.warning("[semantic] index failed for %s: %s", fact_id, e)

    def _remove_from_vector(self, fact_id: str) -> None:
        """从 chromadb 删除事实（best-effort）。"""
        try:
            from memory.rag.vector_store import COLLECTION_SEMANTIC, get_vector_store

            store = get_vector_store()
            if store is None:
                return
            store.delete(collection=COLLECTION_SEMANTIC, ids=[fact_id])
        except Exception as e:
            logger.warning("[semantic] vector remove failed for %s: %s", fact_id, e)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        include_expired: bool = False,
    ) -> list[dict]:
        """按语义相似度检索事实。

        优先使用 chromadb 向量检索；不可用时回退到关键词匹配。
        """
        # 向量检索
        vector_results = self._retrieve_vector(query, top_k, include_expired)
        if vector_results is not None:
            return vector_results
        # 回退到关键词匹配
        return self._retrieve_keyword(query, top_k, include_expired)

    def _retrieve_vector(
        self, query: str, top_k: int, include_expired: bool
    ) -> list[dict] | None:
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_SEMANTIC, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                return None
            embeddings = engine.embed([query])
            if not embeddings:
                return None
            raw_results = store.query(
                collection=COLLECTION_SEMANTIC,
                query_embeddings=embeddings,
                n_results=top_k * 2,
            )
            with portalocker.Lock(self._lock_path, timeout=5):
                data = self._read_all()
            results = []
            for r in raw_results:
                fact_id = r["id"]
                record = data.get(fact_id, {})
                if not record:
                    continue
                if not include_expired and _is_expired(record.get("expires_at")):
                    continue
                similarity = max(0.0, 1.0 - r["distance"])
                results.append({
                    "id": fact_id,
                    "subject": record.get("subject", ""),
                    "predicate": record.get("predicate", ""),
                    "object": record.get("object", ""),
                    "source": record.get("source", ""),
                    "timestamp": record.get("timestamp", ""),
                    "similarity": round(similarity, 3),
                })
                if len(results) >= top_k:
                    break
            return results
        except Exception as e:
            logger.warning("[semantic] vector retrieve failed: %s", e)
            return None

    def _retrieve_keyword(
        self, query: str, top_k: int, include_expired: bool
    ) -> list[dict]:
        """关键词匹配回退方案。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
        kw = query.lower()
        results = []
        for fact_id, record in data.items():
            if not include_expired and _is_expired(record.get("expires_at")):
                continue
            fact_text = self._fact_text(
                record.get("subject", ""),
                record.get("predicate", ""),
                record.get("object", ""),
            )
            if kw in fact_text.lower():
                results.append({
                    "id": fact_id,
                    "subject": record.get("subject", ""),
                    "predicate": record.get("predicate", ""),
                    "object": record.get("object", ""),
                    "source": record.get("source", ""),
                    "timestamp": record.get("timestamp", ""),
                    "similarity": 1.0,  # 关键词命中视为最高
                })
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        return results[:top_k]

    def list_facts(self, include_expired: bool = False) -> list[dict]:
        """列出所有事实（按时间倒序）。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
        results = []
        for fact_id, record in data.items():
            if not include_expired and _is_expired(record.get("expires_at")):
                continue
            results.append({
                "id": fact_id,
                "subject": record.get("subject", ""),
                "predicate": record.get("predicate", ""),
                "object": record.get("object", ""),
                "source": record.get("source", ""),
                "timestamp": record.get("timestamp", ""),
                "ttl": record.get("ttl"),
                "expires_at": record.get("expires_at"),
            })
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        return results

    def delete_fact(self, fact_id: str) -> str:
        """删除指定事实。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            if fact_id not in data:
                raise ValueError(f"SemanticMemory: fact {fact_id} not found")
            removed = data.pop(fact_id)
            self._write_all(data)
        self._remove_from_vector(fact_id)
        return self._fact_text(
            removed.get("subject", ""),
            removed.get("predicate", ""),
            removed.get("object", ""),
        )

    def purge_expired(self) -> int:
        """清理所有已过期事实。"""
        expired_ids: list[str] = []
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            for fact_id, record in data.items():
                if _is_expired(record.get("expires_at")):
                    expired_ids.append(fact_id)
            if not expired_ids:
                return 0
            for fact_id in expired_ids:
                data.pop(fact_id, None)
            self._write_all(data)
        for fact_id in expired_ids:
            self._remove_from_vector(fact_id)
        logger.info("[semantic] purged %d expired fact(s)", len(expired_ids))
        return len(expired_ids)
