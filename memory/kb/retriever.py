"""KB 检索器 — query → embedding → vector_store.query → 返回 top_k 片段。

向量库不可用时返回空列表（best-effort 降级）。
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class KBRetriever:
    """知识库检索器。"""

    def __init__(self, top_k: int = 5, threshold: float = 0.3):
        """初始化检索器。

        Args:
            top_k: 返回的最大结果数
            threshold: 相似度阈值（0-1，低于此值的结果被过滤）
        """
        self._top_k = top_k
        self._threshold = threshold

    def retrieve(
        self,
        query: str,
        top_k: Optional[int] = None,
        threshold: Optional[float] = None,
    ) -> list[dict]:
        """向量检索知识库。

        Args:
            query: 查询文本
            top_k: 可选，覆盖默认 top_k
            threshold: 可选，覆盖默认阈值

        Returns:
            结果列表，每项包含:
            - chunk_id: 切块 ID
            - text: 切块文本
            - source_doc_id: 所属文档 ID
            - source_filename: 所属文档文件名
            - source_path: 所属文档路径/URL
            - similarity: 相似度（0-1）
        """
        if not query.strip():
            return []

        effective_top_k = top_k or self._top_k
        effective_threshold = threshold if threshold is not None else self._threshold

        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_KB, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                logger.warning("[kb] 向量库或 embedding 引擎不可用，无法检索")
                return []

            embeddings = engine.embed([query])
            if not embeddings:
                return []

            raw = store.query(
                collection=COLLECTION_KB,
                query_embeddings=embeddings,
                n_results=effective_top_k,
            )
            if not raw:
                return []

            results = []
            for hit in raw:
                # chromadb cosine 距离：distance 越小越相似
                distance = hit.get("distance", 1.0)
                similarity = max(0.0, 1.0 - distance)

                if similarity < effective_threshold:
                    continue

                metadata = hit.get("metadata", {})
                results.append(
                    {
                        "chunk_id": hit.get("id", ""),
                        "text": hit.get("document", ""),
                        "source_doc_id": metadata.get("doc_id", ""),
                        "source_filename": metadata.get("filename", ""),
                        "source_path": metadata.get("source_path", metadata.get("source", "")),
                        "similarity": round(similarity, 3),
                        "score_percent": round(similarity * 100, 1),
                    }
                )

            return results
        except Exception as e:
            logger.warning("[kb] 检索失败: %s", e)
            return []

    def retrieve_text(
        self,
        query: str,
        top_k: Optional[int] = None,
        threshold: Optional[float] = None,
    ) -> str:
        """检索并返回可读文本格式（供注入系统提示词或工具输出）。

        Args:
            query: 查询文本
            top_k: 可选，覆盖默认 top_k
            threshold: 可选，覆盖默认阈值

        Returns:
            格式化的检索结果文本，或空字符串
        """
        results = self.retrieve(query, top_k=top_k, threshold=threshold)
        if not results:
            return ""

        lines = ["## 知识库检索结果"]
        for i, r in enumerate(results, 1):
            lines.append(
                f"{i}. [{r['source_filename']}] (相似度 {r['score_percent']}%)"
            )
            # 截断过长的文本
            text = r["text"]
            if len(text) > 300:
                text = text[:300] + "…"
            lines.append(f"   {text}")
        return "\n".join(lines)
