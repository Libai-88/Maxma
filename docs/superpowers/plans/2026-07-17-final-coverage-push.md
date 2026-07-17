# Final Coverage Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push overall coverage from 99% (73 uncovered lines) to 99.5%+ by covering remaining uncovered lines across 13 modules.

**Architecture:** Identify exact uncovered lines → read source → design targeted tests → implement → verify. Only create new test files; never modify source code or existing tests.

**Tech Stack:** Python 3.13, pytest, pytest-cov, pytest-asyncio

---

## Baseline (before)

```
TOTAL: 5453 stmts, 73 miss, 99%
```

Uncovered lines by module (sorted by miss count):

| Module | Stmts | Miss | Cover | Missing lines |
|--------|-------|------|-------|---------------|
| api/middleware/rate_limit.py | 181 | 16 | 91% | 57, 123, 130, 135-140, 146-150, 246, 396 |
| agent/prompts.py | 296 | 11 | 96% | 145-146, 148, 161-162, 164, 401-402, 454-455, 457 |
| api/routes/diagnostics.py | 57 | 8 | 86% | 98, 117-118, 129-130, 139-141 |
| api/artifacts/schema.py | 99 | 7 | 93% | 28, 66, 71, 133, 137, 153-154 |
| api/yaml_store.py | 77 | 6 | 92% | 93, 117-118, 122-123, 127 |
| api/interaction.py | 69 | 6 | 91% | 29, 34, 39, 77, 102, 113 |
| api/server.py | 117 | 4 | 97% | 167-170 |
| agent/persona_loader.py | 48 | 3 | 94% | 17, 30, 34 |
| api/const_session_store.py | 55 | 3 | 95% | 80-82 |
| api/routes/stickers.py | 60 | 3 | 95% | 39, 65, 77 |
| api/auth.py | 28 | 2 | 93% | 28-29 |
| api/middleware/request_log.py | 57 | 2 | 96% | 32, 83 |
| api/pi_bridge/rpc_client.py | 118 | 2 | 98% | 161-162 |

---

## File Structure (new test files only)

- `tests/test_api/test_diagnostics_routes_push.py` — api/routes/diagnostics.py cleanup edge cases
- `tests/test_api/test_artifact_schema_push.py` — api/artifacts/schema.py validation + authorizer edge cases
- `tests/test_api/test_yaml_store_push.py` — api/yaml_store.py error paths in atomic/backup writes
- `tests/test_api/test_interaction_push.py` — api/interaction.py auto_approve + cancel edge cases
- `tests/test_api/test_server_push.py` — api/server.py production static fallback
- `tests/test_api/test_auth_push.py` — api/auth.py OSError read path
- `tests/test_api/test_rate_limit_push.py` — api/middleware/rate_limit.py cleanup task + WS scope
- `tests/test_api/test_request_log_push.py` — api/middleware/request_log.py WS scope + 5xx log
- `tests/test_api/test_const_session_store_push.py` — api/const_session_store.py load exception
- `tests/test_api/test_stickers_routes_push.py` — api/routes/stickers.py defensive branches
- `tests/test_agent/test_prompts_push.py` — agent/prompts.py resolve OSError + dedup
- `tests/test_agent/test_persona_loader_push.py` — agent/persona_loader.py missing default + no frontmatter
- `tests/test_pi_bridge/test_rpc_client_push.py` — api/pi_bridge/rpc_client.py read loop crash

---

## Task 1: api/routes/diagnostics.py (8 lines: 98, 117-118, 129-130, 139-141)

**Uncovered analysis (cleanup_old_log_files DELETE endpoint):**
- Line 98: `continue` when `entry.is_file()` is False (directory entry in LOGS_DIR)
- Lines 117-118: `except OSError: size = 0` when `entry.stat()` fails
- Lines 129-130: `except (OSError, PermissionError) as e:` when `entry.unlink()` fails
- Lines 139-141: `except Exception as e:` outer handler

**Files:**
- Create: `tests/test_api/test_diagnostics_routes_push.py`

