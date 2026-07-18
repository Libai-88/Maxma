"""Coverage boost tests for api/diagnostics.py.

Targets previously uncovered lines:
- export_text_report: autonomy available=True branch (224-231)
- export_text_report: tauri log available=True branch (242-246)
- export_text_report: optional error fields (280, 282, 284, 286, 288, 292-294, 296-298)
- _scan_log_files: empty-line skip (326), OSError/PermissionError (359-360)
- _read_tauri_startup_log: OSError (382-383), generic Exception (391-393)
- get_log_files_info: non-file entry skip (404), stat OSError (410-411),
  outer Exception (418-419)
- _collect_system_info: cwd exception (437-438), _is_frozen exception (444-445),
  env_flags population (456)
"""

from __future__ import annotations

import builtins
import json
import logging
from pathlib import Path
from unittest.mock import patch

import pytest

from api import diagnostics as diag_mod
from api.diagnostics import ErrorCollector, ErrorRecord, error_collector


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_collector():
    """Clear the global error_collector before and after each test."""
    error_collector.clear()
    yield
    error_collector.clear()


@pytest.fixture
def isolated_logs_dir(tmp_path: Path, monkeypatch) -> Path:
    """Redirect LOGS_DIR to an isolated tmp directory for both the diagnostics
    module and the collector instance (they share the module-level LOGS_DIR).
    """
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    monkeypatch.setattr(diag_mod, "LOGS_DIR", logs_dir)
    return logs_dir


# ── export_text_report: autonomy available=True branch (224-231) ─────


def test_text_report_renders_autonomy_available_branch(isolated_logs_dir):
    """Lines 224-231: when autonomy_status['available'] is True, the text
    report renders the scheduler running state and last-tick summary.
    """
    autonomy_payload = {
        "available": True,
        "running": True,
        "last_tick_at": "2026-07-17 10:00:00",
        "tick_count": 5,
        "last_tick_report_summary": {
            "issues_count": 2,
            "error_total": 1,
            "health_status": "degraded",
        },
    }
    with patch.object(
        error_collector, "_collect_autonomy_status", return_value=autonomy_payload
    ):
        text = error_collector.export_text_report()

    assert "调度器运行:   True" in text
    assert "最近 tick:    2026-07-17 10:00:00" in text
    assert "tick 次数:    5" in text
    assert "上次问题数:   2" in text
    assert "上次错误数:   1" in text
    assert "上次健康态:   degraded" in text


def test_text_report_autonomy_available_without_summary(isolated_logs_dir):
    """Lines 224-227: autonomy available=True but no last_tick_report_summary
    (or empty) — the summary block (228-231) is skipped.
    """
    autonomy_payload = {
        "available": True,
        "running": False,
        "last_tick_at": "N/A",
        "tick_count": 0,
        "last_tick_report_summary": None,
    }
    with patch.object(
        error_collector, "_collect_autonomy_status", return_value=autonomy_payload
    ):
        text = error_collector.export_text_report()

    assert "调度器运行:   False" in text
    assert "上次问题数" not in text


# ── export_text_report: tauri log available=True branch (242-246) ────


def test_text_report_renders_tauri_log_available_branch(isolated_logs_dir):
    """Lines 242-246: when tauri.log exists and is readable, the text report
    renders the file path, line count, and last-100-lines content.
    """
    tauri_log = isolated_logs_dir / "tauri.log"
    tauri_log.write_text("line one\nline two\nline three\n", encoding="utf-8")

    text = error_collector.export_text_report()

    assert "文件路径:" in text
    assert "tauri.log" in text
    assert "行数:         3" in text
    assert "内容（最后 100 行）:" in text
    assert "line one" in text
    assert "line two" in text
    assert "line three" in text


# ── export_text_report: optional error fields (280-298) ──────────────


def test_text_report_renders_all_optional_error_fields(isolated_logs_dir):
    """Lines 280, 282, 284, 286, 292-294, 296-298: an error record with all
    optional fields populated (trace_id, session_id, request_id, logger_name,
    exception, extra) renders them in the text report.

    Note: add_error's **extra captures arbitrary kwargs into the extra dict,
    so we pass key1/key2 as direct kwargs (not as a dict named 'extra').
    """
    error_collector.add_error(
        level="ERROR",
        category="agent",
        message="full optional error",
        trace_id="trace-abc",
        session_id="sess-123",
        request_id="req-456",
        logger_name="my.logger",
        exception="Traceback (most recent call last):\n  File 'x.py', line 1\nValueError: boom",
        key1="val1",
        key2="val2",
    )

    text = error_collector.export_text_report()

    assert "Trace ID: trace-abc" in text
    assert "会话 ID:  sess-123" in text
    assert "请求 ID:  req-456" in text
    assert "Logger:   my.logger" in text
    assert "异常堆栈:" in text
    assert "Traceback (most recent call last):" in text
    assert "  File 'x.py', line 1" in text
    assert "ValueError: boom" in text
    assert "附加信息:" in text
    assert "key1: val1" in text
    assert "key2: val2" in text


