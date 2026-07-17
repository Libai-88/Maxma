# Metrics Module Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for `api/db/metrics.py` (74% → 90%+) and `api/metrics.py` (79% → 90%+) by creating new test files only — no source modifications.

**Architecture:** Read each module → map uncovered lines → design tests covering happy path + persistence + async flush lifecycle + error-tolerance branches → implement in new test files → verify with `pytest --cov-report=term-missing`.

**Tech Stack:** Python 3.13, pytest, pytest-cov, pytest-asyncio (`asyncio_mode = "auto"`)

---

## Uncovered Lines Analysis (from `--cov-report=term-missing`)

### `api/db/metrics.py` — 74 stmts, 19 missing (74%)
Missing lines:
- **47-49**: `_txn()` `except` branch (rollback on exception) — custom db_path path
- **53-54**: `_txn()` `else` branch — shared `transaction()` connection path (no db_path)
- **149-164**: `save_event()` — entire method never tested
- **168-191**: `get_events()` — entire method never tested (both `event_type` filter + unfiltered branches, JSON deserialize, NULL fallback)

### `api/metrics.py` — 170 stmts, 35 missing (79%)
Missing lines:
- **55-58**: `_Histogram.reset()` — never called
- **137**: `_normalize_path` `if not part: continue` — empty path segment (e.g. `//`)
- **142**: `_normalize_path` digit segment → `:id`
- **258-259**: `reset()` `except` — `db.clear_all()` failure tolerance
- **266-267**: `_get_db()` lazy `MetricsDbStore()` init
- **283-284**: `persist_snapshot()` `except` — `save_snapshot` failure tolerance
- **292-296**: `start_flush_task()` — idempotent task creation
- **300-305**: `_flush_loop()` — async loop body + exception tolerance
- **309-321**: `stop_flush_task()` — cancel branch + final-flush try/except

---

## File Structure

- **Create**: `tests/test_api/test_db_metrics.py` — coverage for `MetricsDbStore` (txn rollback, shared-connection path, `save_event`, `get_events`)
- **Create**: `tests/test_api/test_metrics_extra.py` — coverage for `Metrics` (`_Histogram.reset`, `_normalize_path` edge cases, `reset` DB-failure, `_get_db` lazy init, `persist_snapshot` failure, async flush task lifecycle)

Existing `tests/test_api/test_metrics.py` and `tests/test_api/test_metrics_routes.py` are **out of scope** (must not modify).

### Test isolation notes
- `Metrics` is a singleton with class-level `_db` / `_flush_task` / `_flush_interval` (NOT reset by `_init_state`). Each test must reset `Metrics().reset()` in setup and clear `_db` / cancel `_flush_task` in teardown.
- `tests/conftest.py` `_reset_global_state` fixture tries to import `_metrics` / `_metrics_lock` which don't exist in `api/metrics.py` (it uses `Metrics._instance` / `Metrics._lock`), so the import fails silently and the singleton is NOT auto-reset between tests. Explicit reset is required.
- Custom `db_path` stores create their own isolated SQLite file (existing pattern in `test_metrics.py`). Shared-connection path is isolated by monkeypatching `api.db.core.DB_PATH` + `_db_initialized` (pattern from `test_db_hooks.py`).
- Async tests rely on `asyncio_mode = "auto"` — bare `async def test_...` functions are supported with no decorator.

---

## Task 1: Write `test_db_metrics.py` — `_txn` branches + `save_event`/`get_events`

**Files:**
- Create: `tests/test_api/test_db_metrics.py`

Covers lines 47-49, 53-54, 149-164, 168-191.

- [ ] **Step 1: Create the test file with all test classes**

Test classes:
- `TestTxnRollback`: exception inside `_txn()` (custom db_path) rolls back and re-raises (47-49)
- `TestSharedConnectionPath`: `MetricsDbStore()` with no db_path uses shared `transaction()` (53-54); isolated via monkeypatched `DB_PATH`
- `TestSaveEvent`: insert with full fields / minimal fields; returns incrementing ids; serializes extra dict
- `TestGetEvents`: empty; unfiltered (newest first); filtered by `event_type`; `limit` respected; extra JSON deserialize; NULL extra fallback (`or "{}"`)

