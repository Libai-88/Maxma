# memory/fact_store.py
"""FactStore v2: SQLite + FTS5 全文搜索 + CJK n-gram。

放弃 v1 的向量搜索，改用 FTS5 + 标签匹配：
- 无 embedding 依赖（部署更轻量）
- CJK 友好（中文/日文/韩文搜索效果好）
- FTS 失败时降级为 LIKE 搜索
"""
from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 2


def _cjk_ngrams(text: str, n: int = 2) -> str:
    """生成 CJK n-gram 用于 FTS 索引。"""
    # 只对 CJK 字符做 n-gram
    cjk_chars = re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]', text)
    grams: list[str] = []
    for i in range(len(cjk_chars) - n + 1):
        grams.append(''.join(cjk_chars[i:i + n]))
    # 也加上 3-gram 提高精度
    for i in range(len(cjk_chars) - 2):
        grams.append(''.join(cjk_chars[i:i + 3]))
    return ' '.join(grams)


def _build_search_text(content: str, tags: list[str]) -> str:
    """构建 FTS 搜索文本：原始内容 + 标签 + CJK n-grams。"""
    parts = [content]
    if tags:
        parts.extend(tags)
    parts.append(_cjk_ngrams(content))
    return ' '.join(parts)


def _build_fts_query(query: str) -> str:
    """将用户查询转为 FTS 查询（词法 token + CJK n-grams，OR 连接）。"""
    tokens = re.findall(r'\w+', query)
    cjk_grams = _cjk_ngrams(query).split()
    all_tokens = tokens + cjk_grams
    if not all_tokens:
        return query
    # FTS5 OR 查询
    return ' OR '.join(f'"{t}"' for t in all_tokens if t)


class FactStore:
    """SQLite + FTS5 事实存储。"""

    def __init__(self, db_path: str | None = None) -> None:
        if db_path is None:
            from app_paths import DATA_DIR
            db_path = str(Path(DATA_DIR) / "facts.db")
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._init_schema()
        self._init_fts()

    def _init_schema(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS facts (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'dialogue',
                session_id TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                ttl INTEGER,
                expires_at REAL
            );
            CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
            CREATE INDEX IF NOT EXISTS idx_facts_created ON facts(created_at DESC);
        """)
        # Schema 版本
        self._conn.execute("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)")
        cur = self._conn.execute("SELECT value FROM schema_meta WHERE key='version'")
        row = cur.fetchone()
        if row is None:
            self._conn.execute("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", (str(SCHEMA_VERSION),))
            self._conn.commit()

    def _init_fts(self) -> None:
        try:
            self._conn.executescript("""
                CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
                    fact_id, search_text, content UNINDEXED,
                    tokenize='unicode61'
                );
            """)
            self._fts_available = True
        except sqlite3.OperationalError as e:
            logger.warning(f"FTS5 not available, falling back to LIKE: {e}")
            self._fts_available = False

    def add(self, *, content: str, tags: list[str] | None = None,
            source: str = "dialogue", session_id: str = "",
            ttl: int | None = None) -> str:
        """添加一条事实。"""
        fact_id = f"fact_{uuid.uuid4().hex[:12]}"
        now = time.time()
        expires_at = now + ttl if ttl else None
        tags_json = json.dumps(tags or [], ensure_ascii=False)

        with self._lock:
            self._conn.execute(
                "INSERT INTO facts (id, content, tags, source, session_id, created_at, updated_at, ttl, expires_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (fact_id, content, tags_json, source, session_id, now, now, ttl, expires_at)
            )
            if self._fts_available:
                search_text = _build_search_text(content, tags or [])
                self._conn.execute(
                    "INSERT INTO facts_fts (fact_id, search_text, content) VALUES (?, ?, ?)",
                    (fact_id, search_text, content)
                )
            self._conn.commit()
        return fact_id

    def search(self, query: str, *, limit: int = 10, session_id: str | None = None) -> list[dict[str, Any]]:
        """全文搜索事实。"""
        if self._fts_available:
            fts_query = _build_fts_query(query)
            sql = """
                SELECT f.id, f.content, f.tags, f.source, f.session_id, f.created_at
                FROM facts f
                JOIN facts_fts ON f.id = facts_fts.fact_id
                WHERE facts_fts MATCH ?
            """
            params: list[Any] = [fts_query]
            if session_id:
                sql += " AND f.session_id = ?"
                params.append(session_id)
            sql += " ORDER BY f.created_at DESC LIMIT ?"
            params.append(limit)
            cur = self._conn.execute(sql, params)
        else:
            # 降级 LIKE 搜索
            pattern = f"%{query}%"
            sql = "SELECT id, content, tags, source, session_id, created_at FROM facts WHERE content LIKE ?"
            params_list: list[Any] = [pattern]
            if session_id:
                sql += " AND session_id = ?"
                params_list.append(session_id)
            sql += " ORDER BY created_at DESC LIMIT ?"
            params_list.append(limit)
            cur = self._conn.execute(sql, params_list)

        return [self._row_to_dict(row) for row in cur.fetchall()]

    def search_by_tag(self, tag: str, *, limit: int = 10) -> list[dict[str, Any]]:
        """按标签搜索。"""
        cur = self._conn.execute(
            "SELECT id, content, tags, source, session_id, created_at FROM facts "
            "WHERE tags LIKE ? ORDER BY created_at DESC LIMIT ?",
            (f'%"{tag}"%', limit)
        )
        return [self._row_to_dict(row) for row in cur.fetchall()]

    def delete(self, fact_id: str) -> bool:
        """删除一条事实。"""
        with self._lock:
            cur = self._conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
            if self._fts_available:
                self._conn.execute("DELETE FROM facts_fts WHERE fact_id = ?", (fact_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "content": row["content"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
            "source": row["source"],
            "session_id": row["session_id"],
            "created_at": row["created_at"],
        }

    def close(self) -> None:
        self._conn.close()