def test_text_report_renders_source_file_from_log_scan(isolated_logs_dir):
    """Line 288: a log-file-sourced error has source_file/source_line which
    renders in the text report.
    """
    log_entry = {
        "ts": "2026-07-17 10:00:00",
        "level": "ERROR",
        "msg": "log file error",
        "logger": "app",
    }
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(log_entry) + "\n", encoding="utf-8"
    )

    text = error_collector.export_text_report()

    assert "来源:     maxma.log:1" in text
    assert "log file error" in text


# ── _scan_log_files: empty-line skip (326) ───────────────────────────


def test_scan_log_files_skips_empty_lines(isolated_logs_dir):
    """Line 326: empty lines in maxma.log are skipped during scanning."""
    err1 = {"ts": "2026-07-17 10:00:00", "level": "ERROR", "msg": "err1"}
    err2 = {"ts": "2026-07-17 10:01:00", "level": "ERROR", "msg": "err2"}
    # Write with an empty line between entries.
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(err1) + "\n\n" + json.dumps(err2) + "\n", encoding="utf-8"
    )

    report = error_collector.export_report()
    messages = [e["message"] for e in report["errors"]]
    assert "err1" in messages
    assert "err2" in messages
    assert len(messages) == 2  # empty line produced no extra entry


# ── _scan_log_files: OSError / PermissionError (359-360) ─────────────


def test_scan_log_files_tolerates_permission_error(isolated_logs_dir, monkeypatch):
    """Lines 359-360: if opening a log file raises PermissionError, the scanner
    continues gracefully (skips that file) without crashing.
    """
    # Create a maxma.log so exists() returns True.
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps({"ts": "x", "level": "ERROR", "msg": "y"}) + "\n",
        encoding="utf-8",
    )

    real_open = builtins.open

    def _open_raising_for_maxma(file, *args, **kwargs):
        name = str(file)
        if name.endswith("maxma.log") and "r" in (args[0] if args else kwargs.get("mode", "")):
            raise PermissionError("denied")
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _open_raising_for_maxma)

    # Should not raise; the PermissionError is swallowed.
    errors = error_collector._scan_log_files()
    assert errors == []


# ── _read_tauri_startup_log: OSError path (382-383) ──────────────────


def test_read_tauri_startup_log_oserror(isolated_logs_dir, monkeypatch):
    """Lines 382-383: when reading tauri.log raises OSError/PermissionError,
    the method returns {available: False, reason: '读取失败: ...'}.
    """
    # Create tauri.log so exists() returns True.
    (isolated_logs_dir / "tauri.log").write_text("content\n", encoding="utf-8")

    real_open = builtins.open

    def _open_raising_for_tauri(file, *args, **kwargs):
        name = str(file)
        if name.endswith("tauri.log"):
            raise PermissionError("tauri denied")
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _open_raising_for_tauri)

    result = error_collector._read_tauri_startup_log()
    assert result["available"] is False
    assert "读取失败" in result["reason"]


# ── _read_tauri_startup_log: generic Exception (391-393) ─────────────


def test_read_tauri_startup_log_generic_exception(isolated_logs_dir, monkeypatch):
    """Lines 391-393: a non-OSError exception (e.g. from deque) is caught by
    the outer try/except and returns {available: False, reason: str(e)}.
    """
    # Create tauri.log so exists() returns True.
    (isolated_logs_dir / "tauri.log").write_text("content\n", encoding="utf-8")

    # Make deque() raise a generic (non-OSError) exception to bypass the inner
    # except (OSError, PermissionError) and hit the outer except Exception.
    def _boom_deque(*args, **kwargs):
        raise RuntimeError("deque exploded")

    monkeypatch.setattr(diag_mod, "deque", _boom_deque)

    result = error_collector._read_tauri_startup_log()
    assert result["available"] is False
    assert "deque exploded" in result["reason"]


