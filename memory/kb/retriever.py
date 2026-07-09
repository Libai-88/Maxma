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

    async def retrieve_with_correction(
        self,
        model,
        query: str,
        crag_enabled: bool = False,
        top_k: Optional[int] = None,
        threshold: Optional[float] = None,
        conversation_context: str = "",
    ) -> list[dict]:
        """纠正式检索（CRAG-lite）。

        流程：retrieve → grade → (全不相关时) Tavily 回退
        crag_enabled=False 时退化为普通 retrieve（加 source="kb" 标签）。

        Args:
            model: LLM 模型（用于 grading）
            query: 查询文本
            crag_enabled: 是否启用纠正式检索
            top_k: 可选，覆盖默认 top_k
            threshold: 可选，覆盖默认阈值
            conversation_context: 对话上下文（供查询重写用，本版本暂未启用）

        Returns:
            结果列表，每项额外包含 source 字段（"kb" 或 "web"）
        """
        # 禁用时退化为普通检索
        if not crag_enabled:
            results = self.retrieve(query, top_k=top_k, threshold=threshold)
            for r in results:
                r["source"] = "kb"
            return results

        # Step 1: 普通检索
        raw_results = self.retrieve(query, top_k=top_k, threshold=threshold)

        # Step 2: KB 无结果 → 直接 Tavily 回退
        if not raw_results:
            logger.info("[crag] KB 无结果，触发 Tavily 回退")
            web_results = await self._tavily_fallback(query, max_results=top_k or self._top_k)
            for r in web_results:
                r["source"] = "web"
            return web_results

        # Step 3: grading
        try:
            from memory.kb.grading import grade_documents, filter_relevant

            grades = await grade_documents(model, query, raw_results)
            relevant = filter_relevant(raw_results, grades)

            relevant_ratio = len(relevant) / len(raw_results) if raw_results else 0
            logger.info("[crag] grading: %d/%d relevant (ratio=%.2f)", len(relevant), len(raw_results), relevant_ratio)

            if relevant:
                for r in relevant:
                    r["source"] = "kb"
                return relevant
        except Exception as e:
            logger.warning("[crag] grading 失败，返回原始 KB 结果: %s", e)
            for r in raw_results:
                r["source"] = "kb"
            return raw_results

        # Step 4: 全不相关 → Tavily 回退
        logger.info("[crag] KB 结果全不相关，触发 Tavily 回退")
        web_results = await self._tavily_fallback(query, max_results=top_k or self._top_k)
        for r in web_results:
            r["source"] = "web"
        return web_results

    async def _tavily_fallback(self, query: str, max_results: int = 5) -> list[dict]:
        """Tavily 网络搜索回退。

        KB 无结果或全不相关时调用。失败时返回空列表（不阻塞）。

        Args:
            query: 搜索查询
            max_results: 最大结果数

        Returns:
            结果列表，格式与 retrieve() 一致
        """
        try:
            from config.settings import get_settings

            settings = get_settings()
            api_key = getattr(settings, "tavily_api_key", None)
            if not api_key:
                logger.warning("[crag] TAVILY_API_KEY 未配置，无法回退")
                return []

            from tavily import TavilyClient

            client = TavilyClient(api_key=api_key)
            response = client.search(
                query=query,
                max_results=max_results,
                search_depth="basic",
                include_answer=False,
            )

            results = []
            for hit in response.get("results", []):
                results.append({
                    "chunk_id": f"web_{hit.get('url', '')[:50]}",
                    "text": hit.get("content", hit.get("snippet", "")),
                    "source_doc_id": "",
                    "source_filename": hit.get("title", "web_result")[:100],
                    "source_path": hit.get("url", ""),
                    "similarity": 1.0,
                    "score_percent": 100.0,
                })
            logger.info("[crag] Tavily 回退返回 %d 条结果", len(results))
            return results
        except Exception as e:
            logger.warning("[crag] Tavily 回退失败: %s", e)
            return []
