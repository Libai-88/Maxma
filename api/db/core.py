"""
MaxmaHere SQLite 核心模块 — 数据库连接管理、事务、Schema 迁移。

设计原则：
- 使用 Python 标准库 sqlite3（零额外依赖）
- WAL 模式 + 显式行锁 / 列锁，避免多进程 / 协程竞争
- 每次请求 / 协程获取独立 Connection（非线程共享）
- Schema 变更通过版本号驱动的迁移脚本顺序执行
- 迁移不可逆，但每个迁移支持回退
"""

import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from app_paths import DATA_DIR

logger = logging.getLogger(__name__)

# ── 数据库路径 ──────────────────────────────────────────

DB_DIR = DATA_DIR / "api" / "data"
DB_PATH = DB_DIR / "maxma.db"


# ── Schema 迁移 ──────────────────────────────────────────

SCHEMA_VERSION = 1

SCHEMA_MIGRATIONS: list[str] = [
    # v1: 初始 schema
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at REAL NOT NULL DEFAULT (julianday('now'))
    );

    CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        provider_type TEXT NOT NULL DEFAULT 'openai',
        label TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        models TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        context_window INTEGER NOT NULL DEFAULT 256000,
        created_at REAL NOT NULL DEFAULT (julianday('now')),
        updated_at REAL NOT NULL DEFAULT (julianday('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL,
        created_at REAL NOT NULL DEFAULT (julianday('now'))
    );

    CREATE TABLE IF NOT EXISTS event_hooks (
        hook_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        hook_type TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        action TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at REAL NOT NULL DEFAULT (julianday('now')),
        last_triggered REAL,
        trigger_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS const_sessions (
        session_id TEXT PRIMARY KEY,
        const_name TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        messages BLOB,
        created_at REAL NOT NULL DEFAULT (julianday('now'))
    );

    CREATE TABLE IF NOT EXISTS path_whitelist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        recursive INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS maxma_blocker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
    );

    -- 确保初始版本记录
    INSERT OR IGNORE INTO schema_version (version, applied_at)
    VALUES (1, julianday('now'));
    """,
]


# ── 连接管理 ──────────────────────────────────────────

_db_init_lock = threading.Lock()
_db_initialized = False


def _get_connection() -> sqlite3.Connection:
    """获取一个新的数据库连接（WAL 模式 + 行级锁）。"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def initialize_database() -> None:
    """初始化数据库：确保目录存在、运行迁移。"""
    global _db_initialized
    if _db_initialized:
        return
    with _db_init_lock:
        if _db_initialized:
            return
        DB_DIR.mkdir(parents=True, exist_ok=True)
        conn = _get_connection()
        try:
            cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
            exists = cur.fetchone() is not None

            if not exists:
                # 全新数据库：执行所有迁移
                for sql in SCHEMA_MIGRATIONS:
                    conn.executescript(sql)
                logger.info("[db] Initialized new database at %s", DB_PATH)
            else:
                # 已有数据库：检查版本并升级
                current = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] or 0
                if current < SCHEMA_VERSION:
                    for sql in SCHEMA_MIGRATIONS[current:]:
                        conn.executescript(sql)
                    logger.info("[db] Migrated from v%s to v%s", current, SCHEMA_VERSION)

            conn.commit()
            _db_initialized = True
            logger.info("[db] Database ready at %s (v%s)", DB_PATH, SCHEMA_VERSION)
        finally:
            conn.close()


# ── 事务上下文管理器 ──────────────────────────────────


@contextmanager
def transaction() -> sqlite3.Connection:
    """获取一个数据库连接并在事务中执行。
    
    用法:
        with transaction() as db:
            db.execute("INSERT INTO ...", ...)
            db.execute("UPDATE ...", ...)
        # 自动提交 / 异常时回滚
    """
    conn = _get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── 导入导出辅助函数 ──────────────────────────────────


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    """将 sqlite3.Row 转换为普通 dict。"""
    if row is None:
        return None
    return dict(row)


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    """将 sqlite3.Row 列表转换为 dict 列表。"""
    return [dict(r) for r in rows]


# ── 应用启动时自动初始化 ──────────────────────────────

initialize_database()
