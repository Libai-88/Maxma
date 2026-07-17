# Backend Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Increase backend test coverage from current baseline (37%) to 60%+ by adding tests for low-coverage modules. Only create new test files; do not modify existing source code (unless a real bug is found — record it, do not fix in tests).

**Architecture:** Measure baseline → identify lowest coverage modules → add tests for each (happy path + error path) → remeasure. Each module gets its own commit.

**Tech Stack:** Python 3.13, FastAPI, pytest, pytest-cov

## Baseline (measured 2026-07-17)

```
TOTAL  5647 stmts  3567 missing  37%
123 passed, 7 skipped, 1 deselected
```

### Lowest-coverage modules (sorted by missing lines)

| Module | Total | Missing | % | Priority |
|---|---|---|---|---|
| api/routes/sessions.py | 308 | 267 | 13% | HIGH (biggest) |
| api/diagnostics.py | 247 | 191 | 23% | HIGH |
| api/middleware/rate_limit.py | 181 | 138 | 24% | HIGH |
| api/routes/sticker_favorites.py | 178 | 132 | 26% | HIGH (listed) |
| api/routes/chat.py | 208 | 120 | 42% | MED (complex) |
| api/health.py | 128 | 74 | 42% | HIGH (listed) |
| api/server.py | 117 | 75 | 36% | MED |
| api/routes/mcp.py | 149 | 91 | 39% | MED |
| api/routes/workflows.py | 95 | 65 | 32% | MED |
| api/routes/sticker_upload.py | 85 | 62 | 27% | HIGH (listed) |
| api/routes/persona.py | 165 | 80 | 52% | MED |
| api/context_usage.py | 64 | 56 | 12% | MED |
| api/middleware/request_log.py | 57 | 44 | 23% | MED |
| api/routes/env_vars.py | 74 | 41 | 45% | HIGH (listed) |
| api/routes/diagnostics.py | 57 | 40 | 30% | HIGH (listed) |
| api/routes/upload.py | 89 | 39 | 56% | HIGH (listed) |
| api/routes/stickers.py | 60 | 45 | 25% | MED |
| api/routes/deferred_runs.py | 70 | 52 | 26% | MED |
| api/yaml_store.py | 77 | 26 | 66% | HIGH (listed) |
| api/routes/skills.py | 34 | 24 | 29% | HIGH (listed) |
| api/routes/transcripts.py | 36 | 24 | 33% | MED |
| api/routes/balance.py | 34 | 23 | 32% | MED |
| api/routes/mcp_test.py | 39 | 22 | 44% | LOW |
| api/routes/path_whitelist.py | 68 | 35 | 49% | MED |
| api/routes/audit_log.py | 22 | 10 | 55% | HIGH (listed) |
| api/routes/news.py | 29 | 8 | 72% | HIGH (listed) |
| api/routes/metrics.py | 10 | 3 | 70% | HIGH (listed) |
| api/runtime_status.py | 50 | 8 | 84% | HIGH (listed) |
| api/routes/activity.py | 35 | 19 | 46% | MED |
| api/routes/autonomy.py | 26 | 12 | 54% | LOW |
| api/routes/event_hooks.py | 30 | 14 | 53% | LOW |
| api/routes/session_compress.py | 19 | 10 | 47% | LOW |
| api/routes/restart.py | 14 | 8 | 43% | LOW |

**Strategy:** Cover the explicitly listed target modules first (≈470 missing lines), then expand to additional easy-to-test route modules until 60% is reached (need to cover ≈1300 lines total).

---

## Tasks

Each task follows the **supplementary-test TDD** pattern: read source → write tests verifying existing behavior → run → commit. Tests live under `tests/test_api/`. Tests use `fastapi.testclient.TestClient` for route modules and direct calls for non-route modules.

### Task 1 — Baseline measurement ✅
- Run coverage, record per-module percentages. Done: 37% total.

### Task 2 — `api/routes/upload.py` (56% → 90%+)
**Why:** Listed target; 39 missing lines covering `/uploads` GET list and `/uploads/{file_id}` DELETE plus size-limit / extension error paths.
**Tests (`tests/test_api/test_upload_extra.py`):**
- `test_list_uploads_empty` — empty dir returns `{"files": [], "count": 0}`
- `test_list_uploads_with_files` — create `.meta` + data file, verify listing
- `test_delete_upload_by_meta` — delete existing file via meta lookup
- `test_delete_upload_glob_fallback` — delete when only data file (no meta) exists
- `test_delete_upload_not_found` — 404 when file_id missing
- `test_upload_rejects_empty_filename` — 400
- `test_upload_rejects_disallowed_extension` — 400
- `test_upload_rejects_oversize_content_length` — 413 via Content-Length header
- `test_upload_rejects_oversize_body` — 413 via actual body exceeding 20MB
- `test_upload_writes_meta_file` — verify `.meta` sidecar is written
**Commit:** `test: cover upload route list/delete and error paths`

