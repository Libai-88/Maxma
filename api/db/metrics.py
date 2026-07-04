"""运行时指标的 SQLite 持久化存储 — 快照 + 事件流。

将内存中的 Metrics 快照与事件流定期写入 SQLite，重启后可通过 get_history() 恢复历史。
默认使用 api.db.core 的共享连接（DB_PATH）；传入 db_path 时使用独立连接（用于测试隔离）。
"""

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from api.db.core import transaction

logger = logging.getLogger(__name__)


class MetricsDbStore:
    """运行时指标的 SQLite 持久化存储。

    遵循 HookDbStore / ProviderDbStore 的模式：
    - 默认使用 api.db.core.transaction() 共享连接
    - 传入 db_path 时使用独立连接（测试隔离）
    """

    def __init__(self, db_path: str | Path | None = None) -> None:
        self._db_path = str(db_path) if db_path else None
        if self._db_path:
            # 自定义路径场景：自行确保 schema 存在
            self._ensure_schema()

    # ── 内部工具 ──────────────────────────────────────────

    @contextmanager
    def _txn(self):
        """获取事务上下文 — 自定义路径走独立连接，否则走共享连接。"""
        if self._db_path:
            conn = sqlite3.connect(self._db_path)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        else:
            with transaction() as conn:
                yield conn

    def _ensure_schema(self) -> None:
        """确保 metrics 表存在（用于自定义 db_path 场景，幂等）。"""
        with self._txn() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS metrics_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    uptime_seconds REAL,
                    http_json TEXT,
                    tools_json TEXT,
                    llm_json TEXT,
                    errors_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_ts
                    ON metrics_snapshots(timestamp);

                CREATE TABLE IF NOT EXISTS metrics_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    name TEXT,
                    latency_ms REAL,
                    status TEXT,
                    extra_json TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_metrics_events_type_ts
                    ON metrics_events(event_type, timestamp);
                """
            )

    # ── 快照 ──────────────────────────────────────────────

    def save_snapshot(self, snapshot: dict) -> int:
        """插入一条指标快照，返回新行 id。

        snapshot 期望包含：timestamp, uptime_seconds, http, tools, llm, errors。
        """
        http_json = json.dumps(snapshot.get("http", {}), ensure_ascii=False)
        tools_json = json.dumps(snapshot.get("tools", {}), ensure_ascii=False)
        llm_json = json.dumps(snapshot.get("llm", {}), ensure_ascii=False)
        errors_json = json.dumps(snapshot.get("errors", {}), ensure_ascii=False)
        with self._txn() as db:
            cur = db.execute(
                """INSERT INTO metrics_snapshots
                   (timestamp, uptime_seconds, http_json, tools_json, llm_json, errors_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    snapshot["timestamp"],
                    float(snapshot.get("uptime_seconds", 0.0)),
                    http_json,
                    tools_json,
                    llm_json,
                    errors_json,
                ),
            )
            return cur.lastrowid

    def get_history(self, window_seconds: int = 3600) -> list[dict]:
        """返回最近 window_seconds 秒内的快照（按 timestamp 升序）。

        将 *_json 列反序列化为 dict，输出键为：id, timestamp, uptime_seconds,
        http, tools, llm, errors。
        """
        cutoff = (datetime.now() - timedelta(seconds=window_seconds)).isoformat()
        with self._txn() as db:
            rows = db.execute(
                """SELECT id, timestamp, uptime_seconds,
                          http_json, tools_json, llm_json, errors_json
                   FROM metrics_snapshots
                   WHERE timestamp >= ?
                   ORDER BY timestamp ASC""",
                (cutoff,),
            ).fetchall()
        result: list[dict] = []
        for r in rows:
            d = dict(r)
            d["http"] = json.loads(d.pop("http_json") or "{}")
            d["tools"] = json.loads(d.pop("tools_json") or "{}")
            d["llm"] = json.loads(d.pop("llm_json") or "{}")
            d["errors"] = json.loads(d.pop("errors_json") or "{}")
            result.append(d)
        return result

    # ── 事件 ──────────────────────────────────────────────

    def save_event(self, event: dict) -> int:
        """插入一条事件，返回新行 id。

        event 期望包含：timestamp, event_type, name, latency_ms, status, extra(dict)。
        """
        extra_json = json.dumps(event.get("extra", {}), ensure_ascii=False)
        with self._txn() as db:
            cur = db.execute(
                """INSERT INTO metrics_events
                   (timestamp, event_type, name, latency_ms, status, extra_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    event["timestamp"],
                    event["event_type"],
                    event.get("name"),
                    event.get("latency_ms"),
                    event.get("status"),
                    extra_json,
                ),
            )
            return cur.lastrowid

    def get_events(self, event_type: str | None = None, limit: int = 100) -> list[dict]:
        """查询事件，可选按类型过滤，newest first。"""
        with self._txn() as db:
            if event_type:
                rows = db.execute(
                    """SELECT id, timestamp, event_type, name, latency_ms, status, extra_json
                       FROM metrics_events
                       WHERE event_type = ?
                       ORDER BY id DESC
                       LIMIT ?""",
                    (event_type, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    """SELECT id, timestamp, event_type, name, latency_ms, status, extra_json
                       FROM metrics_events
                       ORDER BY id DESC
                       LIMIT ?""",
                    (limit,),
                ).fetchall()
        result: list[dict] = []
        for r in rows:
            d = dict(r)
            d["extra"] = json.loads(d.pop("extra_json") or "{}")
            result.append(d)
        return result

    # ── 清理 ──────────────────────────────────────────────

    def clear_all(self) -> None:
        """删除两张表的所有行（用于 reset）。"""
        with self._txn() as db:
            db.execute("DELETE FROM metrics_snapshots")
            db.execute("DELETE FROM metrics_events")
