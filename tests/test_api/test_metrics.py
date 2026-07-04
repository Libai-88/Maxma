"""Tests for api/metrics.py — 指标采集模块。"""

import pytest

from api.db.metrics import MetricsDbStore
from api.metrics import Metrics, get_metrics


class TestMetrics:
    """指标采集测试。"""

    def setup_method(self):
        """每个测试前重置指标。"""
        Metrics().reset()

    def test_singleton(self):
        """Metrics 应该是单例。"""
        m1 = Metrics()
        m2 = Metrics()
        assert m1 is m2

    def test_get_metrics(self):
        """get_metrics() 应该返回 Metrics 单例。"""
        assert get_metrics() is Metrics()

    def test_record_request(self):
        """记录 HTTP 请求。"""
        m = Metrics()
        m.record_request("GET", "/api/sessions", 200, 15.5)
        m.record_request("GET", "/api/sessions", 200, 20.0)
        m.record_request("POST", "/api/sessions", 201, 50.0)

        snapshot = m.get_snapshot()
        assert snapshot["http"]["total_requests"] == 3
        assert snapshot["http"]["status_codes"][200] == 2
        assert snapshot["http"]["status_codes"][201] == 1
        assert snapshot["http"]["latency_ms"]["count"] == 3

    def test_record_request_path_normalization(self):
        """路径归一化 — UUID 段替换为 :id。"""
        m = Metrics()
        m.record_request("GET", "/api/sessions/abc12345-1234-1234-1234-123456789abc", 200, 10.0)
        m.record_request("GET", "/api/sessions/def67890-5678-5678-5678-abcdef012345", 200, 15.0)

        snapshot = m.get_snapshot()
        # 两个请求应该归一化到同一路径
        top_paths = snapshot["http"]["top_paths"]
        assert "GET /api/sessions/:id" in top_paths
        assert top_paths["GET /api/sessions/:id"]["count"] == 2

    def test_record_tool_call(self):
        """记录工具调用。"""
        m = Metrics()
        m.record_tool_call("file_read", latency_ms=5.0)
        m.record_tool_call("file_read", latency_ms=10.0)
        m.record_tool_call("file_write", latency_ms=3.0, is_error=True)

        snapshot = m.get_snapshot()
        assert snapshot["tools"]["total_calls"] == 3
        assert snapshot["tools"]["total_errors"] == 1
        assert snapshot["tools"]["by_tool"]["file_read"]["count"] == 2
        assert snapshot["tools"]["by_tool"]["file_read"]["latency"]["avg_ms"] == 7.5
        assert snapshot["tools"]["by_tool"]["file_write"]["errors"] == 1

    def test_record_llm_call(self):
        """记录 LLM 调用。"""
        m = Metrics()
        m.record_llm_call("deepseek-chat", 100, 50, 500.0)
        m.record_llm_call("deepseek-chat", 200, 100, 800.0)

        snapshot = m.get_snapshot()
        assert snapshot["llm"]["total_calls"] == 2
        assert snapshot["llm"]["total_tokens_in"] == 300
        assert snapshot["llm"]["total_tokens_out"] == 150
        assert snapshot["llm"]["by_model"]["deepseek-chat"] == 2

    def test_record_error(self):
        """记录错误事件。"""
        m = Metrics()
        m.record_error("tool")
        m.record_error("tool")
        m.record_error("llm")

        snapshot = m.get_snapshot()
        assert snapshot["errors"]["tool"] == 2
        assert snapshot["errors"]["llm"] == 1

    def test_snapshot_uptime(self):
        """快照应该包含运行时间。"""
        m = Metrics()
        snapshot = m.get_snapshot()
        assert "uptime_seconds" in snapshot
        assert snapshot["uptime_seconds"] >= 0

    def test_reset(self):
        """重置应该清空所有指标。"""
        m = Metrics()
        m.record_request("GET", "/test", 200, 10.0)
        m.record_tool_call("test_tool")
        m.record_llm_call("model", 10, 5, 100.0)

        m.reset()

        snapshot = m.get_snapshot()
        assert snapshot["http"]["total_requests"] == 0
        assert snapshot["tools"]["total_calls"] == 0
        assert snapshot["llm"]["total_calls"] == 0

    def test_empty_snapshot(self):
        """空快照应该返回合理的默认值。"""
        m = Metrics()
        snapshot = m.get_snapshot()

        assert snapshot["http"]["total_requests"] == 0
        assert snapshot["http"]["latency_ms"]["count"] == 0
        assert snapshot["tools"]["total_calls"] == 0
        assert snapshot["llm"]["total_calls"] == 0
        assert snapshot["errors"] == {}


