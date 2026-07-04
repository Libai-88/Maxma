import datetime
import logging
import os
import re
import secrets
import threading
from typing import Optional

import portalocker
import yaml

logger = logging.getLogger(__name__)

MAX_DESC_LENGTH = 150
"""记忆描述最大字数限制，超过此长度的创建/更新/合并请求将被驳回。"""

MAX_HISTORY_LENGTH = 5
"""单条记忆保留的最大历史记录条数，超出时丢弃最早的记录。"""

# 已自动重建索引的 yaml 文件路径集合（避免重复 reindex）
# 修复 Bug 1.3：原 set 的 in/add 操作无锁保护，并发场景下两线程可能同时通过
# `if x in _auto_reindexed` 检查并重复执行 reindex。现在用 threading.Lock 保护。
_auto_reindexed: set[str] = set()
_auto_reindexed_lock = threading.Lock()


def NOW() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _compute_expires_at(ttl_seconds: int) -> str:
    """根据 TTL 秒数计算绝对过期时间字符串。"""
    expires_dt = datetime.datetime.now() + datetime.timedelta(seconds=ttl_seconds)
    return expires_dt.strftime("%Y-%m-%d %H:%M:%S")


def _is_expired(expires_at: Optional[str]) -> bool:
    """判断 expires_at 是否已过期。None 表示永久，未过期。"""
    if not expires_at:
        return False
    try:
        expires_dt = datetime.datetime.strptime(expires_at, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    return datetime.datetime.now() >= expires_dt


class MemoryItem:
    def __init__(self, description: str, theme: str, **kwargs):
        self.description: str = description
        self.theme: str = theme
        self.history: list[dict] = kwargs.get("history", [])
        self.latest_update_time: str = kwargs.get("latest_update_time", NOW())
        # TTL 遗忘机制：ttl=秒数（None 表示永久），expires_at=绝对过期时间
        self.ttl: Optional[int] = kwargs.get("ttl")
        self.expires_at: Optional[str] = kwargs.get("expires_at")

    def update(
        self,
        reason: str,
        new_description: Optional[str] = None,
        new_theme: Optional[str] = None,
        new_ttl: Optional[int] = None,
    ):
        new_history = {"reason": reason}
        if new_description is not None:
            new_history["new_description"] = new_description
            new_history["old_description"] = self.description
            self.description = new_description
        if new_theme is not None:
            new_history["new_theme"] = new_theme
            new_history["old_theme"] = self.theme
            self.theme = new_theme
        new_history["old_time"] = self.latest_update_time
        self.latest_update_time = NOW()
        self.history.append(new_history)
        # 裁剪：保留最近 MAX_HISTORY_LENGTH 条，丢弃最早的
        if len(self.history) > MAX_HISTORY_LENGTH:
            self.history = self.history[-MAX_HISTORY_LENGTH:]
        # TTL 处理：new_ttl=None 表示保留原过期时间；new_ttl=0 表示改为永久；
        # new_ttl>0 表示重置过期时间
        if new_ttl is not None:
            self.ttl = new_ttl if new_ttl > 0 else None
            self.expires_at = _compute_expires_at(new_ttl) if new_ttl > 0 else None

    def show_description_history(self) -> list[dict]:
        """返回描述历史记录及时间（从当前到最早）。

        第一项为当前 description 和 latest_update_time，
        随后从 history 中逆序取有 old_description 的条目。
        """
        result = [{"description": self.description, "time": self.latest_update_time}]
        for entry in reversed(self.history):
            if "old_description" in entry:
                result.append(
                    {
                        "description": entry["old_description"],
                        "time": entry["old_time"],
                    }
                )
        return result

    def merge(
        self,
        another: "MemoryItem",
        reason: str,
        merged_description: str,
        merged_theme: str,
    ):
        self.history += another.history
        self.update(reason, merged_description, merged_theme)


class MemoryManager:
    def __init__(self, yaml_file: str):
        self._yaml_file = yaml_file
        self._ensure_file_exists()

    _UUID_PATTERN = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )

    def _ensure_file_exists(self) -> None:
        dir_path = os.path.dirname(self._yaml_file)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)
        if not os.path.exists(self._yaml_file):
            with open(self._yaml_file, "w", encoding="utf-8") as f:
                yaml.dump({}, f, default_flow_style=False, allow_unicode=True)

    def _maybe_migrate_old_ids(self) -> None:
        """将 YAML 中旧版 UUID key 原地迁移为短十六进制 ID。调用方必须已持有文件锁。"""
        with open(self._yaml_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        old_keys = [k for k in data if self._UUID_PATTERN.match(k)]
        if not old_keys:
            return
        new_data = {}
        for old_key in old_keys:
            new_key = self._generate_id()
            while new_key in new_data:
                new_key = self._generate_id()
            new_data[new_key] = data[old_key]
        for k, v in data.items():
            if k not in old_keys:
                new_data[k] = v
        with open(self._yaml_file, "w", encoding="utf-8") as f:
            yaml.dump(new_data, f, default_flow_style=False, allow_unicode=True)
        print(f"[memory] migrated {len(old_keys)} UUID keys to short hex IDs")

    def _read_all(self) -> dict[str, "MemoryItem"]:
        """读取完整文件。调用方必须已持有文件锁。"""
        self._maybe_migrate_old_ids()
        with open(self._yaml_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            logger.warning("[memory] invalid top-level YAML structure in %s", self._yaml_file)
            return {}

        items: dict[str, MemoryItem] = {}
        for item_id, raw in data.items():
            if not isinstance(raw, dict):
                logger.warning(
                    "[memory] skipping invalid item %s in %s: expected dict, got %s",
                    item_id,
                    self._yaml_file,
                    type(raw).__name__,
                )
                continue
            try:
                items[item_id] = MemoryItem(**raw)
            except TypeError as exc:
                logger.warning(
                    "[memory] skipping invalid item %s in %s: %s",
                    item_id,
                    self._yaml_file,
                    exc,
                )
        return items

    def _write_all(self, items: dict[str, "MemoryItem"]) -> None:
        """覆写完整文件。调用方必须已持有文件锁。"""
        data_dict = {id: item.__dict__ for id, item in items.items()}
        with open(self._yaml_file, "w", encoding="utf-8") as f:
            yaml.dump(data_dict, f, default_flow_style=False, allow_unicode=True)

    @staticmethod
    def _generate_id() -> str:
        return secrets.token_hex(4)

    @property
    def _lock_path(self) -> str:
        return self._yaml_file + ".lock"

    def add(self, description: str, theme: str, ttl: Optional[int] = None) -> str:
        """添加一条新记忆。

        Args:
            description: 记忆内容
            theme: 分区
            ttl: 可选 TTL（秒），None 表示永久；>0 时按此秒数计算过期时间
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            new_id = self._generate_id()
            expires_at = _compute_expires_at(ttl) if ttl and ttl > 0 else None
            items[new_id] = MemoryItem(
                description,
                theme,
                ttl=ttl if ttl and ttl > 0 else None,
                expires_at=expires_at,
            )
            self._write_all(items)
        # 同步索引到向量库（best-effort，不影响主操作）
        from memory.rag.indexer import index_memory
        index_memory(new_id, description, theme)
        return new_id

    def delete(self, id: str) -> str:
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            if id not in items:
                raise ValueError(f"MemoryManager: Memory item with ID {id} not found")
            removed = items.pop(id)
            self._write_all(items)
        # 从向量库移除（best-effort）
        from memory.rag.indexer import remove_memory
        remove_memory(id)
        return removed.description

    def merge(
        self,
        id1: str,
        id2: str,
        merged_description: str,
        merged_theme: str,
        reason: str,
    ):
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            if id1 not in items or id2 not in items:
                raise ValueError(
                    f"MemoryManager: Memory items with IDs {id1} and {id2} not found"
                )
            items[id1].merge(items[id2], reason, merged_description, merged_theme)
            items.pop(id2)
            self._write_all(items)
        # 同步向量库：移除 id2，更新 id1
        from memory.rag.indexer import index_memory, remove_memory
        remove_memory(id2)
        index_memory(id1, merged_description, merged_theme)

    def update(
        self,
        id: str,
        reason: str,
        new_description: Optional[str] = None,
        new_theme: Optional[str] = None,
        new_ttl: Optional[int] = None,
    ):
        """更新一条记忆。

        Args:
            id: 条目 ID
            reason: 修改原因
            new_description: 新描述（None 表示不修改）
            new_theme: 新分区（None 表示不修改）
            new_ttl: 新 TTL（None 表示保留原过期时间；0 表示改为永久；>0 表示重置）
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            if id not in items:
                raise ValueError(f"MemoryManager: Memory item with ID {id} not found")
            items[id].update(reason, new_description, new_theme, new_ttl)
            self._write_all(items)
        # 同步索引到向量库（best-effort）
        from memory.rag.indexer import index_memory
        index_memory(id, items[id].description, items[id].theme)

    def show(self, include_expired: bool = False):
        """整理为大模型易于理解的形式，包含更新时间供排序。

        Args:
            include_expired: True 时包含已过期但尚未清理的条目（默认 False 过滤掉）
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            return [
                {
                    "id": id,
                    "description": item.description,
                    "theme": item.theme,
                    "latest_update_time": item.latest_update_time,
                    "ttl": item.ttl,
                    "expires_at": item.expires_at,
                }
                for id, item in items.items()
                if include_expired or not _is_expired(item.expires_at)
            ]

    def get_memories_grouped(self, include_expired: bool = False) -> dict:
        """按 theme 分组返回记忆数据，用于 Vignette 前端瀑布流展示。

        Args:
            include_expired: True 时包含已过期但尚未清理的条目（默认 False 过滤掉）
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            groups: dict[str, list[dict]] = {}
            for id, item in items.items():
                if not include_expired and _is_expired(item.expires_at):
                    continue
                theme = item.theme
                if theme not in groups:
                    groups[theme] = []
                groups[theme].append(
                    {
                        "id": id,
                        "description": item.description,
                        "history": item.show_description_history(),
                        "ttl": item.ttl,
                        "expires_at": item.expires_at,
                        "_sort_time": item.latest_update_time,
                    }
                )
            # 每组内按更新时间倒序
            for theme in groups:
                groups[theme].sort(key=lambda x: x["_sort_time"], reverse=True)
                for entry in groups[theme]:
                    del entry["_sort_time"]
            # 分区间按条目数降序
            sections = [
                {"theme": theme, "items": items}
                for theme, items in sorted(
                    groups.items(), key=lambda x: len(x[1]), reverse=True
                )
            ]
            return {"sections": sections}

    def show_description_history(self, id: str) -> list[dict]:
        """返回指定条目的描述变更历史（从当前到最早）。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            if id not in items:
                raise ValueError(f"MemoryManager: Memory item with ID {id} not found")
            return items[id].show_description_history()

    def list_expired(self) -> list[dict]:
        """列出已过期但尚未清理的条目（供 GET /memories/expired 端点使用）。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            return [
                {
                    "id": id,
                    "description": item.description,
                    "theme": item.theme,
                    "latest_update_time": item.latest_update_time,
                    "ttl": item.ttl,
                    "expires_at": item.expires_at,
                }
                for id, item in items.items()
                if _is_expired(item.expires_at)
            ]

    def purge_expired(self) -> int:
        """清理所有已过期条目（YAML + 向量库）。

        Returns:
            被清理的条目数
        """
        expired_ids: list[str] = []
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            for id, item in items.items():
                if _is_expired(item.expires_at):
                    expired_ids.append(id)
            if not expired_ids:
                return 0
            for id in expired_ids:
                items.pop(id, None)
            self._write_all(items)
        # 同步向量库（best-effort）
        from memory.rag.indexer import remove_memory
        for id in expired_ids:
            remove_memory(id)
        logger.info("[memory] purged %d expired item(s) from %s",
                    len(expired_ids), self._yaml_file)
        return len(expired_ids)

    def search(
        self,
        keyword: str = "",
        theme: str = "",
        since: str = "",
        limit: int = 50,
    ) -> list[dict]:
        """搜索记忆条目。

        Args:
            keyword: 关键词（在 description 和 theme 中模糊匹配）
            theme: 按分区过滤
            since: 时间范围起始（格式 YYYY-MM-DD），仅返回此日期之后更新的条目
            limit: 最大返回条数
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
            results = []
            for id, item in items.items():
                # 过滤已过期条目
                if _is_expired(item.expires_at):
                    continue
                # 分区过滤
                if theme and item.theme != theme:
                    continue
                # 时间过滤
                if since and item.latest_update_time < since:
                    continue
                # 关键词匹配（在 description 和 theme 中搜索）
                if keyword:
                    kw = keyword.lower()
                    if kw not in item.description.lower() and kw not in item.theme.lower():
                        continue
                results.append({
                    "id": id,
                    "description": item.description,
                    "theme": item.theme,
                    "latest_update_time": item.latest_update_time,
                })
            # 按更新时间倒序
            results.sort(key=lambda x: x["latest_update_time"], reverse=True)
            return results[:limit]

    def find_similar(self, description: str, theme: str = "", threshold: float = 0.6) -> list[dict]:
        """查找与给定描述相似的已有记忆条目。

        优先使用 chromadb 向量检索（语义相似度）；
        若向量库不可用或返回 None，回退到 bigram Jaccard（关键词重叠）。

        Args:
            description: 待比较的描述文本
            theme: 可选，限定在某个分区内查找
            threshold: 相似度阈值（0-1），默认 0.6

        Returns:
            相似度超过阈值的条目列表，每项包含 id, description, theme, similarity
        """
        # 优先尝试向量检索
        vector_results = self._find_similar_vector(description, theme, threshold)
        if vector_results is not None:
            return vector_results
        # 回退到 bigram Jaccard
        return self._find_similar_bigram(description, theme, threshold)

    def _find_similar_vector(
        self, description: str, theme: str, threshold: float
    ) -> list[dict] | None:
        """向量检索。

        Returns:
            None 表示向量库不可用（应回退）；返回 [] 表示查无结果；返回 [...] 表示命中
        """
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_LONG_TERM, get_vector_store
        except ImportError:
            return None

        engine = get_embedding_engine()
        store = get_vector_store()
        if engine is None or store is None:
            return None

        # 自动重建索引：collection 为空但 YAML 有数据时，迁移现有记忆
        self._maybe_auto_reindex()

        try:
            embeddings = engine.embed([description])
            if not embeddings:
                return None  # embedding 失败，回退

            from config.settings import get_settings
            settings = get_settings()

            # 元数据过滤（按 theme）
            where = {"theme": theme} if theme else None
            raw_results = store.query(
                collection=COLLECTION_LONG_TERM,
                query_embeddings=embeddings,
                n_results=settings.rag_top_k,
                where=where,
            )

            results = []
            for r in raw_results:
                # chromadb cosine distance: 0=完全相同, 2=完全相反
                # similarity = 1 - distance
                similarity = max(0.0, 1.0 - r["distance"])
                # 同主题加权（与 bigram 方法一致）
                if theme and r["metadata"].get("theme") == theme:
                    similarity = min(1.0, similarity + 0.15)
                if similarity >= threshold:
                    results.append({
                        "id": r["id"],
                        "description": r["document"],
                        "theme": r["metadata"].get("theme", ""),
                        "similarity": round(similarity, 3),
                    })

            results.sort(key=lambda x: x["similarity"], reverse=True)
            return results
        except Exception as e:
            logger.warning("[rag] vector find_similar failed, falling back: %s", e)
            return None

    def _find_similar_bigram(
        self, description: str, theme: str, threshold: float
    ) -> list[dict]:
        """bigram Jaccard 相似度（回退方案，不依赖 embedding 模型）。"""
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()

        # 将描述拆分为字符 bigrams 作为简易 token
        def _tokenize(text: str) -> set[str]:
            text = text.lower().strip()
            tokens = set()
            for word in re.findall(r'[a-zA-Z]+', text):
                tokens.add(word.lower())
            chinese_chars = re.findall(r'[\u4e00-\u9fff]', text)
            for i in range(len(chinese_chars) - 1):
                tokens.add(chinese_chars[i] + chinese_chars[i + 1])
            for ch in chinese_chars:
                tokens.add(ch)
            return tokens

        new_tokens = _tokenize(description)
        if not new_tokens:
            return []

        results = []
        for id, item in items.items():
            if _is_expired(item.expires_at):
                continue
            if theme and item.theme != theme:
                continue
            existing_tokens = _tokenize(item.description)
            if not existing_tokens:
                continue
            intersection = new_tokens & existing_tokens
            union = new_tokens | existing_tokens
            similarity = len(intersection) / len(union) if union else 0

            if item.theme == theme:
                similarity = min(1.0, similarity + 0.15)

            if similarity >= threshold:
                results.append({
                    "id": id,
                    "description": item.description,
                    "theme": item.theme,
                    "similarity": round(similarity, 3),
                })

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results

    def _maybe_auto_reindex(self) -> None:
        """首次使用向量检索时，若 collection 为空但 YAML 有数据，自动全量重建索引。

        每个 yaml 文件只执行一次（通过模块级 ``_auto_reindexed`` 集合去重）。

        线程安全：通过 _auto_reindexed_lock 保护集合的 check-then-add 操作（修复
        Bug 1.3：原实现两线程可同时通过 `in` 检查并重复 reindex）。
        """
        # 修复 Bug 1.3：check-then-add 必须在同一个锁内原子完成
        with _auto_reindexed_lock:
            if self._yaml_file in _auto_reindexed:
                return
            _auto_reindexed.add(self._yaml_file)

        try:
            from memory.rag.vector_store import COLLECTION_LONG_TERM, get_vector_store
            store = get_vector_store()
            if store is None:
                return
            if store.count(COLLECTION_LONG_TERM) > 0:
                return  # 已有索引数据，无需迁移
        except Exception:
            return

        # collection 为空，检查 YAML 是否有数据
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
        if not items:
            return

        from memory.rag.indexer import reindex_all
        count = reindex_all(items)
        if count > 0:
            logger.info("[rag] auto-reindexed %d memories from %s", count, self._yaml_file)

    def reindex(self) -> int:
        """全量重建向量索引（公开方法，供手动迁移或修复使用）。

        Returns:
            成功索引的条目数
        """
        with portalocker.Lock(self._lock_path, timeout=5):
            items = self._read_all()
        if not items:
            return 0
        from memory.rag.indexer import reindex_all
        return reindex_all(items)
