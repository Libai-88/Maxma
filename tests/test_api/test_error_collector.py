"""测试 — api/diagnostics.py 全局错误收集器。"""

import json
import time

import pytest

from api import diagnostics as diag_mod
from api.diagnostics import ErrorCollector, ErrorRecord, error_collector


@pytest.fixture(autouse=True)
def reset_collector():
    """每个测试前清空单例缓冲区。"""
    error_collector.clear()
    yield
    error_collector.clear()


@pytest.fixture
def isolated_logs(tmp_path, monkeypatch):
    """把 LOGS_DIR 指向临时目录。"""
    monkeypatch.setattr(diag_mod, "LOGS_DIR", tmp_path)
    return tmp_path


class TestSingletonAndAdd:
    def test_get_returns_singleton(self):
        a = ErrorCollector.get()
        b = ErrorCollector.get()
        assert a is b
        assert a is error_collector

    def test_add_and_get_all(self):
        rec = ErrorRecord(
            timestamp="2026-01-01 00:00:00",
            level="ERROR",
            category="agent",
            message="boom",
        )
        error_collector.add(rec)
        all_errs = error_collector.get_all()
        assert len(all_errs) == 1
        assert all_errs[0].message == "boom"

    def test_add_error_convenience(self):
        # **extra 捕获任意关键字参数；用 k="v" 而非 extra={...}
        error_collector.add_error(
            "ERROR",
            "tool",
            "tool failed",
            trace_id="t1",
            session_id="s1",
            request_id="r1",
            logger_name="x.y",
            k="v",
        )
        rec = error_collector.get_all()[0]
        assert rec.level == "ERROR"
        assert rec.category == "tool"
        assert rec.trace_id == "t1"
        assert rec.session_id == "s1"
        assert rec.request_id == "r1"
        assert rec.logger_name == "x.y"
        assert rec.extra == {"k": "v"}
        # timestamp 是非空的本地时间字符串
        assert rec.timestamp

    def test_add_exception_includes_traceback(self):
        try:
            raise ValueError("kaboom")
        except ValueError as exc:
            error_collector.add_exception(exc, category="uncaught")
        rec = error_collector.get_all()[0]
        assert rec.level == "CRITICAL"
        assert rec.category == "uncaught"
        assert "kaboom" in rec.message
        assert "ValueError" in rec.exception

    def test_clear_returns_count_and_empties(self):
        for i in range(3):
            error_collector.add_error("ERROR", "c", f"m{i}")
        count = error_collector.clear()
        assert count == 3
        assert error_collector.get_all() == []

    def test_buffer_cap_enforced(self):
        """MAX_IN_MEMORY 上限应触发 deque 丢弃最旧。"""
        for i in range(error_collector.MAX_IN_MEMORY + 50):
            error_collector.add_error("ERROR", "c", f"m{i}")
        assert len(error_collector.get_all()) == error_collector.MAX_IN_MEMORY


class TestScanLogFiles:
    def test_scan_json_error_lines(self, isolated_logs):
        log = isolated_logs / "maxma.log"
        log.write_text(
            json.dumps({"level": "ERROR", "ts": "t1", "msg": "json err", "logger": "L"}) + "\n"
            + json.dumps({"level": "INFO", "ts": "t2", "msg": "ignore me"}) + "\n"
            + json.dumps({"level": "CRITICAL", "ts": "t3", "msg": "critical"}) + "\n",
            encoding="utf-8",
        )
        errs = error_collector._scan_log_files()
        assert len(errs) == 2
        assert errs[0]["message"] == "json err"
        assert errs[0]["source_file"] == "maxma.log"
        assert errs[1]["level"] == "CRITICAL"

    def test_scan_non_json_fallback(self, isolated_logs):
        log = isolated_logs / "maxma.log.1"
        log.write_text(
            "some plain ERROR line here\n"
            "normal info line\n"
            "CRITICAL boom\n",
            encoding="utf-8",
        )
        errs = error_collector._scan_log_files()
        # 两行包含 ERROR/CRITICAL
        assert len(errs) == 2
        assert errs[0]["level"] == "UNKNOWN"
        assert "ERROR" in errs[0]["message"]

    def test_scan_skips_missing_files(self, isolated_logs):
        # 目录存在但无日志文件
        errs = error_collector._scan_log_files()
        assert errs == []

    def test_scan_handles_unreadable_file(self, isolated_logs):
        # 创建一个 maxma.log 但内容触发 JSONDecodeError 的非 ERROR 行（应被忽略）
        log = isolated_logs / "maxma.log"
        log.write_text("just a normal line without keywords\n", encoding="utf-8")
        errs = error_collector._scan_log_files()
        assert errs == []


