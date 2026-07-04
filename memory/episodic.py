"""情景记忆层（Episodic Memory）— 对话快照库。

每轮对话结束生成一个 episode 快照（含 turn_id、timestamp、摘要、原始消息数），
写入 JSON 文件 + chromadb ``episodic`` collection，支持按向量检索历史对话场景。

数据模型::

    {
      "ep_xxxx": {
        "session_id": "sess_xxx",
        "turn_id": "turn_yyy",
        "timestamp": "2026-07-04 12:00:00",
        "summary": "用户询问了天气...",
        "message_count": 4,
        "ttl": 604800,
        "expires_at": "2026-07-11 12:00:00"
      }
    }

默认 TTL 由 ``settings.default_episodic_ttl`` 控制（7 天）。
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


class EpisodicMemoryManager:
    """情景记忆管理器 — JSON 持久化 + chromadb 向量检索。

    Args:
        json_file: JSON 存储路径
        default_ttl: 默认 TTL（秒），None 表示永久
    """

    def __init__(self, json_file: str, default_ttl: Optional[int] = None):
        self._json_file = json_file
        self._default_ttl = default_ttl
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
        return "ep_" + secrets.token_hex(4)

    def _read_all(self) -> dict:
        """读取全部 episode（调用方需持有锁）。"""
        with open(self._json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
        return data

    def _write_all(self, data: dict) -> None:
        """覆写全部 episode（调用方需持有锁）。"""
        with open(self._json_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def add_episode(
        self,
        summary: str,
        session_id: str = "",
        turn_id: str = "",
        message_count: int = 0,
        ttl: Optional[int] = None,
    ) -> str:
        """添加一个对话快照。

        Args:
            summary: 对话摘要文本
            session_id: 会话 ID
            turn_id: 轮次 ID
            message_count: 原始消息数
            ttl: 可选 TTL（秒）；None 时使用管理器默认 TTL

        Returns:
            新建的 episode ID
        """
        effective_ttl = ttl if ttl is not None else self._default_ttl
        expires_at = _compute_expires_at(effective_ttl) if effective_ttl else None
        episode_id = self._generate_id()
        record = {
            "session_id": session_id,
            "turn_id": turn_id,
            "timestamp": _now(),
            "summary": summary,
            "message_count": message_count,
            "ttl": effective_ttl,
            "expires_at": expires_at,
        }
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            data[episode_id] = record
            self._write_all(data)
        # 同步向量库（best-effort）
        self._index_episode(episode_id, summary, record)
        return episode_id

    def _index_episode(
        self, episode_id: str, summary: str, record: dict
    ) -> None:
        """将 episode 写入 chromadb episodic collection（best-effort）。"""
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_EPISODIC, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                return
            embeddings = engine.embed([summary])
            if not embeddings:
                return
            store.upsert(
                collection=COLLECTION_EPISODIC,
                ids=[episode_id],
                embeddings=embeddings,
                documents=[summary],
                metadatas=[{
                    "session_id": record["session_id"],
                    "timestamp": record["timestamp"],
                    "expires_at": record["expires_at"] or "",
                }],
            )
        except Exception as e:
            logger.warning("[episodic] index failed for %s: %s", episode_id, e)

    def _remove_from_vector(self, episode_id: str) -> None:
        """从 chromadb 删除 episode（best-effort）。"""
        try:
            from memory.rag.vector_store import COLLECTION_EPISODIC, get_vector_store

            store = get_vector_store()
            if store is None:
                return
            store.delete(collection=COLLECTION_EPISODIC, ids=[episode_id])
        except Exception as e:
            logger.warning("[episodic] vector remove failed for %s: %s", episode_id, e)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        include_expired: bool = False,
    ) -> list[dict]:
        """按语义相似度检索历史 episode。

        优先使用 chromadb 向量检索；不可用时返回空列表（情景记忆无关键词回退）。

        Args:
            query: 查询文本
            top_k: 返回的最大结果数
            include_expired: True 时包含已过期条目

        Returns:
            episode 字典列表，每项含 id/summary/timestamp/similarity/session_id
        """
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_EPISODIC, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                return []
            embeddings = engine.embed([query])
            if not embeddings:
                return []
            raw_results = store.query(
                collection=COLLECTION_EPISODIC,
                query_embeddings=embeddings,
                n_results=top_k * 2,  # 多取一些用于过滤已过期
            )
            # 加载 JSON 获取完整记录
            with portalocker.Lock(self._lock_path, timeout=5):
                data = self._read_all()
            results = []
            for r in raw_results:
                ep_id = r["id"]
                record = data.get(ep_id, {})
                if not record:
                    continue
                if not include_expired and _is_expired(record.get("expires_at")):
                    continue
                similarity = max(0.0, 1.0 - r["distance"])
                results.append({
                    "id": ep_id,
                    "summary": record.get("summary", r["document"]),
                    "timestamp": record.get("timestamp", ""),
                    "session_id": record.get("session_id", ""),
                    "turn_id": record.get("turn_id", ""),
                    "similarity": round(similarity, 3),
                })
                if len(results) >= top_k:
                    break
            return results
        except Exception as e:
            logger.warning("[episodic] retrieve failed: %s", e)
            return []

    def list_episodes(self, include_expired: bool = False) -> list[dict]:
        """列出所有 episode（按时间倒序）。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
        results = []
        for ep_id, record in data.items():
            if not include_expired and _is_expired(record.get("expires_at")):
                continue
            results.append({
                "id": ep_id,
                "session_id": record.get("session_id", ""),
                "turn_id": record.get("turn_id", ""),
                "timestamp": record.get("timestamp", ""),
                "summary": record.get("summary", ""),
                "message_count": record.get("message_count", 0),
                "ttl": record.get("ttl"),
                "expires_at": record.get("expires_at"),
            })
        results.sort(key=lambda x: x["timestamp"], reverse=True)
        return results

    def delete_episode(self, episode_id: str) -> str:
        """删除指定 episode。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            if episode_id not in data:
                raise ValueError(f"EpisodicMemory: episode {episode_id} not found")
            removed = data.pop(episode_id)
            self._write_all(data)
        self._remove_from_vector(episode_id)
        return removed.get("summary", "")

    def purge_expired(self) -> int:
        """清理所有已过期 episode（JSON + 向量库）。"""
        expired_ids: list[str] = []
        with portalocker.Lock(self._lock_path, timeout=5):
            data = self._read_all()
            for ep_id, record in data.items():
                if _is_expired(record.get("expires_at")):
                    expired_ids.append(ep_id)
            if not expired_ids:
                return 0
            for ep_id in expired_ids:
                data.pop(ep_id, None)
            self._write_all(data)
        for ep_id in expired_ids:
            self._remove_from_vector(ep_id)
        logger.info("[episodic] purged %d expired episode(s)", len(expired_ids))
        return len(expired_ids)
