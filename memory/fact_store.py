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

SCHEMA_VERSION = 3


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


def _tag_like_pattern(tag: str) -> str:
    """Escape SQL LIKE metacharacters while retaining JSON-string matching."""
    escaped = tag.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    escaped = escaped.replace('"', '\\"')
    return f'%"{escaped}"%'


def _build_fts_query(query: str) -> str:
    """将用户查询转为 FTS 查询（词法 token + CJK n-grams，OR 连接）。"""
    tokens = re.findall(r'\w+', query)
    cjk_grams = _cjk_ngrams(query).split()
    all_tokens = list(dict.fromkeys(tokens + cjk_grams))
    if not all_tokens:
        return query
    # FTS5 OR 查询
    return ' OR '.join(f'"{t}"' for t in all_tokens if t)


class FactStore:
    """SQLite + FTS5 事实存储。

    This store is an optional exact-retrieval supplement. It deliberately does
    not replace the JSON/Chroma semantic-memory path.
    """

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
                expires_at REAL,
                idempotency_key TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_facts_session ON facts(session_id);
            CREATE INDEX IF NOT EXISTS idx_facts_created ON facts(created_at DESC);
        """)
        # Existing installations may have been created before the ticker
        # idempotency key existed.  SQLite has no ADD COLUMN IF NOT EXISTS.
        columns = {
            row["name"]
            for row in self._conn.execute("PRAGMA table_info(facts)").fetchall()
        }
        if "idempotency_key" not in columns:
            self._conn.execute("ALTER TABLE facts ADD COLUMN idempotency_key TEXT")
        self._conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_idempotency_key "
            "ON facts(idempotency_key) WHERE idempotency_key IS NOT NULL"
        )
        # Schema 版本
        self._conn.execute("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)")
        cur = self._conn.execute("SELECT value FROM schema_meta WHERE key='version'")
        row = cur.fetchone()
        if row is None:
            self._conn.execute("INSERT INTO schema_meta (key, value) VALUES ('version', ?)", (str(SCHEMA_VERSION),))
        elif int(row["value"]) < SCHEMA_VERSION:
            self._conn.execute("UPDATE schema_meta SET value = ? WHERE key='version'", (str(SCHEMA_VERSION),))
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
            self._backfill_fts_if_needed()
        except sqlite3.OperationalError as e:
            logger.warning("FTS5 not available, falling back to LIKE: %s", e)
            self._fts_available = False

    def _backfill_fts_if_needed(self) -> None:
        """Index existing facts if FTS was unavailable when they were written."""
        facts_count = self._conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        indexed_count = self._conn.execute("SELECT COUNT(*) FROM facts_fts").fetchone()[0]
        if facts_count == indexed_count:
            return

        rows = self._conn.execute("SELECT id, content, tags FROM facts").fetchall()
        self._conn.execute("DELETE FROM facts_fts")
        for row in rows:
            try:
                tags = json.loads(row["tags"]) if row["tags"] else []
            except json.JSONDecodeError:
                tags = []
            if not isinstance(tags, list):
                tags = []
            self._conn.execute(
                "INSERT INTO facts_fts (fact_id, search_text, content) VALUES (?, ?, ?)",
                (row["id"], _build_search_text(row["content"], tags), row["content"]),
            )
        self._conn.commit()

    def add(self, *, content: str, tags: list[str] | None = None,
            source: str = "dialogue", session_id: str = "",
            ttl: int | None = None, idempotency_key: str | None = None) -> str:
        """添加一条事实，并可选地用 ``idempotency_key`` 去重。

        The key belongs to a producer's durable input identity.  Replaying the
        same ticker item returns the original fact id instead of creating a
        second fact.  Callers must not reuse a key for different content.
        """
        fact_id = f"fact_{uuid.uuid4().hex[:12]}"
        now = time.time()
        expires_at = now + ttl if ttl else None
        tags_json = json.dumps(tags or [], ensure_ascii=False)

        with self._lock:
            if idempotency_key:
                existing = self._conn.execute(
                    "SELECT id FROM facts WHERE idempotency_key = ?",
                    (idempotency_key,),
                ).fetchone()
                if existing is not None:
                    return str(existing["id"])
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._conn.execute(
                    "INSERT INTO facts (id, content, tags, source, session_id, created_at, updated_at, ttl, expires_at, idempotency_key) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (fact_id, content, tags_json, source, session_id, now, now, ttl, expires_at, idempotency_key)
                )
            except Exception:
                # 跨进程竞态：另一个进程已插入同 idempotency_key 的行，回退查询
                self._conn.execute("ROLLBACK")
                if idempotency_key:
                    existing = self._conn.execute(
                        "SELECT id FROM facts WHERE idempotency_key = ?",
                        (idempotency_key,),
                    ).fetchone()
                    if existing is not None:
                        return str(existing["id"])
                raise
            if self._fts_available:
                search_text = _build_search_text(content, tags or [])
                self._conn.execute(
                    "INSERT INTO facts_fts (fact_id, search_text, content) VALUES (?, ?, ?)",
                    (fact_id, search_text, content)
                )
            self._conn.commit()
        return fact_id

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        session_id: str | None = None,
        include_expired: bool = False,
    ) -> list[dict[str, Any]]:
        """Search supplementary facts without changing semantic retrieval."""
        if not query.strip() or limit < 1:
            return []

        now = time.time()
        if self._fts_available:
            fts_query = _build_fts_query(query)
            if not fts_query:
                return []
            sql = """
                SELECT f.id, f.content, f.tags, f.source, f.session_id, f.created_at
                FROM facts f
                JOIN facts_fts ON f.id = facts_fts.fact_id
                WHERE facts_fts MATCH ?
            """
            params: list[Any] = [fts_query]
            if not include_expired:
                sql += " AND (f.expires_at IS NULL OR f.expires_at > ?)"
                params.append(now)
            if session_id:
                sql += " AND f.session_id = ?"
                params.append(session_id)
            sql += " ORDER BY bm25(facts_fts), f.created_at DESC, f.id ASC LIMIT ?"
            params.append(limit)
            with self._lock:
                rows = self._conn.execute(sql, params).fetchall()
        else:
            pattern = f"%{query}%"
            sql = "SELECT id, content, tags, source, session_id, created_at FROM facts WHERE content LIKE ?"
            params = [pattern]
            if not include_expired:
                sql += " AND (expires_at IS NULL OR expires_at > ?)"
                params.append(now)
            if session_id:
                sql += " AND session_id = ?"
                params.append(session_id)
            sql += " ORDER BY created_at DESC, id ASC LIMIT ?"
            params.append(limit)
            with self._lock:
                rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def search_by_tag(
        self,
        tag: str,
        *,
        limit: int = 10,
        session_id: str | None = None,
        include_expired: bool = False,
    ) -> list[dict[str, Any]]:
        """Look up an exact JSON tag, optionally constrained to one session."""
        if not tag or limit < 1:
            return []

        sql = (
            "SELECT id, content, tags, source, session_id, created_at FROM facts "
            "WHERE tags LIKE ? ESCAPE '\\'"
        )
        params: list[Any] = [_tag_like_pattern(tag)]
        if not include_expired:
            sql += " AND (expires_at IS NULL OR expires_at > ?)"
            params.append(time.time())
        if session_id:
            sql += " AND session_id = ?"
            params.append(session_id)
        sql += " ORDER BY created_at DESC, id ASC LIMIT ?"
        params.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def delete(self, fact_id: str) -> bool:
        """删除一条事实。"""
        with self._lock:
            cur = self._conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
            if self._fts_available:
                self._conn.execute("DELETE FROM facts_fts WHERE fact_id = ?", (fact_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def purge_expired(self, *, now: float | None = None) -> int:
        """Remove expired records and their FTS entries in one transaction."""
        cutoff = time.time() if now is None else now
        with self._lock:
            expired_rows = self._conn.execute(
                "SELECT id FROM facts WHERE expires_at IS NOT NULL AND expires_at <= ?",
                (cutoff,),
            ).fetchall()
            if not expired_rows:
                return 0
            ids = [str(row["id"]) for row in expired_rows]
            placeholders = ", ".join("?" for _ in ids)
            if self._fts_available:
                self._conn.execute(
                    f"DELETE FROM facts_fts WHERE fact_id IN ({placeholders})", ids
                )
            deleted = self._conn.execute(
                f"DELETE FROM facts WHERE id IN ({placeholders})", ids
            ).rowcount
            self._conn.commit()
            return int(deleted)

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