def test_read_tauri_startup_log_missing_file(isolated_logs_dir):
    """Cover the 'tauri.log 不存在' early-return (line 375)."""
    result = error_collector._read_tauri_startup_log()
    assert result["available"] is False
    assert result["reason"] == "tauri.log 不存在"


def test_read_tauri_startup_log_success(isolated_logs_dir):
    """Cover the success path (lines 385-390) for tauri.log reading."""
    tauri_log = isolated_logs_dir / "tauri.log"
    tauri_log.write_text("a\nb\nc\n", encoding="utf-8")

    result = error_collector._read_tauri_startup_log()
    assert result["available"] is True
    assert result["line_count"] == 3
    assert result["lines"] == ["a\n", "b\n", "c\n"]


# ── get_log_files_info: non-file entry skip (404) ────────────────────


def test_get_log_files_info_skips_directories_and_non_log_files(isolated_logs_dir):
    """Lines 404 + 407: subdirectories (is_file() False) and non-log files
    (not .log, not maxma.log.*, not tauri.log.*) are both skipped.
    """
    (isolated_logs_dir / "maxma.log").write_bytes(b"data")
    (isolated_logs_dir / "subdir").mkdir()  # skipped by is_file() (line 404)
    (isolated_logs_dir / "tauri.log").write_bytes(b"data")
    (isolated_logs_dir / "ignore.txt").write_bytes(b"x")  # skipped by pattern (line 407)
    (isolated_logs_dir / "notes.md").write_bytes(b"y")  # skipped by pattern (line 407)

    info = ErrorCollector.get_log_files_info()
    names = {f["name"] for f in info}
    assert "maxma.log" in names
    assert "tauri.log" in names
    assert "subdir" not in names
    assert "ignore.txt" not in names
    assert "notes.md" not in names


# ── get_log_files_info: stat OSError (410-411) ───────────────────────


def test_get_log_files_info_handles_stat_oserror(isolated_logs_dir, monkeypatch):
    """Lines 410-411: if entry.stat() raises OSError during size collection,
    size_bytes falls back to 0.

    Python 3.14+ changed Path.is_file() to call os.path.isfile() directly
    instead of self.stat(). We monkeypatch Path.is_file to return True
    unconditionally and Path.stat to raise OSError so the test works across
    all Python versions.
    """
    log_file = isolated_logs_dir / "maxma.log"
    log_file.write_bytes(b"data")

    # Ensure is_file() returns True regardless of Python version
    monkeypatch.setattr(Path, "is_file", lambda self: True)

    # Make Path.stat raise OSError for our target file
    real_stat = Path.stat

    def _stat_raising(self, *args, **kwargs):
        if self.name == "maxma.log":
            raise OSError("stat denied")
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", _stat_raising)

    info = ErrorCollector.get_log_files_info()
    entry = next(f for f in info if f["name"] == "maxma.log")
    assert entry["size_bytes"] == 0
    assert entry["size_mb"] == 0.0


# ── get_log_files_info: outer Exception (418-419) ────────────────────


def test_get_log_files_info_handles_outer_exception(isolated_logs_dir, monkeypatch):
    """Lines 418-419: if LOGS_DIR.iterdir() raises a non-OSError exception,
    the method catches it and returns whatever was collected so far (possibly []).

    Path instance attributes are read-only, so we patch at the class level with
    a wrapper that raises only for the isolated LOGS_DIR.
    """
    real_iterdir = Path.iterdir
    target_dir = isolated_logs_dir

    def _iterdir_boom(self):
        if self == target_dir:
            raise RuntimeError("iterdir exploded")
        return real_iterdir(self)

    monkeypatch.setattr(Path, "iterdir", _iterdir_boom)

    info = ErrorCollector.get_log_files_info()
    assert info == []


def test_get_log_files_info_missing_logs_dir(tmp_path, monkeypatch):
    """Cover the early-return when LOGS_DIR does not exist (line 400-401)."""
    missing = tmp_path / "nope"
    monkeypatch.setattr(diag_mod, "LOGS_DIR", missing)
    info = ErrorCollector.get_log_files_info()
    assert info == []


# ── _collect_system_info: cwd exception (437-438) ────────────────────


def test_collect_system_info_cwd_exception(monkeypatch):
    """Lines 437-438: if os.getcwd() raises, cwd falls back to 'N/A'."""
    def _getcwd_boom():
        raise OSError("cwd gone")

    monkeypatch.setattr("os.getcwd", _getcwd_boom)

    info = error_collector._collect_system_info()
    assert info["cwd"] == "N/A"


