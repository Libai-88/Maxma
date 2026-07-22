"""Maxma session ↔ oh-my-pi sidecar session 映射持久化。

在 SQLite 中维护 Maxma session_id 到 sidecar session_id 的双向映射，
同时保存最近对话轮次，确保 sidecar 重启后上下文可恢复。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

try:
    from app_paths import API_DATA_DIR, _is_frozen
except ImportError:  # pragma: no cover - supports direct module execution
    API_DATA_DIR = Path.home() / ".maxma"

    def _is_frozen() -> bool:
        return False


logger = logging.getLogger(__name__)

# SQLite 数据库路径。开发模式保留旧位置，避免改变本地开发数据；冻结模式
# 与其他用户数据统一放入 %APPDATA%/MaxmaHere/api/data/。
SESSION_MAP_DIR = API_DATA_DIR if _is_frozen() else Path.home() / ".maxma"
SESSION_MAP_DB = SESSION_MAP_DIR / "session_map.db"
LEGACY_SESSION_MAP_DB = Path.home() / ".maxma" / "session_map.db"
# 保存的最大对话轮次数
MAX_TURNS = 20


def _migrate_legacy_database() -> None:
    """Copy the legacy session map into the frozen app-data directory once."""
    if not _is_frozen() or SESSION_MAP_DB.exists() or not LEGACY_SESSION_MAP_DB.exists():
        return
    try:
        SESSION_MAP_DIR.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect(str(LEGACY_SESSION_MAP_DB))
        target = sqlite3.connect(str(SESSION_MAP_DB))
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        logger.info("[session-map] migrated legacy database to %s", SESSION_MAP_DB)
    except (OSError, sqlite3.Error):
        logger.warning("[session-map] legacy database migration failed", exc_info=True)


def _decode_turns(raw: str | None) -> list[dict[str, str]]:
    """Decode persisted turns without letting one corrupt row break requests."""
    if not raw:
        return []
    try:
        decoded = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        logger.warning("[session-map] ignoring malformed turns JSON")
        return []
    return decoded if isinstance(decoded, list) else []


class SessionMap:
    """Maxma ↔ sidecar session ID 映射表。
    
    线程安全（SQLite connection 是线程安全的，但 WAL 模式下并发写需序列化）。
    """
    
    def __init__(self, db_path: str | Path | None = None) -> None:
        if db_path is None:
            _migrate_legacy_database()
            db_path = SESSION_MAP_DB
        self._db_path = str(db_path)
        self._lock = threading.Lock()
        # 确保父目录存在
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._db_path, timeout=5)
        self._conn.execute("PRAGMA journal_mode=WAL")
        # Main table
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS session_map (
                maxma_id TEXT PRIMARY KEY,
                sidecar_id TEXT NOT NULL,
                is_const INTEGER DEFAULT 0,
                turns TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # Migration: add columns if missing
        for col_sql in [
            "ALTER TABLE session_map ADD COLUMN is_const INTEGER DEFAULT 0",
            "ALTER TABLE session_map ADD COLUMN turns TEXT DEFAULT '[]'",
        ]:
            try:
                self._conn.execute(col_sql)
            except sqlite3.OperationalError:
                pass  # Column already exists
        self._conn.commit()

    def __enter__(self) -> SessionMap:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
    
    def get_sidecar_id(self, maxma_id: str) -> str | None:
        """根据 Maxma session ID 查找对应的 sidecar session ID。"""
        with self._lock:
            row = self._conn.execute(
                "SELECT sidecar_id FROM session_map WHERE maxma_id = ?",
                (maxma_id,),
            ).fetchone()
        return row[0] if row else None
    
    def get_maxma_id(self, sidecar_id: str) -> str | None:
        """反向查找：根据 sidecar session ID 查找 Maxma session ID。"""
        with self._lock:
            row = self._conn.execute(
                "SELECT maxma_id FROM session_map WHERE sidecar_id = ?",
                (sidecar_id,),
            ).fetchone()
        return row[0] if row else None
    
    def set_mapping(self, maxma_id: str, sidecar_id: str) -> None:
        """建立或更新映射（保留首次创建时间）。"""
        with self._lock:
            self._conn.execute(
                "INSERT INTO session_map (maxma_id, sidecar_id) VALUES (?, ?) "
                "ON CONFLICT(maxma_id) DO UPDATE SET "
                "sidecar_id=excluded.sidecar_id, updated_at=datetime('now')",
                (maxma_id, sidecar_id),
            )
            self._conn.commit()
    
    def remove(self, maxma_id: str) -> bool:
        """删除指定 Maxma session 的映射。"""
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM session_map WHERE maxma_id = ?", (maxma_id,)
            )
            self._conn.commit()
        return cur.rowcount > 0
    
    def set_const(self, maxma_id: str, is_const: bool = True) -> None:
        """标记一个 Maxma session 是否为 const session。"""
        with self._lock:
            self._conn.execute(
                "UPDATE session_map SET is_const = ?, updated_at = datetime('now') WHERE maxma_id = ?",
                (1 if is_const else 0, maxma_id),
            )
            self._conn.commit()

    def get_const(self, maxma_id: str) -> bool:
        """检查一个 Maxma session 是否为 const session。"""
        with self._lock:
            row = self._conn.execute(
                "SELECT is_const FROM session_map WHERE maxma_id = ?",
                (maxma_id,),
            ).fetchone()
        return bool(row[0]) if row else False

    def append_turn(self, maxma_id: str, user_message: str, assistant_message: str) -> None:
        """保存一轮对话到 session 记录（用于重启后恢复上下文）。

        如果 session 映射尚不存在，自动创建一行（sidecar_id 为空占位）。
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT turns FROM session_map WHERE maxma_id = ?", (maxma_id,)
            ).fetchone()
            if row:
                turns = _decode_turns(row[0])
            else:
                turns = []
            turns.append({
                "user": user_message[:500],
                "assistant": assistant_message[:1000],
            })
            # 只保留最近 N 轮
            if len(turns) > MAX_TURNS:
                turns = turns[-MAX_TURNS:]
            self._conn.execute(
                "INSERT INTO session_map (maxma_id, sidecar_id, turns) VALUES (?, '', ?) "
                "ON CONFLICT(maxma_id) DO UPDATE SET "
                "turns=excluded.turns, updated_at=datetime('now')",
                (maxma_id, json.dumps(turns, ensure_ascii=False)),
            )
            self._conn.commit()

    def get_recent_turns(self, maxma_id: str, count: int = 5) -> list[dict[str, str]]:
        """获取最近 N 轮对话（用于重启后恢复上下文）。"""
        with self._lock:
            row = self._conn.execute(
                "SELECT turns FROM session_map WHERE maxma_id = ?",
                (maxma_id,),
            ).fetchone()
            if row and row[0]:
                turns = _decode_turns(row[0])
                return turns[-count:]
            return []

    def list_all(self) -> list[dict[str, str]]:
        """列出所有映射（用于调试/管理）。"""
        with self._lock:
            rows = self._conn.execute(
                "SELECT maxma_id, sidecar_id, created_at, updated_at "
                "FROM session_map ORDER BY updated_at DESC"
            ).fetchall()
        return [
            {
                "maxma_id": r[0],
                "sidecar_id": r[1],
                "created_at": r[2],
                "updated_at": r[3],
            }
            for r in rows
        ]
    
    @property
    def count(self) -> int:
        """当前映射数量。"""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM session_map"
            ).fetchone()
        return row[0] if row else 0
    
    def close(self) -> None:
        """关闭数据库连接。"""
        self._conn.close()