- [ ] **Step 1: Write tests covering directory skip, stat OSError, unlink failure, and outer exception**

Test cases:
1. `test_cleanup_skips_directory_entries` — create a subdirectory inside LOGS_DIR alongside a rotation file; verify the subdir is skipped (line 98) and the rotation file is deleted
2. `test_cleanup_stat_oserror_sets_zero_size` — mock `Path.stat` to raise OSError for a rotation file; verify `size_bytes` is 0 (lines 117-118)
3. `test_cleanup_unlink_failure_logs_warning` — mock `Path.unlink` to raise PermissionError for a rotation file; verify it's skipped (lines 129-130)
4. `test_cleanup_outer_exception_returns_error` — mock `LOGS_DIR.iterdir` to raise a non-OSError exception; verify the error response (lines 139-141)

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_diagnostics_routes_push.py -v`

- [ ] **Step 3: Commit**

```bash
git add tests/test_api/test_diagnostics_routes_push.py
git commit -m "test: cover diagnostics routes cleanup edge cases (8 lines)"
```

---

## Task 2: api/artifacts/schema.py (7 lines: 28, 66, 71, 133, 137, 153-154)

**Uncovered analysis:**
- Line 28: `raise ValueError("artifact text may not contain HTML markup")` — existing test fails on actions validation before reaching the model_validator; need valid actions + markup in label
- Line 66: `raise ValueError("artifact action IDs must be unique")` — duplicate action IDs
- Line 71: `raise ValueError("artifact payload exceeds the size limit")` — payload > 16KB
- Line 133: `return None` — bad signature (token has no ".")
- Line 137: `return None` — expired token
- Lines 153-154: `except (AttributeError, TypeError, ValueError, json.JSONDecodeError): return None` — malformed token

**Files:**
- Create: `tests/test_api/test_artifact_schema_push.py`

- [ ] **Step 1: Write tests for validation errors and authorizer failure paths**

Test cases:
1. `test_artifact_action_rejects_markup_in_label` — ArtifactAction with label containing `<` (line 28 via ArtifactAction.validate_plain_text)
2. `test_artifact_rejects_duplicate_action_ids` — InteractiveArtifact with two actions having same id (line 66)
3. `test_artifact_rejects_oversized_payload` — InteractiveArtifact with body > 16KB (line 71)
4. `test_authorize_returns_none_for_token_without_dot` — token without "." separator (line 133)
5. `test_authorize_returns_none_for_expired_token` — token with expiry in the past (line 137)
6. `test_authorize_returns_none_for_malformed_token` — token that causes JSONDecodeError (lines 153-154)

- [ ] **Step 2: Run tests + commit**

---

## Task 3: api/yaml_store.py (6 lines: 93, 117-118, 122-123, 127)

**Uncovered analysis:**
- Line 93: `os.unlink(tmp_name)` in `dump_yaml_atomic` finally — need `os.replace` to fail so tmp file persists
- Lines 117-118: `except FileExistsError: return False` in `dump_yaml_backup_once` — need `os.link` to raise FileExistsError (race condition; mock needed)
- Lines 122-123: `except OSError: pass` on `os.chmod` — need chmod to fail (mock)
- Line 127: `os.unlink(tmp_name)` in `dump_yaml_backup_once` finally — reached when FileExistsError path returns False (tmp not cleaned by line 119)

**Files:**
- Create: `tests/test_api/test_yaml_store_push.py`

- [ ] **Step 1: Write tests for atomic write failure and backup race/chmod errors**

Test cases:
1. `test_dump_yaml_atomic_cleans_tmp_on_replace_failure` — mock `os.replace` to raise OSError; verify tmp file is unlinked (line 93)
2. `test_dump_yaml_backup_once_returns_false_on_link_exists` — mock `os.link` to raise FileExistsError; verify returns False (lines 117-118) and tmp cleaned (line 127)
3. `test_dump_yaml_backup_once_chmod_oserror_swallowed` — mock `os.chmod` to raise OSError; verify returns True (lines 122-123)

- [ ] **Step 2: Run tests + commit**

---

## Task 4: api/interaction.py (6 lines: 29, 34, 39, 77, 102, 113)

**Uncovered analysis:**
- Line 29: `set_session_auto_approve` body — not called in existing tests
- Line 34: `get_session_auto_approve` body — not called
- Line 39: `clear_session_settings` body — not called
- Line 77: `return False` in `resolve` when `future.done()` — resolve twice
- Line 102: default reason in `cancel_all` when `reason is None`
- Line 113: `continue` in `cancel_all` when `future is None` (interaction_id in list but already removed)

**Files:**
- Create: `tests/test_api/test_interaction_push.py`

- [ ] **Step 1: Write tests for auto_approve settings and cancel edge cases**

Test cases:
1. `test_session_auto_approve_set_get_clear` — set/get/clear auto_approve (lines 29, 34, 39)
2. `test_resolve_done_future_returns_false` — register, resolve, resolve again → second returns False (line 77)
3. `test_cancel_all_default_reason` — cancel_all without reason arg (line 102)
4. `test_cancel_all_skips_none_future` — inject a stale interaction_id into _pending_by_session to trigger `future is None` continue (line 113)

- [ ] **Step 2: Run tests + commit**

---

## Task 5: api/server.py (4 lines: 167-170)

**Uncovered analysis:**
- Lines 167-170: `root_fallback` endpoint body — only defined when `MAXMA_ENV=production` and `dist_dir.exists()`

**Files:**
- Create: `tests/test_api/test_server_push.py`

- [ ] **Step 1: Write test for production static root fallback**

Test cases:
1. `test_production_root_fallback_serves_index` — set `MAXMA_ENV=production`, create a tmp `web/dist` with `index.html`, patch `WEB_DIST_DIR`, call `create_app()`, GET `/` → 200 with FileResponse
2. `test_production_root_fallback_missing_index` — same setup but no index.html → 404 JSON

- [ ] **Step 2: Run tests + commit**

---

## Task 6: api/auth.py (2 lines: 28-29)

**Uncovered analysis:**
- Lines 28-29: `except OSError: logger.warning(...)` when `AUTH_TOKEN_PATH.read_text()` raises OSError

**Files:**
- Create: `tests/test_api/test_auth_push.py`

- [ ] **Step 1: Write test for OSError on token file read**

Test cases:
1. `test_load_or_create_token_oserror_on_read_regenerates` — create auth_token.yaml, mock `Path.read_text` to raise OSError, verify token is regenerated (lines 28-29)

- [ ] **Step 2: Run tests + commit (batch with Tasks 1-5)**

---

## Task 7: api/middleware/rate_limit.py (16 lines: 57, 123, 130, 135-140, 146-150, 246, 396)

**Uncovered analysis:**
- Line 57: `return` in `_refill` when `elapsed <= 0` — mock time.monotonic to not advance
- Line 123: `return` in `start_cleanup_task` when task already running — call twice
- Line 130: `return` when `loop is None` — **likely dead code** (get_running_loop never returns None); document as uncoverable
- Lines 135-140: `_run` async cleanup loop — start task with short interval, await, verify cleanup runs
- Lines 146-150: `stop_cleanup_task` body — start then stop
- Line 246: WebSocket scope passthrough in `RateLimitMiddleware.__call__`
- Line 396: second `return _ws_rate_limiter` in double-checked locking — set singleton then call again

**Files:**
- Create: `tests/test_api/test_rate_limit_push.py`

- [ ] **Step 1: Write tests for refill, cleanup task lifecycle, WS scope, singleton**

Test cases:
1. `test_refill_no_op_when_elapsed_zero` — mock time.monotonic to return same value twice (line 57)
2. `test_start_cleanup_task_idempotent` — start twice, verify only one task (line 123)
3. `test_cleanup_task_runs_and_removes_idle_buckets` — start with short interval, add stale bucket, await, verify removed (lines 135-140)
4. `test_stop_cleanup_task_cancels_running` — start, then stop, verify task cancelled (lines 146-150)
5. `test_rate_limit_middleware_passthrough_websocket` — call middleware with `scope["type"]="websocket"` (line 246)
6. `test_get_ws_rate_limiter_double_checked_locking` — set singleton, call again (line 396)

- [ ] **Step 2: Run tests + commit**

---

## Task 8: agent/prompts.py (11 lines: 145-146, 148, 161-162, 164, 401-402, 454-455, 457)

**Uncovered analysis:**
- Lines 145-146: `except OSError: continue` on `p.resolve()` in `_current_fingerprint` skills scan
- Line 148: `continue` on duplicate canonical path in skills scan
- Lines 161-162: `except OSError: continue` on `p.resolve()` in macros scan
- Line 164: `continue` on duplicate canonical path in macros scan
- Lines 401-402: `except OSError: continue` on `sk_path.resolve()` in `_scan_anthropic_skills`
- Lines 454-455: `except OSError: continue` on `mp_path.resolve()` in `_scan_macros`
- Line 457: `continue` on duplicate canonical path in macros scan

**Files:**
- Create: `tests/test_agent/test_prompts_push.py`

- [ ] **Step 1: Write tests for resolve OSError and duplicate path dedup**

Test cases:
1. `test_fingerprint_handles_resolve_oserror_skills` — mock `Path.resolve` to raise OSError for a SKILL.md path (lines 145-146)
2. `test_fingerprint_dedup_skills_canonical` — make ANTHROPIC_SKILLS_DIR and SKILLS_DATA_DIR share a path (line 148)
3. `test_fingerprint_handles_resolve_oserror_macros` — mock `Path.resolve` to raise OSError for a MACRO.md path (lines 161-162)
4. `test_fingerprint_dedup_macros_canonical` — duplicate macro path (line 164)
5. `test_scan_skills_resolve_oserror` — mock resolve to raise in `_scan_anthropic_skills` (lines 401-402)
6. `test_scan_macros_resolve_oserror_and_dedup` — mock resolve to raise + duplicate path (lines 454-455, 457)

- [ ] **Step 2: Run tests + commit**

---

## Task 9: Remaining modules (persona_loader, const_session_store, stickers, request_log, rpc_client)

**Uncovered analysis:**

`agent/persona_loader.py` (lines 17, 30, 34):
- Line 17: `return ""` when both named and default template missing
- Line 30: `return {}` when both named and default frontmatter file missing
- Line 34: `return {}` when no frontmatter match in file

`api/const_session_store.py` (lines 80-82):
- Lines 80-82: `except Exception: ... return None` in `load_const_session`

`api/routes/stickers.py` (lines 39, 65, 77):
- Line 39: `if not path:` — **dead code** (path always non-empty); document as uncoverable
- Lines 65, 77: path traversal 403 — **defensive/dead code** (regex prevents traversal); document as uncoverable

`api/middleware/request_log.py` (lines 32, 83):
- Line 32: non-http scope passthrough (WebSocket)
- Line 83: `logger.error` for status >= 500

`api/pi_bridge/rpc_client.py` (lines 161-162):
- Lines 161-162: `if self._running: logger.exception(...)` in `_read_loop` crash

**Files:**
- Create: `tests/test_agent/test_persona_loader_push.py`
- Create: `tests/test_api/test_const_session_store_push.py`
- Create: `tests/test_api/test_request_log_push.py`
- Create: `tests/test_pi_bridge/test_rpc_client_push.py`

- [ ] **Step 1: Write tests for persona_loader missing files + no frontmatter**

Test cases:
1. `test_read_template_returns_empty_when_default_missing` — mock PERSONA_DIR, both files missing (line 17)
2. `test_parse_frontmatter_returns_empty_when_default_missing` — both files missing (line 30)
3. `test_parse_frontmatter_returns_empty_when_no_frontmatter` — file exists but no `---` match (line 34)

- [ ] **Step 2: Write test for const_session_store load exception**

Test case:
1. `test_load_const_session_returns_none_on_exception` — mock `yaml_file_lock` to raise Exception (lines 80-82)

- [ ] **Step 3: Write tests for request_log WS scope + 5xx logging**

Test cases:
1. `test_request_log_websocket_passthrough` — call middleware with websocket scope (line 32)
2. `test_request_log_logs_error_on_5xx` — app returns 500, verify error log (line 83)

- [ ] **Step 4: Write test for rpc_client read loop crash**

Test case:
1. `test_read_loop_logs_exception_when_running` — mock `stdout.readline` to raise RuntimeError while running (lines 161-162)

- [ ] **Step 5: Run all + commit**

---

## Task 10: Final verification

- [ ] **Step 1: Run full test suite with coverage**

Run: `.venv\Scripts\python.exe -m pytest tests/ --cov=api --cov=agent --cov-report=term-missing -q`

- [ ] **Step 2: Run ruff check**

Run: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`