class TestGetLogFilesInfo:
    def test_collects_log_files(self, isolated_logs):
        (isolated_logs / "maxma.log").write_bytes(b"a" * 100)
        (isolated_logs / "maxma.log.1").write_bytes(b"b" * 50)
        (isolated_logs / "tauri.log").write_bytes(b"c" * 30)
        (isolated_logs / "other.txt").write_bytes(b"d")  # 应被忽略
        info = error_collector.get_log_files_info()
        names = {i["name"] for i in info}
        assert "maxma.log" in names
        assert "maxma.log.1" in names
        assert "tauri.log" in names
        assert "other.txt" not in names
        # size_bytes 字段
        for i in info:
            assert "size_bytes" in i
            assert "size_mb" in i
            assert "path" in i

    def test_missing_logs_dir(self, tmp_path, monkeypatch):
        # 指向不存在的目录
        monkeypatch.setattr(diag_mod, "LOGS_DIR", tmp_path / "nope")
        assert error_collector.get_log_files_info() == []


class TestExportReport:
    def test_export_report_merges_memory_and_file(self, isolated_logs):
        # 内存错误
        error_collector.add_error("ERROR", "agent", "memory err")
        # 文件错误（JSON ERROR 行）
        (isolated_logs / "maxma.log").write_text(
            json.dumps({"level": "ERROR", "ts": "t1", "msg": "file err"}) + "\n",
            encoding="utf-8",
        )
        report = error_collector.export_report()
        assert "generated_at" in report
        assert "system_info" in report
        assert "autonomy_status" in report
        assert "tauri_startup_log" in report
        assert "errors" in report
        assert "stats" in report
        messages = [e["message"] for e in report["errors"]]
        assert "memory err" in messages
        assert "file err" in messages
        assert report["stats"]["memory_error_count"] == 1
        assert report["stats"]["log_file_error_count"] == 1
        assert report["stats"]["merged_total"] == 2

    def test_export_report_dedups_identical(self, isolated_logs):
        """相同 timestamp+message 的错误应去重。"""
        # 内存与文件中放完全相同（timestamp+message 前 200 字符）的记录
        (isolated_logs / "maxma.log").write_text(
            json.dumps({"level": "ERROR", "ts": "2026-01-01 00:00:00", "msg": "dup err"}) + "\n",
            encoding="utf-8",
        )
        # 内存错误：timestamp 来自 strftime，可能不同；构造相同 timestamp 测试去重
        rec = ErrorRecord(
            timestamp="2026-01-01 00:00:00",
            level="ERROR",
            category="agent",
            message="dup err",
        )
        error_collector.add(rec)
        report = error_collector.export_report()
        # 去重后应只剩 1 条
        assert report["stats"]["merged_total"] == 1

    def test_export_text_report_has_sections(self, isolated_logs):
        error_collector.add_error("ERROR", "agent", "text report err")
        text = error_collector.export_text_report()
        assert "MaxmaHere 错误报告" in text
        assert "【系统信息】" in text
        assert "【自治层状态】" in text
        assert "【Tauri 启动日志】" in text
        assert "【错误统计】" in text
        # 有错误时显示每条编号，无错误时才显示【错误详情】总标题
        assert "【错误 #1】" in text
        assert "text report err" in text
        assert "报告结束" in text

    def test_export_text_report_no_errors(self, isolated_logs):
        text = error_collector.export_text_report()
        assert "无错误记录" in text


class TestAutonomyStatus:
    def test_autonomy_unavailable(self):
        status = error_collector._collect_autonomy_status()
        assert status["available"] is False
        assert "OMP" in status["reason"] or "Autonomy" in status["reason"]


class TestReadTauriStartupLog:
    def test_missing_tauri_log(self, isolated_logs):
        result = error_collector._read_tauri_startup_log()
        assert result["available"] is False
        assert "不存在" in result["reason"]

    def test_present_tauri_log(self, isolated_logs):
        tauri = isolated_logs / "tauri.log"
        tauri.write_text("line1\nline2\nline3\n", encoding="utf-8")
        result = error_collector._read_tauri_startup_log(max_lines=100)
        assert result["available"] is True
        assert result["line_count"] == 3
        # 行保留换行符，检查任一行包含 "line1"
        assert any("line1" in ln for ln in result["lines"])
        assert str(tauri) == result["path"]

    def test_tauri_log_tail_limit(self, isolated_logs):
        tauri = isolated_logs / "tauri.log"
        tauri.write_text("\n".join(f"line{i}" for i in range(50)) + "\n", encoding="utf-8")
        result = error_collector._read_tauri_startup_log(max_lines=5)
        assert result["available"] is True
        assert result["line_count"] == 5
        # 取最后 5 行
        assert any("line49" in ln for ln in result["lines"])


class TestCollectSystemInfo:
    def test_system_info_fields(self):
        info = error_collector._collect_system_info()
        for key in (
            "app_version",
            "python_version",
            "platform",
            "os_name",
            "machine",
            "processor",
            "uptime_seconds",
            "logs_dir",
            "data_dir",
            "cwd",
            "is_frozen",
            "env_flags",
        ):
            assert key in info
        assert info["app_version"]
