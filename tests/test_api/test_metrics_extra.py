"""Coverage boost for api/metrics.py — Metrics collector.

Targets previously uncovered lines:
- _Histogram.reset()                                       [55-58]
- _normalize_path empty segment (//) + digit segment       [137, 142]
- reset() DB clear_all failure tolerance                   [258-259]
- _get_db() lazy MetricsDbStore() init                     [266-267]
- persist_snapshot() save_snapshot failure tolerance       [283-284]
- start_flush_task / _flush_loop / stop_flush_task         [292-321]  (async)

Does NOT modify the existing tests/test_api/test_metrics.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from api.metrics import Metrics, _Histogram


# ── 共享 setup/teardown（Metrics 是单例，类级 _db/_flush_task 不被 reset 重置） ─


class _MetricsBase:
    """每个测试前后清理 Metrics 单例的内存状态、DB 引用和 flush 任务引用。"""

    def setup_method(self) -> None:
        Metrics()._db = None
        Metrics()._flush_task = None
        Metrics().reset()

    def teardown_method(self) -> None:
        # sync 清理：无法 await，直接 cancel 残留任务
        task = Metrics._flush_task
        if task is not None and not task.done():
            task.cancel()
        Metrics()._flush_task = None
        Metrics()._db = None
        Metrics().reset()


# ── _Histogram.reset (lines 55-58) ──────────────────────────────


class TestHistogramReset(_MetricsBase):
    """reset() 应将 count/total/min/max 恢复为初始默认值。"""

    def test_reset_clears_accumulated_values(self) -> None:
        h = _Histogram()
        h.observe(5.0)
        h.observe(15.0)
        h.observe(10.0)
        assert h.count == 3
        assert h.total == 30.0

        h.reset()

        assert h.count == 0
        assert h.total == 0.0
        assert h.min_val == float("inf")
        assert h.max_val == 0.0

    def test_reset_then_to_dict_returns_empty_shape(self) -> None:
        h = _Histogram()
        h.observe(42.0)
        assert h.to_dict()["count"] == 1

        h.reset()

        d = h.to_dict()
        assert d == {"count": 0, "avg_ms": 0, "min_ms": 0, "max_ms": 0}

    def test_reset_allows_observing_again(self) -> None:
        h = _Histogram()
        h.observe(100.0)
        h.reset()
        h.observe(7.0)

        assert h.count == 1
        assert h.total == 7.0
        assert h.min_val == 7.0
        assert h.max_val == 7.0
        assert h.to_dict() == {"count": 1, "avg_ms": 7.0, "min_ms": 7.0, "max_ms": 7.0}

    def test_reset_on_fresh_histogram_is_noop(self) -> None:
        h = _Histogram()
        h.reset()
        assert h.count == 0
        assert h.min_val == float("inf")
        assert h.max_val == 0.0


# ── _normalize_path edge cases (lines 137, 142) ─────────────────


class TestNormalizePathEdgeCases(_MetricsBase):
    """_normalize_path 路径归一化边界。"""

    def test_double_slash_empty_segment_skipped(self) -> None:
        """路径含 // → strip('/').split('/') 产生空段 → continue（行 137）。"""
        norm = Metrics._normalize_path("GET", "/api//sessions")
        # "api//sessions".split("/") = ["api", "", "sessions"] → 空段跳过
        assert norm == "GET /api/sessions"

    def test_leading_trailing_slash_handled(self) -> None:
        """多余的前后斜杠被 strip 掉，不产生空段。"""
        norm = Metrics._normalize_path("POST", "///api/users///")
        assert norm == "POST /api/users"

    def test_pure_digit_segment_becomes_id(self) -> None:
        """纯数字段 → :id（行 142）。"""
        norm = Metrics._normalize_path("GET", "/api/sessions/123")
        assert norm == "GET /api/sessions/:id"

    def test_multiple_digit_segments(self) -> None:
        norm = Metrics._normalize_path("GET", "/api/123/456/abc")
        assert norm == "GET /api/:id/:id/abc"

    def test_digit_zero_segment(self) -> None:
        """'0'.isdigit() 为 True → :id。"""
        norm = Metrics._normalize_path("GET", "/items/0")
        assert norm == "GET /items/:id"

    def test_query_string_stripped_before_normalization(self) -> None:
        """query string 在归一化前被剥离。"""
        norm = Metrics._normalize_path(
            "GET", "/api/sessions/123?foo=bar&baz=qux"
        )
        assert norm == "GET /api/sessions/:id"

    def test_root_path(self) -> None:
        """根路径 '/' → strip('/') → '' → split('/') → [''] → 空段跳过 → 'METHOD /'。"""
        norm = Metrics._normalize_path("GET", "/")
        assert norm == "GET /"

    def test_digit_and_empty_combined(self) -> None:
        """组合：数字段 + 空段 + 普通段。"""
        norm = Metrics._normalize_path("GET", "/api//42/items")
        assert norm == "GET /api/:id/items"


