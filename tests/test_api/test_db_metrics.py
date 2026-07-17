"""Coverage boost for api/db/metrics.py — MetricsDbStore.

Targets previously uncovered lines:
- _txn() rollback branch on exception (custom db_path)  [47-49]
- _txn() shared-connection branch (no db_path)            [53-54]
- save_event() full method                                [149-164]
- get_events() full method (filter / unfilter / limit /   [168-191]
  JSON deserialize / NULL extra fallback)

Does NOT modify the existing tests/test_api/test_metrics.py.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from api.db.metrics import MetricsDbStore


# ── _txn rollback branch (lines 47-49) ──────────────────────────


class TestTxnRollback:
    """Exception inside _txn() (custom db_path) must rollback + re-raise."""

    def test_rollback_on_exception_custom_db_path(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "rollback.db")

        with pytest.raises(RuntimeError, match="boom"):
            with store._txn() as db:
                db.execute(
                    "INSERT INTO metrics_snapshots (timestamp) VALUES ('x')"
                )
                raise RuntimeError("boom")

        # 行应被回滚 — 计数仍为 0
        with store._txn() as db:
            count = db.execute(
                "SELECT COUNT(*) FROM metrics_snapshots"
            ).fetchone()[0]
        assert count == 0

    def test_rollback_on_sqlite_error(self, tmp_path: Path) -> None:
        """原生 sqlite 错误也应触发回滚路径。"""
        store = MetricsDbStore(tmp_path / "rollback2.db")

        with pytest.raises(sqlite3.OperationalError):
            with store._txn() as db:
                # 故意查询不存在的表
                db.execute("SELECT * FROM no_such_table")

        # 后续事务仍可正常使用（连接已正确关闭/回滚）
        with store._txn() as db:
            count = db.execute(
                "SELECT COUNT(*) FROM metrics_snapshots"
            ).fetchone()[0]
        assert count == 0

    def test_successful_txn_commits(self, tmp_path: Path) -> None:
        """对照测试 — 无异常时事务提交。"""
        store = MetricsDbStore(tmp_path / "commit.db")
        with store._txn() as db:
            db.execute(
                "INSERT INTO metrics_snapshots (timestamp) VALUES ('committed')"
            )
        with store._txn() as db:
            count = db.execute(
                "SELECT COUNT(*) FROM metrics_snapshots"
            ).fetchone()[0]
        assert count == 1


# ── shared-connection path (lines 53-54) ────────────────────────


@pytest.fixture
def shared_isolated_db(tmp_path: Path, monkeypatch) -> Path:
    """重定向 api.db.core.DB_PATH 到 tmp_path 并初始化 schema。

    这样 MetricsDbStore()（无 db_path）会走 shared transaction() 分支，
    但落到隔离的临时库，不污染真实 maxma.db。
    """
    import api.db.core as db_core

    test_db = tmp_path / "shared_metrics.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)
    db_core.initialize_database()
    yield test_db


class TestSharedConnectionPath:
    """MetricsDbStore() 无 db_path 时走 api.db.core.transaction() 共享连接。"""

    def test_save_snapshot_via_shared_connection(self, shared_isolated_db) -> None:
        store = MetricsDbStore()  # 无 db_path → 共享连接
        assert store._db_path is None

        row_id = store.save_snapshot(
            {
                "timestamp": "2026-07-17T10:00:00",
                "uptime_seconds": 12.5,
                "http": {"total_requests": 1},
                "tools": {"total_calls": 0},
                "llm": {"total_calls": 1},
                "errors": {},
            }
        )
        assert isinstance(row_id, int)
        assert row_id > 0

        history = store.get_history(window_seconds=10**10)
        assert len(history) == 1
        assert history[0]["http"]["total_requests"] == 1

    def test_save_event_via_shared_connection(self, shared_isolated_db) -> None:
        store = MetricsDbStore()
        eid = store.save_event(
            {
                "timestamp": "2026-07-17T10:00:00",
                "event_type": "http",
                "name": "GET /x",
                "latency_ms": 5.0,
                "status": "ok",
                "extra": {"k": "v"},
            }
        )
        assert eid > 0
        events = store.get_events()
        assert len(events) == 1
        assert events[0]["extra"] == {"k": "v"}

    def test_clear_all_via_shared_connection(self, shared_isolated_db) -> None:
        store = MetricsDbStore()
        store.save_snapshot(
            {
                "timestamp": "2026-07-17T10:00:00",
                "uptime_seconds": 0.0,
                "http": {},
                "tools": {},
                "llm": {},
                "errors": {},
            }
        )
        store.save_event(
            {"timestamp": "2026-07-17T10:00:00", "event_type": "tool"}
        )
        assert len(store.get_history(window_seconds=10**10)) == 1
        assert len(store.get_events()) == 1

        store.clear_all()

        assert store.get_history(window_seconds=10**10) == []
        assert store.get_events() == []


# ── save_event (lines 149-164) ──────────────────────────────────


def _make_event(
    timestamp: str = "2026-07-17T10:00:00",
    event_type: str = "http",
    name: str | None = "GET /api",
    latency_ms: float | None = 42.5,
    status: str | None = "ok",
    extra: dict | None = None,
) -> dict:
    """构造事件 dict。"""
    return {
        "timestamp": timestamp,
        "event_type": event_type,
        "name": name,
        "latency_ms": latency_ms,
        "status": status,
        "extra": extra if extra is not None else {"k": "v"},
    }


class TestSaveEvent:
    """save_event 插入事件并返回新行 id。"""

    def test_insert_full_event_returns_id(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        eid = store.save_event(_make_event())
        assert isinstance(eid, int)
        assert eid > 0

    def test_insert_minimal_event(self, tmp_path: Path) -> None:
        """仅 timestamp + event_type；可选字段缺失存为 NULL。"""
        store = MetricsDbStore(tmp_path / "events.db")
        eid = store.save_event(
            {"timestamp": "2026-07-17T10:00:00", "event_type": "tool"}
        )
        assert eid > 0

        events = store.get_events()
        assert len(events) == 1
        ev = events[0]
        assert ev["name"] is None
        assert ev["latency_ms"] is None
        assert ev["status"] is None
        assert ev["extra"] == {}  # 缺失 extra → json.dumps({}) → "{}" → 解析为 {}

    def test_multiple_events_increment_ids(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        e1 = store.save_event(_make_event(name="first"))
        e2 = store.save_event(_make_event(name="second"))
        e3 = store.save_event(_make_event(name="third"))
        assert e1 < e2 < e3

    def test_serializes_extra_dict_to_json(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(
            _make_event(extra={"url": "http://x", "code": 200, "nested": {"a": 1}})
        )
        # 直接读 DB 验证 extra_json 是 JSON 字符串
        with store._txn() as db:
            row = db.execute(
                "SELECT extra_json FROM metrics_events LIMIT 1"
            ).fetchone()
        raw = row["extra_json"]
        assert isinstance(raw, str)
        assert json.loads(raw) == {"url": "http://x", "code": 200, "nested": {"a": 1}}

    def test_unicode_in_name_and_extra(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(
            _make_event(name="工具调用-中文", extra={"提示": "你好 🌍"})
        )
        ev = store.get_events()[0]
        assert ev["name"] == "工具调用-中文"
        assert ev["extra"] == {"提示": "你好 🌍"}

    def test_none_extra_serializes_to_empty_object(self, tmp_path: Path) -> None:
        """event 缺少 'extra' 键 → get('extra', {}) → {}。"""
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(
            {"timestamp": "2026-07-17T10:00:00", "event_type": "http"}
        )
        ev = store.get_events()[0]
        assert ev["extra"] == {}


# ── get_events (lines 168-191) ──────────────────────────────────


def _raw_insert_event(store: MetricsDbStore, event: dict) -> int:
    """绕过 save_event 直接插入（用于构造特殊状态，如 NULL extra_json）。"""
    extra_json = json.dumps(event.get("extra", {}), ensure_ascii=False) if "extra" in event else None
    with store._txn() as db:
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


class TestGetEvents:
    """get_events 查询事件，可选按类型过滤，newest first。"""

    def test_empty_returns_empty_list(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        assert store.get_events() == []

    def test_unfiltered_returns_newest_first(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(timestamp="2026-07-17T10:00:01", name="first"))
        store.save_event(_make_event(timestamp="2026-07-17T10:00:02", name="second"))
        store.save_event(_make_event(timestamp="2026-07-17T10:00:03", name="third"))

        events = store.get_events()
        # ORDER BY id DESC → 最后插入的在前
        assert [e["name"] for e in events] == ["third", "second", "first"]

    def test_filter_by_event_type(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(event_type="http", name="h1"))
        store.save_event(_make_event(event_type="tool", name="t1"))
        store.save_event(_make_event(event_type="http", name="h2"))
        store.save_event(_make_event(event_type="llm", name="l1"))

        http_events = store.get_events(event_type="http")
        assert len(http_events) == 2
        assert all(e["event_type"] == "http" for e in http_events)
        # newest first: h2 插在 h1 之后
        assert [e["name"] for e in http_events] == ["h2", "h1"]

        tool_events = store.get_events(event_type="tool")
        assert len(tool_events) == 1
        assert tool_events[0]["name"] == "t1"

    def test_filter_nonexistent_type_returns_empty(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(event_type="http"))
        assert store.get_events(event_type="never") == []

    def test_filter_with_falsy_event_type_uses_unfiltered_branch(
        self, tmp_path: Path
    ) -> None:
        """event_type='' （falsy）走 else 分支（无过滤）。"""
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(event_type="http", name="a"))
        store.save_event(_make_event(event_type="tool", name="b"))

        events = store.get_events(event_type="")
        assert len(events) == 2  # 不过滤

    def test_limit_respected(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        for i in range(5):
            store.save_event(_make_event(name=f"e{i}"))

        # limit=2 → 只返回最新 2 条
        limited = store.get_events(limit=2)
        assert len(limited) == 2
        assert [e["name"] for e in limited] == ["e4", "e3"]

    def test_limit_with_event_type_filter(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        for i in range(4):
            store.save_event(_make_event(event_type="http", name=f"h{i}"))
        store.save_event(_make_event(event_type="tool", name="t0"))

        http_limited = store.get_events(event_type="http", limit=2)
        assert len(http_limited) == 2
        assert [e["name"] for e in http_limited] == ["h3", "h2"]

    def test_default_limit_is_100(self, tmp_path: Path) -> None:
        """默认 limit=100。"""
        store = MetricsDbStore(tmp_path / "events.db")
        for _ in range(105):
            store.save_event(_make_event())
        events = store.get_events()
        assert len(events) == 100

    def test_returns_all_expected_fields(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(
            _make_event(
                timestamp="2026-07-17T10:00:00",
                event_type="http",
                name="GET /x",
                latency_ms=99.9,
                status="ok",
                extra={"a": 1},
            )
        )
        ev = store.get_events()[0]
        assert set(ev.keys()) == {
            "id",
            "timestamp",
            "event_type",
            "name",
            "latency_ms",
            "status",
            "extra",
        }
        assert ev["timestamp"] == "2026-07-17T10:00:00"
        assert ev["event_type"] == "http"
        assert ev["name"] == "GET /x"
        assert ev["latency_ms"] == 99.9
        assert ev["status"] == "ok"
        assert ev["extra"] == {"a": 1}
        assert isinstance(ev["id"], int)

    def test_deserializes_extra_json(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(extra={"nested": {"deep": [1, 2, 3]}}))
        ev = store.get_events()[0]
        assert ev["extra"] == {"nested": {"deep": [1, 2, 3]}}

    def test_null_extra_json_falls_back_to_empty_dict(self, tmp_path: Path) -> None:
        """extra_json 为 NULL 时，`or '{}'` 回退为空 dict。

        save_event 永远不会写入 NULL，因此用 _raw_insert_event 构造 NULL。
        """
        store = MetricsDbStore(tmp_path / "events.db")
        _raw_insert_event(
            store,
            {
                "timestamp": "2026-07-17T10:00:00",
                "event_type": "http",
                "name": "nullextra",
            },  # 不传 extra → extra_json=NULL
        )
        ev = store.get_events()[0]
        assert ev["extra"] == {}

    def test_filter_does_not_leak_across_types(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "events.db")
        store.save_event(_make_event(event_type="http", name="h"))
        store.save_event(_make_event(event_type="tool", name="t"))
        store.save_event(_make_event(event_type="llm", name="l"))

        # 各类型独立计数
        assert len(store.get_events(event_type="http")) == 1
        assert len(store.get_events(event_type="tool")) == 1
        assert len(store.get_events(event_type="llm")) == 1
        # 总计
        assert len(store.get_events()) == 3


# ── clear_all 在自定义 db_path 下（确认两端清理） ────────────────


class TestClearAllCustomPath:
    def test_clear_all_removes_snapshots_and_events(self, tmp_path: Path) -> None:
        store = MetricsDbStore(tmp_path / "clear.db")
        store.save_snapshot(
            {
                "timestamp": "2026-07-17T10:00:00",
                "uptime_seconds": 1.0,
                "http": {},
                "tools": {},
                "llm": {},
                "errors": {},
            }
        )
        store.save_event(_make_event())
        assert len(store.get_history(window_seconds=10**10)) == 1
        assert len(store.get_events()) == 1

        store.clear_all()

        assert store.get_history(window_seconds=10**10) == []
        assert store.get_events() == []
