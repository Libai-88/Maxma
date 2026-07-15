"""Maxma session ↔ oh-my-pi sidecar session 映射持久化。

在 SQLite 中维护 Maxma session_id 到 sidecar session_id 的双向映射，
同时保存最近对话轮次，确保 sidecar 重启后上下文可恢复。
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

# SQLite 数据库路径
SESSION_MAP_DIR = Path.home() / ".maxma"
SESSION_MAP_DB = SESSION_MAP_DIR / "session_map.db"
# 保存的最大对话轮次数
MAX_TURNS = 20


class SessionMap:
    """Maxma ↔ sidecar session ID 映射表。
    
    线程安全（SQLite connection 是线程安全的，但 WAL 模式下并发写需序列化）。
    """
    
    def __init__(self, db_path: str | Path = SESSION_MAP_DB) -> None:
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
                turns: list[dict[str, str]] = json.loads(row[0]) if row[0] else []
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
                turns: list[dict[str, str]] = json.loads(row[0])
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
