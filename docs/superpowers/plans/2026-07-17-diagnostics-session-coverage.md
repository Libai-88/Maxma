# Diagnostics & Session Manager Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Increase coverage for `api/diagnostics.py` (83%), `api/session_manager.py` (84%), `api/db/core.py` (84%) to 90%+.

**Architecture:** Read each module → identify uncovered lines → design tests → implement → verify.

**Tech Stack:** Python 3.13, pytest, pytest-cov

## Baseline (measured 2026-07-17)

```
api\db\core.py                        73     12    84%   179, 182, 198-200, 226-228, 238-240, 245
api\diagnostics.py                   247     42    83%   224-231, 242-246, 280, 282, 284, 286, 288, 292-294, 296-298, 326, 359-360, 382-383, 391-393, 404, 410-411, 418-419, 437-438, 444-445, 456
api\session_manager.py               137     22    84%   75, 96, 100, 108-118, 134-135, 156, 178-196, 221-223
```

## Constraints

- Only create new test files; do NOT modify existing source code or existing tests.
- Do NOT touch other agents' files (db/metrics.py, metrics.py, checkpointer_factory.py, time_traveler.py, pi_bridge/*, routes/chat.py, sidecar_manager.py, conftest.py, bun-sidecar/, web/, pyproject.toml, requirements-lock.txt).
- Commit after each module's tests are green.
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`

## Task 1 — `api/db/core.py` (84% → 95%+)

**Target file:** `tests/test_api/test_db_core_coverage.py`

**Uncovered lines & test plan:**

| Lines | What | Test approach |
|-------|------|---------------|
| 179, 182 | `initialize_database()` early-return when already initialized | Call `initialize_database()` twice with `_db_initialized=True`; assert second call is no-op (no re-init). |
| 198-200 | Migration upgrade path for existing DB with `schema_version < SCHEMA_VERSION` | Create a DB with `schema_version=1` only, reset `_db_initialized=False`, monkeypatch `DB_PATH` to tmp, call `initialize_database()`, assert v2/v3 tables exist and version bumped. |
| 226-228 | `transaction()` rollback on exception | Use `transaction()` ctx, raise inside, assert rollback executed (data not persisted). |
| 238-240 | `row_to_dict(None)` returns None | Call `row_to_dict(None)`. |
| 245 | `rows_to_dicts([])` and non-empty | Call `rows_to_dicts` with empty + populated list. |

**Fixtures:** reuse the `isolated_db` pattern from `test_db_auth.py` (monkeypatch `DB_PATH` + `_db_initialized`).

**Verification:** run targeted tests, confirm `api/db/core.py` ≥ 95%.

**Commit:** `test: boost api/db/core.py coverage to 95%+`

## Task 2 — `api/session_manager.py` (84% → 95%+)

**Target file:** `tests/test_api/test_session_manager_coverage.py`

**Uncovered lines & test plan:**

| Lines | What | Test approach |
|-------|------|---------------|
| 75 | `set_permission_mode` raises `ValueError` on invalid mode | Call `session.set_permission_mode("bogus")`, assert `ValueError`. |
| 96 | `set_deferred_run_manager` | Call `manager.set_deferred_run_manager(obj)`, assert attribute set. |
| 100 | `set_workflow_run_manager` | Call `manager.set_workflow_run_manager(obj)`, assert attribute set. |
| 108-118 | `create_sub_session` | Call `manager.create_sub_session("task", parent_session_id=...)`, assert fields (`is_subagent`, `parent_session_id`, `_sub_agent_task`, `_pending_result` future). |
| 134-135 | `get_or_create` concurrent path — existing session returned | Pre-populate `_sessions[sid]`, call `get_or_create(sid)`, assert same instance returned (not new). |
| 156 | `delete()` cancelled-task debug log path | Create a session with a running `_active_task` that gets cancelled cleanly; call `delete()`, assert debug log captured. |
| 178-196 | `list_sessions` | Create multiple sessions (incl. sub-agent, const), call `list_sessions()`, assert dict shape, sort order, `has_active_agent`. |
| 221-223 | `session_count` excludes sub-agents | Create normal + sub-agent sessions, assert count excludes subagents. |

**Module loading:** reuse `_load_session_manager_module()` pattern from `test_session_manager.py` (mock langgraph) to avoid any import surprises; load under distinct module name to not clash.

**Verification:** run targeted tests, confirm `api/session_manager.py` ≥ 95%.

**Commit:** `test: boost api/session_manager.py coverage to 95%+`

## Task 3 — `api/diagnostics.py` (83% → 92%+)

**Target file:** `tests/test_api/test_diagnostics_coverage.py`

**Uncovered lines & test plan:**

| Lines | What | Test approach |
|-------|------|---------------|
| 280, 282, 284, 286, 288 | text report optional fields (trace_id, session_id, request_id, logger_name, source_file) | Add an `ErrorRecord` with all optional fields set + a log-file-sourced error (has `source_file`), call `export_text_report()`, assert substrings present. |
| 292-294 | text report exception block | Add error with `exception="line1\nline2"`, assert both lines rendered. |
| 296-298 | text report extra dict block | Add error with `extra={"k": "v"}`, assert rendered. |
| 224-231 | text report autonomy `available=True` branch | Monkeypatch `_collect_autonomy_status` to return `{"available": True, "running": True, "last_tick_at": "...", "tick_count": 5, "last_tick_report_summary": {...}}`; call `export_text_report()`; assert autonomy section renders summary. |
| 242-246 | text report tauri log `available=True` branch | Create `tauri.log` in LOGS_DIR with content; call `export_text_report()`; assert path/line_count/lines rendered. |
| 326 | `_scan_log_files` empty-line skip | Write `maxma.log` with an empty line between JSON entries; assert empty line skipped. |
| 359-360 | `_scan_log_files` OSError/PermissionError | Monkeypatch `open` to raise `PermissionError` for a log file; assert continues gracefully. |
| 382-383 | `_read_tauri_startup_log` OSError path | Create `tauri.log` then monkeypatch `open` to raise `PermissionError`; assert `available=False`. |
| 391-393 | `_read_tauri_startup_log` generic exception | Monkeypatch `LOGS_DIR.exists` to raise; assert `available=False` + reason. |
| 404 | `get_log_files_info` non-file entry skip | Create a subdirectory in LOGS_DIR; assert it's skipped. |
| 410-411 | `get_log_files_info` stat OSError | Create a file whose `stat()` raises OSError (monkeypatch `Path.stat`); assert size_bytes=0. |
| 418-419 | `get_log_files_info` outer exception | Monkeypatch `LOGS_DIR.iterdir` to raise; assert returns []. |
| 437-438 | `_collect_system_info` cwd exception | Monkeypatch `os.getcwd` to raise; assert `cwd="N/A"`. |
| 444-445 | `_collect_system_info` `_is_frozen` import exception | Monkeypatch `app_paths._is_frozen` to raise (or block import); assert `is_frozen=False`. |
| 456 | `_collect_system_info` env_flags population | Set `MAXMA_ENV`/`MAXMA_LOG_LEVEL` env vars via monkeypatch; assert they appear in `env_flags`. |

**Fixtures:** `reset_collector` autouse (clear before/after) + `isolated_logs_dir` (monkeypatch `LOGS_DIR` to tmp_path).

**Verification:** run targeted tests, confirm `api/diagnostics.py` ≥ 92%.

**Commit:** `test: boost api/diagnostics.py coverage to 92%+`

## Task 4 — Final verification

1. Run full coverage: `.venv\Scripts\python.exe -m pytest tests/ --cov=api.diagnostics --cov=api.session_manager --cov=api.db.core --cov-report=term-missing -q`
2. Confirm all three modules ≥ 90%.
3. Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
4. Final commit if any cleanup needed.

## Risk Notes

- `api/db/core.py` line 250 `initialize_database()` runs at import time; tests must use isolated `DB_PATH` + reset `_db_initialized` to avoid polluting real DB.
- `api/diagnostics.py` `_collect_autonomy_status` always returns `available=False` (OMP replaced autonomy); to cover lines 224-231 we must monkeypatch the method on the instance.
- `api/session_manager.py` tests use a module-reload trick to mock langgraph; new test file must replicate this to stay self-contained.
