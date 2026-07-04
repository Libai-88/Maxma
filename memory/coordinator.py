"""4 层记忆协调器 — 统一对外检索接口。

聚合 4 层记忆的检索结果：

- **短期（ShortTerm）**：当前对话上下文，由 ``MemorySaver`` checkpointer 管理，
  本协调器不直接读取（由 ``agent/graph.py`` 注入到 AgentState.messages）。
- **长期（LongTerm）**：用户画像/偏好/重要事件，YAML + chromadb ``long_term_memory`` collection。
- **情景（Episodic）**：对话快照库，JSON + chromadb ``episodic`` collection。
- **语义（Semantic）**：结构化事实三元组，JSON + chromadb ``semantic`` collection。

用法::

    from memory.coordinator import MemoryCoordinator

    coordinator = MemoryCoordinator(
        long_term_mm=mm,
        episodic_mm=episodic_mm,
        semantic_mm=semantic_mm,
    )
    results = coordinator.retrieve(
        query="用户喜欢什么音乐",
        layers=["long", "episodic", "semantic"],
    )
"""

from __future__ import annotations

import logging
from typing import Optional

from memory.episodic import EpisodicMemoryManager
from memory.memory_manager import MemoryManager
from memory.semantic import SemanticMemoryManager

logger = logging.getLogger(__name__)

VALID_LAYERS = {"short", "long", "episodic", "semantic"}


class MemoryCoordinator:
    """4 层记忆协调器。

    Args:
        long_term_mm: 长期记忆管理器（可选，None 时跳过该层）
        episodic_mm: 情景记忆管理器（可选）
        semantic_mm: 语义记忆管理器（可选）
    """

    def __init__(
        self,
        long_term_mm: Optional[MemoryManager] = None,
        episodic_mm: Optional[EpisodicMemoryManager] = None,
        semantic_mm: Optional[SemanticMemoryManager] = None,
    ):
        self.long_term_mm = long_term_mm
        self.episodic_mm = episodic_mm
        self.semantic_mm = semantic_mm

    def retrieve(
        self,
        query: str,
        layers: Optional[list[str]] = None,
        top_k: int = 5,
        threshold: float = 0.6,
    ) -> dict:
        """跨层检索记忆。

        Args:
            query: 查询文本
            layers: 要检索的层列表（如 ``["long", "episodic", "semantic"]``）；
                    None 时检索所有可用层（不含 short，short 由 graph 注入）
            top_k: 每层返回的最大结果数
            threshold: 长期记忆相似度阈值

        Returns:
            按层分组的检索结果::

                {
                  "long": [...],
                  "episodic": [...],
                  "semantic": [...],
                }
        """
        if layers is None:
            layers = ["long", "episodic", "semantic"]
        # 校验层名
        invalid = set(layers) - VALID_LAYERS
        if invalid:
            logger.warning("[coordinator] invalid layers: %s", invalid)
            layers = [l for l in layers if l in VALID_LAYERS]

        results: dict[str, list] = {}

        # 短期记忆不在此检索（由 graph 注入）
        if "short" in layers:
            results["short"] = []  # 占位，实际由 graph 提供

        if "long" in layers and self.long_term_mm is not None:
            try:
                long_results = self.long_term_mm.find_similar(
                    query, theme="", threshold=threshold
                )
                results["long"] = long_results[:top_k]
            except Exception as e:
                logger.warning("[coordinator] long-term retrieve failed: %s", e)
                results["long"] = []

        if "episodic" in layers and self.episodic_mm is not None:
            try:
                results["episodic"] = self.episodic_mm.retrieve(query, top_k=top_k)
            except Exception as e:
                logger.warning("[coordinator] episodic retrieve failed: %s", e)
                results["episodic"] = []

        if "semantic" in layers and self.semantic_mm is not None:
            try:
                results["semantic"] = self.semantic_mm.retrieve(query, top_k=top_k)
            except Exception as e:
                logger.warning("[coordinator] semantic retrieve failed: %s", e)
                results["semantic"] = []

        return results

    def retrieve_text(
        self,
        query: str,
        layers: Optional[list[str]] = None,
        top_k: int = 5,
        threshold: float = 0.6,
    ) -> str:
        """检索并格式化为可读文本（供注入系统提示词）。

        格式::

            ## 长期记忆
            - [id] (theme) description (相似度 85%)
            ## 情景记忆
            - [timestamp] summary (相似度 78%)
            ## 语义记忆
            - subject predicate object (相似度 92%)
        """
        results = self.retrieve(query, layers, top_k, threshold)
        lines: list[str] = []

        if results.get("long"):
            lines.append("## 长期记忆")
            for item in results["long"]:
                sim = item.get("similarity", 0)
                lines.append(
                    f"- [{item.get('id', '')}] ({item.get('theme', '')}) "
                    f"{item.get('description', '')} (相似度 {sim:.0%})"
                )
            lines.append("")

        if results.get("episodic"):
            lines.append("## 情景记忆")
            for item in results["episodic"]:
                sim = item.get("similarity", 0)
                lines.append(
                    f"- [{item.get('timestamp', '')}] "
                    f"{item.get('summary', '')} (相似度 {sim:.0%})"
                )
            lines.append("")

        if results.get("semantic"):
            lines.append("## 语义记忆")
            for item in results["semantic"]:
                sim = item.get("similarity", 0)
                lines.append(
                    f"- {item.get('subject', '')} {item.get('predicate', '')} "
                    f"{item.get('object', '')} (相似度 {sim:.0%})"
                )
            lines.append("")

        return "\n".join(lines).strip()

    def purge_all_expired(self) -> dict[str, int]:
        """清理所有层的已过期条目。

        Returns:
            各层清理数量，如 ``{"long": 2, "episodic": 5, "semantic": 0}``
        """
        purged: dict[str, int] = {}
        if self.long_term_mm is not None:
            try:
                purged["long"] = self.long_term_mm.purge_expired()
            except Exception as e:
                logger.warning("[coordinator] long-term purge failed: %s", e)
                purged["long"] = 0
        if self.episodic_mm is not None:
            try:
                purged["episodic"] = self.episodic_mm.purge_expired()
            except Exception as e:
                logger.warning("[coordinator] episodic purge failed: %s", e)
                purged["episodic"] = 0
        if self.semantic_mm is not None:
            try:
                purged["semantic"] = self.semantic_mm.purge_expired()
            except Exception as e:
                logger.warning("[coordinator] semantic purge failed: %s", e)
                purged["semantic"] = 0
        return purged