- [ ] **Step 2: Run the new test file to verify pass + coverage**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_db_metrics.py --cov=api.db.metrics --cov-report=term-missing -v
```
Expected: All PASS; `api/db/metrics.py` ≥ 95%.

- [ ] **Step 3: Run ruff**

```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_api/test_db_metrics.py
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_db_metrics.py
git commit -m "test(db): cover metrics store save_event/get_events + txn branches (74% -> 95%+)"
```

---

## Task 2: Write `test_metrics_extra.py` — sync coverage (`_Histogram.reset`, `_normalize_path`, error tolerance, lazy DB)

**Files:**
- Create: `tests/test_api/test_metrics_extra.py`

Covers lines 55-58, 137, 142, 258-259, 266-267, 283-284 (sync portion).

- [ ] **Step 1: Create the file with sync test classes**

Test classes:
- `TestHistogramReset`: observe then reset → count/total/min/max back to defaults; `to_dict()` empty shape
- `TestNormalizePathEdgeCases`: double-slash empty segment (137); pure digit segment → `:id` (142); query string stripped
- `TestResetDbFailure`: inject fake DB whose `clear_all` raises → `reset()` does not raise, memory still cleared (258-259)
- `TestGetDbLazyInit`: `_db = None` + monkeypatch `MetricsDbStore` → lazy create + cached on second call (266-267)
- `TestPersistSnapshotFailure`: inject fake DB whose `save_snapshot` raises → `persist_snapshot()` does not raise (283-284)

- [ ] **Step 2: Run sync portion + coverage**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_metrics_extra.py --cov=api.metrics --cov-report=term-missing -v
```
Expected: sync tests PASS; lines 55-58, 137, 142, 258-259, 266-267, 283-284 covered.

- [ ] **Step 3: Commit (intermediate)**

```bash
git add tests/test_api/test_metrics_extra.py
git commit -m "test(metrics): cover histogram reset, path edges, lazy db, error tolerance"
```

---

## Task 3: Add async flush-task lifecycle tests (lines 292-296, 300-305, 309-321)

**Files:**
- Modify: `tests/test_api/test_metrics_extra.py` (append async test class)

Covers lines 292-296 (`start_flush_task`), 300-305 (`_flush_loop`), 309-321 (`stop_flush_task`).

- [ ] **Step 1: Append `TestFlushTaskLifecycle` async class**

Tests:
- `test_start_then_stop_persists`: start task (short interval) → idempotent second start → let it tick → stop → history grew (covers 292-296 happy, 300-303, 309-316, 318-319)
- `test_flush_loop_tolerates_persist_error`: monkeypatch `persist_snapshot` to raise → start → tick → task still alive → stop (final flush also raises, caught) (covers 304-305, 320-321)
- `test_stop_without_running_task_does_final_flush`: no task → `stop_flush_task()` just does final flush (covers 309 False branch → 318-319)

- [ ] **Step 2: Run full file + coverage**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_metrics_extra.py --cov=api.metrics --cov-report=term-missing -v
```
Expected: All PASS; `api/metrics.py` ≥ 93%.

- [ ] **Step 3: ruff + Commit**

```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_api/test_metrics_extra.py
```
```bash
git add tests/test_api/test_metrics_extra.py
git commit -m "test(metrics): cover async flush task lifecycle (start/loop/stop)"
```

---

## Task 4: Final verification

- [ ] **Step 1: Combined coverage for both modules**

```
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/ --cov=api.db.metrics --cov=api.metrics --cov-report=term-missing -q
```
Expected:
- `api/db/metrics.py` ≥ 90%
- `api/metrics.py` ≥ 90%
- All tests pass (no regressions)

- [ ] **Step 2: ruff on both new files**

```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_api/test_db_metrics.py tests/test_api/test_metrics_extra.py
```
Expected: No errors.

---

## Self-Review Notes

- All uncovered line ranges have dedicated tests.
- No source modifications — only new test files.
- No scope violations: does not touch `tests/conftest.py`, `api/diagnostics.py`, `api/session_manager.py`, `api/checkpointer_factory.py`, `api/time_traveler.py`, `api/pi_bridge/*`, `api/routes/chat.py`, `bun-sidecar/`, `web/`, `pyproject.toml`, `requirements-lock.txt`, or existing test files.
- Async flush task tests always stop/cancel the task within the test + sync teardown guards against leaks.
