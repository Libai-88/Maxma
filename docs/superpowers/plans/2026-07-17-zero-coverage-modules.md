# Zero Coverage Modules Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Cover or document 4 zero/low-coverage modules (idle_queue 0%, checkpointer_factory 0%, time_traveler 0%, logging_config 59%).

**Architecture:** Read each module → classify as live/dead code → write tests for live code → document dead code.

**Tech Stack:** Python 3.13, pytest, pytest-cov (asyncio_mode = "auto")

## Baseline (measured 2026-07-17)

| Module | Stmts | Miss | Cover | Missing lines |
|---|---|---|---|---|
| api/bootstrap/idle_queue.py | 36 | 36 | 0% | all |
| api/checkpointer_factory.py | 11 | 11 | 0% | all |
| api/time_traveler.py | 21 | 21 | 0% | all |
| api/logging_config.py | 74 | 30 | 59% | 83, 85, 87, 97-141 |

## Module Classification (from Grep analysis)

### `api/bootstrap/idle_queue.py` — LIVE (public API)
- Exported by `api/bootstrap/__init__.py` (`register_idle_task`, `start_idle_drain`, `is_idle_draining`, `clear_idle_queue`).
- Functional, self-contained, well-documented (Tier 3 idle task queue, Halo-inspired).
- No current internal callers in `api/server.py` / `main.py` (planned usage in docs only), but it IS the public surface of `api.bootstrap`.
- **Action:** Write tests → target 90%+.

### `api/checkpointer_factory.py` — COMPATIBILITY STUB (retained)
- Docstring: "此模块保留为兼容导入的零操作存根" (retained as zero-op stub for compatible imports).
- No internal Python imports (only referenced in docs/plans); LangGraph-era stub.
- It is intentionally retained, not abandoned. Testing locks down the no-op contract so future removal is safe to detect.
- **Action:** Write minimal tests to verify no-op contract → target 100%. Document: no internal callers; candidate for removal once compatibility window closes.

### `api/time_traveler.py` — BUNDLED (semi-live)
- Listed in `build/maxma-server.spec` `hiddenimports` (bundled in production build).
- No current Python importers: the `/sessions/{id}/undo` route (`api/routes/sessions.py:257`) implements undo **inline** via `client.call("undo", ...)` rather than calling this module.
- Functional, coherent helper (sidecar undo RPC wrapper). Bundled but superseded by inline route code.
- **Action:** Write tests (mock sidecar_mgr) → target 90%+. Document: superseded by inline undo in route; consider refactoring route to use this module, or remove from hiddenimports if truly unused.

### `api/logging_config.py` — LIVE (boost coverage)
- Existing tests in `tests/test_api/test_logging_config.py` cover `JsonFormatter` + `ConsoleFormatter.format` basic path only.
- Missing: `ConsoleFormatter` context-var injection (lines 83, 85, 87) and the entire `setup_logging()` function (lines 97-141).
- **Action:** Create NEW test file `test_logging_config_extra.py` (do NOT modify existing test file per constraints) → target 90%+.

## Constraints
- Only CREATE new test files; do not modify existing source or existing tests.
- Do not touch other agents' file scope (security_adapter, approval_adapter, mcp route, pi_bridge integration tests, bun-sidecar, web, pyproject.toml, requirements-lock.txt).
- `asyncio_mode = "auto"` — async tests run without markers.
- Run tests: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v`
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
- Commit after each module.

## Tasks

### Task 1: idle_queue tests
- Create `tests/test_api/test_bootstrap_idle_queue.py`.
- Cover: register returns uuid id; queue append; clear resets; is_idle_draining default false; drain executes sync/async/mixed tasks; drain swallows per-task exceptions and continues; drain sets `_draining` mid-run; drain skips when already draining; drain clears queue after run; empty queue drain.
- Use `clear_idle_queue()` in autouse fixture to isolate state.
- Commit.

### Task 2: checkpointer_factory tests
- Create `tests/test_api/test_checkpointer_factory.py`.
- Cover: `init_persistent_checkpointer` is async no-op returning None; `get_persistent_checkpointer` returns None; `close_persistent_checkpointer` is async no-op; `get_checkpointer_info` returns expected dict (type=none, persistent=False, db_path="", mode contains "sidecar").
- Commit.

### Task 3: time_traveler tests
- Create `tests/test_api/test_time_traveler.py`.
- Build a `_FakeSidecarMgr` with `.client` exposing async `.call(method, args)`; support success (returns `{"removed": N}`), None client, and raising exception.
- Cover: `undo_rounds` returns 0 for n<1 / falsy mgr / falsy session_id / client None; success returns removed count; exception returns 0; `undo_last_round` calls with n=1; `undo_all` calls with n=100.
- Commit.

### Task 4: logging_config extra tests
- Create `tests/test_api/test_logging_config_extra.py`.
- Cover ConsoleFormatter context injection (sid only, rid only, both) → lines 83, 85, 87.
- Cover `setup_logging()`: default (env unset, monkeypatch `_LOG_DIR` to tmp_path); custom level; invalid level fallback; JSON console; disabled file (`MAXMA_LOG_FILE=""`); custom log file path; clears existing handlers; third-party logger levels (httpx/httpcore/uvicorn.access/openai/playwright set to WARNING).
- Use a fixture to snapshot/restore root logger handlers, level, and env vars to avoid cross-test pollution.
- Commit.

### Task 5: final measurement + ruff
- Re-run coverage for all 4 modules.
- Run ruff on the new test files.
- Update this plan with final numbers (done section below).
- Final commit if needed.

## Completion (filled in after execution)

| Module | Before | After |
|---|---|---|
| api/bootstrap/idle_queue.py | 0% | TBD |
| api/checkpointer_factory.py | 0% | TBD |
| api/time_traveler.py | 0% | TBD |
| api/logging_config.py | 59% | TBD |
