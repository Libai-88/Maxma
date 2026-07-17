# Dependencies Declaration & Flaky Test Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete pyproject.toml dependencies declaration and fix flaky test_rate_limit_429.

**Architecture:** Part A: identify and add missing direct dependencies to pyproject.toml by cross-referencing the lock file's "via maxmahere (pyproject.toml)" entries with actual import statements in the codebase. Part B: fix flaky rate limit test by lowering refill_rate in the test fixture so the token bucket does not refill meaningful tokens between synchronous requests.

**Tech Stack:** Python 3.13, uv, pytest, pyproject.toml

---

## Context Analysis

### Part A: Dependency Gap

`requirements-lock.txt` contains 26 packages marked `# via maxmahere (pyproject.toml)` — i.e., direct dependencies that were declared when the lock was generated. The current `pyproject.toml` only declares 14 of them; 13 are missing.

A thorough import audit (`api/`, `agent/`, `config/`, `main.py`, `app_paths.py`) reveals:

**Directly imported but NOT declared in pyproject.toml (3 packages):**
| Package | Lock version | Import location |
|---|---|---|
| `portalocker` | 3.2.0 | `api/yaml_store.py:12` — `import portalocker` |
| `tiktoken` | 0.13.0 | `api/context_usage.py:5` — `import tiktoken` |
| `langchain-core` | 0.3.86 | `agent/context_manager.py:14` — `from langchain_core.messages import ...` |

**In lock as "via maxmahere" but NOT directly imported (10 packages — NOT added per task constraint "只添加项目代码直接 import 的包"):**
- `chromadb`, `json-repair`, `langchain`, `langchain-mcp-adapters`, `langchain-openai`, `moviepy`, `onnxruntime`, `playwright`, `tavily-python`, `transformers`, `zai-sdk`

These packages appear in the lock as direct deps but no `import` statement exists in the Python source. The project is a thin FastAPI proxy to a Bun/TypeScript sidecar (see `api/server.py` docstring: "All agent logic is handled by OMP sidecar"). These may be legacy/future deps — left untouched per task instructions.

### Part B: Flaky Test Root Cause

`test_rate_limit_429` uses the `app_with_middleware` fixture which configures `RateLimitMiddleware(capacity=2, refill_rate=100.0)`.

- `capacity=2`: bucket holds max 2 tokens
- `refill_rate=100.0`: refills **100 tokens/second**

Test flow: 3 sequential `client.get("/api/test")` calls. First 2 consume the 2 tokens; 3rd should get 429.

**Flakiness:** Under suite-wide machine load, >10ms can elapse between requests. At 100 tokens/sec, 10ms = 1.0 token refilled → the 3rd request finds a token and returns 200 instead of 429.

**Fix (Option A — lower refill_rate):** Change fixture from `refill_rate=100.0` to `refill_rate=0.1` (the clamped minimum). At 0.1 tokens/sec, even 100ms between requests adds only 0.01 tokens — far below the 1.0 needed to unblock the 3rd request. This makes the test deterministic without mocking.

---

## File Structure

- **Modify:** `pyproject.toml` — add 3 dependencies to `[project] dependencies` list
- **Modify:** `tests/test_api/test_rate_limit_extra.py` — change `refill_rate` in `app_with_middleware` fixture
- **Create:** this plan file (already created)

---

## Task 1: Part A — Add missing direct dependencies to pyproject.toml

**Files:**
- Modify: `pyproject.toml` (lines 7-22, the `dependencies` array)

- [ ] **Step 1: Add `portalocker`, `tiktoken`, `langchain-core` to dependencies**

Add these three lines (alphabetically ordered within the existing list) to the `dependencies` array in `pyproject.toml`:

```toml
    "langchain-core>=0.3.86",
    "portalocker>=3.2.0",
    "tiktoken>=0.13.0",
```

Insert `langchain-core` after `httpx` (before `requests`), `portalocker` after `python-dotenv` (before `pyyaml`), and `tiktoken` after `requests` (before `uvicorn`). Version lower bounds taken from `requirements-lock.txt`.

- [ ] **Step 2: Verify pyproject.toml is valid TOML**

Run: `python -c "import tomllib; tomllib.load(open('pyproject.toml','rb'))"`
Expected: no error (valid TOML).

- [ ] **Step 3: Verify dependency resolution (if uv available)**

Run: `uv pip compile pyproject.toml -o requirements-lock-test.txt --extra dev` (if uv is available)
Then compare `requirements-lock-test.txt` with `requirements-lock.txt` — the 3 newly-declared packages should now appear as `# via maxmahere (pyproject.toml)`.

If uv is not available, run: `.venv\Scripts\python.exe -m pip install --dry-run -r requirements-lock.txt`
Expected: success (all packages already satisfied by the venv).

**Do NOT replace `requirements-lock.txt`** — only verify.

- [ ] **Step 4: Clean up test lock file if created**

If `requirements-lock-test.txt` was created, delete it:
Run: `del requirements-lock-test.txt` (PowerShell: `Remove-Item requirements-lock-test.txt`)

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml
git commit -m "chore(deps): declare missing direct deps (portalocker, tiktoken, langchain-core) in pyproject.toml"
```

---

## Task 2: Part B — Fix flaky test_rate_limit_429

**Files:**
- Modify: `tests/test_api/test_rate_limit_extra.py:147` — the `app_with_middleware` fixture

- [ ] **Step 1: Change refill_rate in fixture from 100.0 to 0.1**

In `tests/test_api/test_rate_limit_extra.py`, find the `app_with_middleware` fixture (line ~147):

```python
        app.add_middleware(RateLimitMiddleware, capacity=2, refill_rate=100.0)
```

Change to:

```python
        app.add_middleware(RateLimitMiddleware, capacity=2, refill_rate=0.1)
```

Rationale: at 0.1 tokens/sec, even 100ms between requests adds only 0.01 tokens — insufficient to unblock the 3rd request. Test becomes deterministic.

- [ ] **Step 2: Run ruff check on the test file**

Run: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_api/test_rate_limit_extra.py`
Expected: no errors.

- [ ] **Step 3: Run the specific test once to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_rate_limit_extra.py::TestRateLimitMiddleware::test_rate_limit_429 -v`
Expected: PASS.

- [ ] **Step 4: Run the full test file to verify no regressions**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_rate_limit_extra.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Run the flaky test 10 times to confirm stability**

Run (PowerShell):
```powershell
1..10 | ForEach-Object { .venv\Scripts\python.exe -m pytest tests/test_api/test_rate_limit_extra.py::TestRateLimitMiddleware::test_rate_limit_429 -v }
```
Expected: all 10 runs PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/test_api/test_rate_limit_extra.py
git commit -m "test(rate_limit): fix flaky test_rate_limit_429 by lowering refill_rate to 0.1"
```

---

## Verification Summary

After both tasks:
- `pyproject.toml` declares all directly-imported runtime packages
- `test_rate_limit_429` passes 10/10 consecutive runs
- No other test files modified
- `requirements-lock.txt` untouched