### Task 3 — `api/routes/sticker_favorites.py` (26% → 85%+)
**Why:** Listed target; 132 missing lines. Pure logic + YAML, easy to isolate with `tmp_path` + monkeypatching module-level `FAVORITES_PATH`/`RECENT_PATH`/`STICKERS_DIR`.
**Tests (`tests/test_api/test_sticker_favorites.py`):**
- `test_validate_sticker_ref_rejects_bad_category` / `_bad_filename`
- `test_load_yaml_safe_creates_default_favorites` / `_recent`
- `test_save_yaml_safe_writes_file`
- `test_get_favorites_empty` / `_with_items`
- `test_add_favorite_new` / `_duplicate` / `_missing_sticker`
- `test_remove_favorite_found` / `_not_found`
- `test_record_sticker_usage` / `_skip`
- `test_get_recent_dedup_and_limit`
- `test_get_recommendations_returns_items` (uses real STICKERS_DIR which exists in repo)
- `test_get_sticker_index_includes_builtin` / `_custom`
- `test_get_time_period_branches` (mock hour)
- `test_select_sticker_missing_category`
**Commit:** `test: cover sticker_favorites routes and helpers`

### Task 4 — `api/routes/sticker_upload.py` (27% → 80%+)
**Why:** Listed target; 62 missing lines.
**Tests (`tests/test_api/test_sticker_upload.py`):**
- `test_upload_rejects_missing_filename` — 400
- `test_upload_rejects_bad_extension` — 400
- `test_upload_rejects_oversize` — 400 (monkeypatch MAX_FILE_SIZE small)
- `test_upload_existing_hash_returns_duplicate` — pre-create dst file
- `test_upload_convert_failure_returns_500` — monkeypatch `_convert_to_webp` → False
- `test_upload_success_path` — monkeypatch `_convert_to_webp` → True, verify response
- `test_list_custom_stickers_empty` / `_with_files`
- `test_delete_custom_sticker_invalid_name` — 400
- `test_delete_custom_sticker_missing` — 404
- `test_delete_custom_sticker_success`
- `test_convert_to_webp_static_image` (real tiny PNG via PIL, skip if PIL missing)
- `test_convert_to_webp_failure_returns_false` (bad input)
**Commit:** `test: cover sticker_upload routes and webp conversion`

### Task 5 — `api/routes/skills.py` (29% → 95%+)
**Why:** Listed target; 24 missing lines. Small module, easy to test with `tmp_path` + monkeypatch `SKILLS_DIR`.
**Tests (`tests/test_api/test_skills_routes.py`):**
- `test_list_skills_missing_dir` → `[]`
- `test_list_skills_lists_enabled_and_disabled`
- `test_get_skill_returns_content` / `_disabled`
- `test_get_skill_not_found` — 404
- `test_toggle_skill_disable` / `_enable` / `_not_found`
**Commit:** `test: cover skills route list/get/toggle`

### Task 6 — `api/routes/metrics.py` + `api/routes/audit_log.py` + `api/routes/news.py`
**Why:** Three small listed targets; 3+10+8 = 21 missing lines.
**Tests (one file each):**
- `tests/test_api/test_metrics_routes.py`: snapshot returns dict with `http`; history returns `window_seconds` + `snapshots`; `window` validation `ge=1` (422).
- `tests/test_api/test_audit_log_routes.py`: all 5 endpoints return 404 with `detail` message; query params accept ranges.
- `tests/test_api/test_news_routes.py`: `list_news` returns sorted entries from real `news.yaml`; missing file returns empty (monkeypatch path).
**Commit:** `test: cover metrics/audit_log/news routes`

### Task 7 — `api/routes/diagnostics.py` + `api/diagnostics.py` (23% → 70%+)
**Why:** Listed target + its underlying collector; 40+191 = 231 missing lines. Big win.
**Tests (`tests/test_api/test_diagnostics_routes.py` + `tests/test_api/test_error_collector.py`):**
- Routes: `GET /diagnostics/error-log` returns report dict; `GET .../text` returns `text/plain` with Content-Disposition; `DELETE /diagnostics/error-log` clears and returns deleted count; `GET /diagnostics/logs` returns files/total; `DELETE /diagnostics/logs` removes rotation files (create `maxma.log.1` in tmp LOGS_DIR) but keeps active; missing logs dir path.
- Collector: `add`/`add_error`/`add_exception`/`get_all`/`clear`; `export_report` merges memory+file; `_scan_log_files` parses JSON ERROR lines + non-JSON fallback; `get_log_files_info` filters; `_collect_system_info` includes version; `_read_tauri_startup_log` missing/ present.
**Commit:** `test: cover diagnostics routes and error collector`