# ── _collect_system_info: _is_frozen exception (444-445) ─────────────


def test_collect_system_info_is_frozen_exception(monkeypatch):
    """Lines 444-445: if _is_frozen() raises, is_frozen falls back to False."""
    def _is_frozen_boom():
        raise RuntimeError("frozen check failed")

    monkeypatch.setattr("app_paths._is_frozen", _is_frozen_boom)

    info = error_collector._collect_system_info()
    assert info["is_frozen"] is False


# ── _collect_system_info: env_flags population (456) ─────────────────


def test_collect_system_info_env_flags_populated(monkeypatch):
    """Line 456: when MAXMA_ENV / MAXMA_LOG_LEVEL etc. are set, they appear
    in the env_flags dict.
    """
    monkeypatch.setenv("MAXMA_ENV", "test")
    monkeypatch.setenv("MAXMA_LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("MAXMA_API_PORT", "9999")

    info = error_collector._collect_system_info()
    assert info["env_flags"]["MAXMA_ENV"] == "test"
    assert info["env_flags"]["MAXMA_LOG_LEVEL"] == "DEBUG"
    assert info["env_flags"]["MAXMA_API_PORT"] == "9999"


def test_collect_system_info_env_flags_empty_when_unset(monkeypatch):
    """env_flags is empty when no MAXMA_* env vars are set."""
    for key in ("MAXMA_ENV", "MAXMA_LOG_LEVEL", "MAXMA_LOG_JSON", "MAXMA_API_PORT"):
        monkeypatch.delenv(key, raising=False)

    info = error_collector._collect_system_info()
    assert info["env_flags"] == {}


# ── add_exception + ErrorRecord dataclass ────────────────────────────


def test_add_exception_extracts_traceback():
    """add_exception builds a CRITICAL record with a formatted traceback."""
    try:
        raise ValueError("test boom")
    except ValueError as exc:
        error_collector.add_exception(exc, category="tool", message="custom msg")

    records = error_collector.get_all()
    assert len(records) == 1
    r = records[0]
    assert r.level == "CRITICAL"
    assert r.category == "tool"
    assert r.message == "custom msg"
    assert "ValueError: test boom" in r.exception
    assert "Traceback" in r.exception


def test_add_exception_default_message():
    """add_exception without explicit message uses type+str(exc)."""
    try:
        raise RuntimeError("default msg")
    except RuntimeError as exc:
        error_collector.add_exception(exc)

    records = error_collector.get_all()
    assert len(records) == 1
    assert "RuntimeError: default msg" in records[0].message


# ── Singleton + buffer behaviour ─────────────────────────────────────


def test_error_collector_singleton_is_same_instance():
    """get() returns the same singleton across calls (double-checked lock)."""
    a = ErrorCollector.get()
    b = ErrorCollector.get()
    assert a is b
    assert a is error_collector


def test_clear_returns_count_and_empties_buffer():
    """clear() returns the number of removed records and empties the buffer."""
    error_collector.add_error("ERROR", "agent", "one")
    error_collector.add_error("ERROR", "agent", "two")
    count = error_collector.clear()
    assert count == 2
    assert error_collector.get_all() == []


def test_clear_on_empty_returns_zero():
    """clear() on an empty buffer returns 0."""
    assert error_collector.clear() == 0


def test_add_directly_with_error_record():
    """add() accepts a pre-built ErrorRecord."""
    rec = ErrorRecord(
        timestamp="2026-01-01 00:00:00",
        level="WARNING",
        category="system",
        message="direct",
    )
    error_collector.add(rec)
    assert error_collector.get_all() == [rec]


# ── export_report: merge + dedup ─────────────────────────────────────


def test_export_report_deduplicates_memory_and_log_errors(isolated_logs_dir):
    """export_report merges memory + log-file errors, deduplicating by
    timestamp+message (the memory version wins).

    Line 168: the `continue` when a duplicate key is found.
    """
    fixed_ts = "2026-07-17 10:00:00"
    error_collector.add(
        ErrorRecord(
            timestamp=fixed_ts,
            level="ERROR",
            category="agent",
            message="dup error",
        )
    )
    # Log file: first entry has SAME timestamp+message as the memory error
    # (deduplicated at line 168); second entry is unique.
    log_dup = {"ts": fixed_ts, "level": "ERROR", "msg": "dup error"}
    log_unique = {"ts": "2026-07-17 11:00:00", "level": "ERROR", "msg": "log only"}
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(log_dup) + "\n" + json.dumps(log_unique) + "\n", encoding="utf-8"
    )

    report = error_collector.export_report()
    messages = [e["message"] for e in report["errors"]]
    # "dup error" appears once (deduplicated), "log only" appears once.
    assert messages.count("dup error") == 1
    assert "log only" in messages