- [ ] **Step 3: Document any uncoverable lines and final commit**

---

## Uncoverable lines (documented)

| Module | Line(s) | Reason |
|--------|---------|--------|
| api/middleware/rate_limit.py | 130 | `if loop is None: return` — dead code; `asyncio.get_running_loop()` either returns a loop or raises RuntimeError, never None |
| api/routes/stickers.py | 39 | `if not path:` — dead code; `path = f"{category}/{pick.name}"` is always non-empty |
| api/routes/stickers.py | 65, 77 | Path traversal 403 — defensive dead code; regex `^[\w\-]+\.webp$` already prevents `..` and `/` |
| api/server.py | 167-170 | `root_fallback` route handler is dead code; `spa_fallback` route `/{path:path}` is registered first and intercepts the `/` path before `root_fallback` can match. Existing tests in `test_server_extra.py` confirm `/` is served by `spa_fallback`. |
| api/artifacts/schema.py | 71 | `raise ValueError("artifact payload exceeds the size limit")` is effectively dead code; `body: str = Field(max_length=4000)` rejects oversized payloads at Pydantic validation layer before reaching the `model_validator`, so the 16KB check is unreachable with current field constraints (max ~11KB serialized). |

---

## Final Coverage Report

**Before:** 5453 statements, 73 uncovered, 99%
**After:** 5453 statements, 9 uncovered, 99.83%