### Task 8 — `api/routes/env_vars.py` (45% → 90%+)
**Why:** Listed target; 41 missing lines.
**Tests (`tests/test_api/test_env_vars_routes.py`):**
- `test_mask_value_short` / `_long`
- `test_refresh_runtime_settings_populates_environ` (monkeypatch dotenv_values, reload_settings)
- `test_list_env_vars_returns_items` with/without values
- `test_update_env_var_unknown_key` — 400
- `test_update_env_var_empty_value` — 400
- `test_update_env_var_success` (monkeypatch `set_key`)
- `test_update_env_var_set_key_fails` — 500
- `test_batch_update_skips_unknown_and_empty`, returns updated list
- `test_batch_update_set_key_failure` — 500
**Commit:** `test: cover env_vars route and masking helpers`

### Task 9 — `api/yaml_store.py` (66% → 95%+)
**Why:** Listed target; 26 missing lines (lock + backup-once).
**Tests (`tests/test_api/test_yaml_store.py`):**
- `test_lock_path_suffix`
- `test_yaml_file_lock_acquires_and_releases` (tmp path)
- `test_yaml_file_lock_creates_lockfile_parent`
- `test_load_yaml_missing_returns_default` / `_empty_returns_default` / `_invalid_returns_default`
- `test_dump_yaml_atomic_writes_and_replaces`
- `test_dump_yaml_backup_once_first_call_succeeds` / `_second_call_returns_false`
- `test_dump_yaml_backup_once_hardlink_collision_returns_false`
- `test_get_inproc_lock_returns_same_lock_for_same_path`
**Commit:** `test: cover yaml_store lock and backup helpers`

### Task 10 — `api/health.py` (42% → 80%+)
**Why:** Listed target; 74 missing lines.
**Tests (`tests/test_api/test_health.py`):**
- `test_check_llm_no_probe_returns_ok`
- `test_check_llm_probe_no_sidecar` / `_sidecar_none_client` / `_success` / `_timeout` / `_exception` (mock app.state.sidecar_manager)
- `test_check_memory_returns_ok`
- `test_check_native_tools_ok` / `_error` (app.state.native_tools present/raising)
- `test_check_mcp_tools_empty` / `_with_tools` / `_error`
- `test_get_ltm_diagnostic_returns_none` / `associate_ltm_provider_returns_none`
- `test_get_health_report_overall_ok` / `_degraded` (mock check functions)
- `test_check_health_sync_ok` / `_degraded_when_no_native_tools` / `_exception_returns_unknown`
- `test_component_health_fill_runtime_fields` / `from_runtime`
**Commit:** `test: cover health module component checks`

### Task 11 — `api/runtime_status.py` (84% → 100%)
**Why:** Listed target; 8 missing lines (reason_code branches).
**Tests (`tests/test_api/test_runtime_status_extra.py`):**
- `test_reason_code_for_ok_returns_none`
- `test_reason_code_for_rate_limited` / `_timeout` / `_network` / `_degraded_default` / `_error_default`
- `test_user_summary_for_unknown_returns_none`
- `test_runtime_status_public_detail_redacts`
- `test_runtime_status_health_defaults_updated_at`
**Commit:** `test: cover runtime_status reason code branches`

### Task 12 — `api/routes/sessions.py` (13% → 45%+) [stretch]
**Why:** Biggest single module (267 missing). Even partial coverage is a big win. Read source first; cover the simplest GET endpoints and pure helpers.
**Tests (`tests/test_api/test_sessions_routes.py`):** TBD after reading source — at minimum cover `GET /sessions` list, `GET /sessions/{id}`, and any pure helper functions.
**Commit:** `test: cover sessions route basic list/get endpoints`

### Task 13 — Additional route modules [stretch, as needed]
If coverage still below 60% after Task 12, add tests for:
- `api/routes/stickers.py` (25%, 45 missing)
- `api/routes/workflows.py` (32%, 65 missing)
- `api/routes/deferred_runs.py` (26%, 52 missing)
- `api/routes/balance.py` (32%, 23 missing)
- `api/routes/transcripts.py` (33%, 24 missing)
- `api/routes/path_whitelist.py` (49%, 35 missing)
- `api/routes/activity.py` (46%, 19 missing)
- `api/routes/restart.py` (43%, 8 missing)
- `api/routes/session_compress.py` (47%, 10 missing)
- `api/routes/mcp.py` (39%, 91 missing)
- `api/middleware/rate_limit.py` (24%, 138 missing)
- `api/middleware/request_log.py` (23%, 44 missing)
- `api/context_usage.py` (12%, 56 missing)
**Commit:** `test: cover additional route modules for 60% target`

### Task 14 — Remeasure and verify ≥60%
- Run the same coverage command.
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
- Confirm total ≥ 60%.
**Commit (if cleanup needed):** `test: finalize coverage boost`

---

## Constraints recap
- Only create new test files.
- Do NOT modify: `tests/test_api/test_files.py`, `bun-sidecar/`, `requirements-lock.txt`, `.github/workflows/`, any source under `api/` or `agent/`.
- Run tests: `.venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
- Commit after each module.