class TestMetricsPersistence:
    """指标 SQLite 持久化测试 — 使用 tmp_path 隔离 DB。"""

    def setup_method(self):
        """每个测试前重置指标（清空内存 + 既有 DB）。"""
        Metrics().reset()

    def teardown_method(self):
        """每个测试后清理 DB 引用，避免影响其他测试。"""
        Metrics()._db = None
        Metrics().reset()

    def _make_store(self, tmp_path) -> MetricsDbStore:
        """创建基于 tmp_path 的隔离 store 并注入到 Metrics 单例。"""
        db_path = tmp_path / "test_metrics.db"
        store = MetricsDbStore(db_path)
        Metrics()._db = store
        return store

    def test_snapshot_persists_to_sqlite(self, tmp_path):
        """快照应该被持久化到 SQLite，且能通过 get_history 读回。"""
        m = Metrics()
        self._make_store(tmp_path)

        m.record_request("GET", "/test", 200, 10.0)
        m.record_tool_call("tool_a", latency_ms=5.0)
        m.record_llm_call("model_x", 100, 50, 500.0)
        m.persist_snapshot()

        history = m.get_history(window_seconds=3600)
        assert len(history) >= 1
        snap = history[-1]
        assert "id" in snap
        assert "timestamp" in snap
        assert "uptime_seconds" in snap
        assert "http" in snap
        assert "tools" in snap
        assert "llm" in snap
        assert "errors" in snap
        assert snap["http"]["total_requests"] == 1
        assert snap["tools"]["total_calls"] == 1
        assert snap["llm"]["total_calls"] == 1

    def test_history_respects_window(self, tmp_path):
        """get_history 的窗口过滤应只返回近期快照。"""
        m = Metrics()
        store = self._make_store(tmp_path)

        # 记录一条请求并手动插入一条"旧"快照（时间戳远在过去）
        m.record_request("GET", "/old", 200, 10.0)
        old_snapshot = m.get_snapshot()
        store.save_snapshot({
            "timestamp": "2020-01-01T00:00:00",
            "uptime_seconds": old_snapshot["uptime_seconds"],
            "http": old_snapshot["http"],
            "tools": old_snapshot["tools"],
            "llm": old_snapshot["llm"],
            "errors": old_snapshot["errors"],
        })
        # 再记录一条新请求，然后 persist 当前快照（时间戳为现在）
        m.record_request("GET", "/new", 200, 20.0)
        m.persist_snapshot()

        # 足够大的窗口应返回两条（覆盖 2020 年的旧快照）
        all_history = m.get_history(window_seconds=10**10)
        assert len(all_history) == 2

        # 小窗口只返回新快照（2020-01-01 远在窗口之外）
        recent = m.get_history(window_seconds=60)
        assert len(recent) == 1
        # 新快照应包含两条请求（/old + /new）
        assert recent[0]["http"]["total_requests"] == 2

    def test_reset_clears_db(self, tmp_path):
        """reset 应该清空 DB 中的历史快照。"""
        m = Metrics()
        self._make_store(tmp_path)

        m.record_request("GET", "/test", 200, 10.0)
        m.persist_snapshot()
        assert len(m.get_history()) >= 1

        m.reset()

        assert m.get_history() == []