**Net reduction:** 64 uncovered lines (73 → 9), an 87.7% reduction in uncovered lines.
Coverage gain: +0.83 percentage points (99% → 99.83%), exceeding the 99.5% goal.

**Final uncovered lines (all documented as uncoverable):**

| Module | Stmts | Miss | Cover | Missing |
|--------|-------|------|-------|---------|
| api/artifacts/schema.py | 99 | 1 | 99% | 71 |
| api/middleware/rate_limit.py | 181 | 1 | 99% | 130 |
| api/routes/stickers.py | 60 | 3 | 95% | 39, 65, 77 |
| api/server.py | 117 | 4 | 97% | 167-170 |
| **TOTAL** | **5453** | **9** | **99%** | |

**Test results:** 1752 passed, 7 skipped in 27.60s
**Ruff check:** All checks passed

**New test files created (8):**
1. `tests/test_api/test_diagnostics_routes_push.py` — 4 tests (diagnostics cleanup edge cases)
2. `tests/test_api/test_artifact_schema_push.py` — 6 tests (artifact validation + authorizer edge cases)
3. `tests/test_api/test_yaml_store_push.py` — 3 tests (atomic write/backup error paths)
4. `tests/test_api/test_auth_push.py` — 1 test (OSError on token read)
5. `tests/test_api/test_interaction_push.py` — 4 tests (auto_approve + cancel edge cases)
6. `tests/test_api/test_rate_limit_push.py` — 8 tests (cleanup task + WS scope + singleton)
7. `tests/test_agent/test_prompts_push.py` — 6 tests (resolve OSError + dedup)
8. `tests/test_agent/test_persona_loader_push.py` — 3 tests (missing default + no frontmatter)
9. `tests/test_api/test_const_session_store_push.py` — 1 test (load exception)
10. `tests/test_api/test_request_log_push.py` — 2 tests (WS passthrough + 5xx log)
11. `tests/test_pi_bridge/test_rpc_client_push.py` — 1 test (read loop crash)