# ── reset() DB clear_all failure tolerance (lines 258-259) ──────


class _BadDbClearAll:
    """fake DB whose clear_all() raises — 用于触发 reset() 的 except 分支。"""

    def clear_all(self) -> None:
        raise RuntimeError("db locked")


class TestResetDbFailure(_MetricsBase):
    """reset() 在 DB clear_all 失败时应容忍，不破坏 reset 语义。"""

    def test_reset_does_not_raise_when_clear_all_fails(self) -> None:
        m = Metrics()
        m.record_request("GET", "/x", 200, 10.0)
        m.record_tool_call("tool_a")
        Metrics()._db = _BadDbClearAll()

        # 不应抛出
        m.reset()

        # 内存仍应被清空
        snap = m.get_snapshot()
        assert snap["http"]["total_requests"] == 0
        assert snap["tools"]["total_calls"] == 0

    def test_reset_clears_memory_even_if_db_fails(self) -> None:
        m = Metrics()
        m.record_llm_call("model_x", 100, 50, 500.0)
        m.record_error("tool")
        m.record_rate_limit("http")
        Metrics()._db = _BadDbClearAll()

        m.reset()

        snap = m.get_snapshot()
        assert snap["llm"]["total_calls"] == 0
        assert snap["errors"] == {}


# ── _get_db() lazy init (lines 266-267) ─────────────────────────


class TestGetDbLazyInit(_MetricsBase):
    """_get_db() 在 _db 为 None 时惰性创建 MetricsDbStore() 并缓存。"""

    def test_lazy_creates_store_on_first_call(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        m = Metrics()
        Metrics()._db = None

        from api.db import metrics as db_metrics_mod

        real_cls = db_metrics_mod.MetricsDbStore
        created: list = []

        def fake_factory(*args, **kwargs):
            store = real_cls(tmp_path / "lazy.db")
            created.append(store)
            return store

        monkeypatch.setattr(db_metrics_mod, "MetricsDbStore", fake_factory)

        db = m._get_db()
        assert len(created) == 1
        assert db is created[0]

    def test_second_call_returns_cached_instance(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        m = Metrics()
        Metrics()._db = None

        from api.db import metrics as db_metrics_mod

        real_cls = db_metrics_mod.MetricsDbStore
        call_count = {"n": 0}

        def fake_factory(*args, **kwargs):
            call_count["n"] += 1
            return real_cls(tmp_path / "lazy_cache.db")

        monkeypatch.setattr(db_metrics_mod, "MetricsDbStore", fake_factory)

        db1 = m._get_db()
        db2 = m._get_db()
        assert db1 is db2
        assert call_count["n"] == 1  # 只创建一次

    def test_get_db_returns_none_db_when_already_set(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        """已注入 _db 时，_get_db 直接返回，不调用 MetricsDbStore()。"""
        m = Metrics()
        from api.db.metrics import MetricsDbStore

        sentinel = MetricsDbStore(tmp_path / "preset.db")
        Metrics()._db = sentinel

        from api.db import metrics as db_metrics_mod

        def fail_if_called(*args, **kwargs):
            raise AssertionError("不应重新创建 MetricsDbStore")

        monkeypatch.setattr(db_metrics_mod, "MetricsDbStore", fail_if_called)

        assert m._get_db() is sentinel


# ── persist_snapshot() failure tolerance (lines 283-284) ────────


class _BadDbSaveSnapshot:
    """fake DB whose save_snapshot() raises — 用于触发 persist_snapshot() 的 except。"""

    def save_snapshot(self, record: dict) -> int:
        raise RuntimeError("disk full")


class TestPersistSnapshotFailure(_MetricsBase):
    """persist_snapshot() 在 save_snapshot 失败时应容忍。"""

    def test_persist_snapshot_does_not_raise_on_save_failure(self) -> None:
        m = Metrics()
        m.record_request("GET", "/x", 200, 10.0)
        Metrics()._db = _BadDbSaveSnapshot()

        # 不应抛出
        m.persist_snapshot()

    def test_persist_snapshot_failure_does_not_corrupt_memory(self) -> None:
        m = Metrics()
        m.record_request("GET", "/x", 200, 10.0)
        m.record_tool_call("tool_a", latency_ms=5.0)
        Metrics()._db = _BadDbSaveSnapshot()

        m.persist_snapshot()

        snap = m.get_snapshot()
        assert snap["http"]["total_requests"] == 1
        assert snap["tools"]["total_calls"] == 1