def test_export_report_sorts_errors_by_timestamp(isolated_logs_dir):
    """export_report sorts merged errors by timestamp ascending."""
    error_collector.add_error("ERROR", "agent", "mem err")
    log1 = {"ts": "2026-07-17 09:00:00", "level": "ERROR", "msg": "early"}
    log2 = {"ts": "2026-07-17 11:00:00", "level": "ERROR", "msg": "late"}
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(log2) + "\n" + json.dumps(log1) + "\n", encoding="utf-8"
    )

    report = error_collector.export_report()
    timestamps = [e.get("timestamp") or "" for e in report["errors"]]
    assert timestamps == sorted(timestamps)


def test_export_report_stats_are_consistent(isolated_logs_dir):
    """export_report stats reflect memory + log counts and merged total."""
    error_collector.add_error("ERROR", "agent", "m1")
    error_collector.add_error("ERROR", "agent", "m2")
    log_entry = {"ts": "2026-07-17 10:00:00", "level": "ERROR", "msg": "l1"}
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(log_entry) + "\n", encoding="utf-8"
    )

    report = error_collector.export_report()
    assert report["stats"]["memory_error_count"] == 2
    assert report["stats"]["log_file_error_count"] == 1
    assert report["stats"]["merged_total"] == 3
    assert report["stats"]["buffer_capacity"] == ErrorCollector.MAX_IN_MEMORY
    assert isinstance(report["stats"]["uptime_seconds"], int)


def test_export_text_report_no_errors(isolated_logs_dir):
    """Text report renders the 'no errors' block when there are no errors."""
    text = error_collector.export_text_report()
    assert "无错误记录" in text
    assert "报告结束" in text


# ── _scan_log_files: JSONDecodeError keyword fallback ────────────────


def test_scan_log_files_non_json_error_line(isolated_logs_dir):
    """Non-JSON lines containing ERROR/CRITICAL are captured with level UNKNOWN."""
    (isolated_logs_dir / "maxma.log").write_text(
        "2026-07-17 10:00:00 ERROR something broke badly\n", encoding="utf-8"
    )

    errors = error_collector._scan_log_files()
    assert len(errors) == 1
    assert errors[0]["level"] == "UNKNOWN"
    assert errors[0]["category"] == "log_file"
    assert "something broke" in errors[0]["message"]
    assert errors[0]["source_file"] == "maxma.log"
    assert errors[0]["source_line"] == 1


def test_scan_log_files_non_json_non_error_line_skipped(isolated_logs_dir):
    """Non-JSON lines without ERROR/CRITICAL keywords are skipped."""
    (isolated_logs_dir / "maxma.log").write_text(
        "2026-07-17 10:00:00 INFO just info\n", encoding="utf-8"
    )

    errors = error_collector._scan_log_files()
    assert errors == []


def test_scan_log_files_warning_level_skipped(isolated_logs_dir):
    """WARNING level entries are not captured (only ERROR/CRITICAL)."""
    log_entry = {"ts": "2026-07-17 10:00:00", "level": "WARNING", "msg": "warn"}
    (isolated_logs_dir / "maxma.log").write_text(
        json.dumps(log_entry) + "\n", encoding="utf-8"
    )

    errors = error_collector._scan_log_files()
    assert errors == []


def test_scan_log_files_rotation_files(isolated_logs_dir):
    """maxma.log.1 .. maxma.log.5 rotation files are also scanned."""
    for i in range(1, 6):
        entry = {"ts": f"2026-07-17 1{i}:00:00", "level": "ERROR", "msg": f"rot{i}"}
        (isolated_logs_dir / f"maxma.log.{i}").write_text(
            json.dumps(entry) + "\n", encoding="utf-8"
        )

    errors = error_collector._scan_log_files()
    messages = sorted(e["message"] for e in errors)
    assert messages == ["rot1", "rot2", "rot3", "rot4", "rot5"]


# ── _collect_autonomy_status default ─────────────────────────────────


def test_collect_autonomy_status_returns_unavailable():
    """Default _collect_autonomy_status returns available=False (OMP replaced)."""
    status = error_collector._collect_autonomy_status()
    assert status["available"] is False
    assert "OMP" in status["reason"] or "removed" in status["reason"].lower()
