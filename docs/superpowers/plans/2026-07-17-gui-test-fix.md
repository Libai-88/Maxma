# GUI Test Hang Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `test_allowed_in_development` test that hangs forever in non-interactive environments by opening a tkinter GUI dialog.

**Architecture:** Investigate `select_file` implementation → mock tkinter components in the test → run full suite without `--deselect` → verify CI config.

**Tech Stack:** Python 3.13, pytest, tkinter, pytest-timeout, unittest.mock

---

## Context Findings (read before executing)

1. **`tests/test_api/test_files.py`** contains `TestSelectFile::test_allowed_in_development` which calls `await select_file()`. The test comment says "We don't actually open the GUI dialog; just verify it doesn't raise the 403 runtime-mode error" — but the implementation **does** open a real GUI dialog because `select_file()` proceeds to call `tkinter.filedialog.askopenfilename()`.

2. **`api/routes/files.py`** — `select_file()` flow:
   - Checks `_is_local_runtime()`; if production → raises HTTPException(403)
   - Imports `tkinter as tk` and `from tkinter import filedialog` (inside the function body)
   - Defines `_open_dialog()` which creates `tk.Tk()`, calls `filedialog.askopenfilename()` (or `askdirectory()`), and returns the path
   - Runs `_open_dialog` via `loop.run_in_executor(None, _open_dialog)`
   - Returns `{"path": path}`
   - `except ImportError` → HTTPException(500, "tkinter 不可用")
   - `except Exception` → HTTPException(500, "打开文件对话框失败")

3. **Hang conditions:**
   - **Windows local dev**: `tk.Tk()` succeeds → `askopenfilename()` opens a modal dialog → **HANGS** waiting for user click
   - **Linux with DISPLAY**: same as Windows → **HANGS**
   - **Linux headless (CI ubuntu-latest)**: `tk.Tk()` raises `TclError: no display name` → caught by `except Exception` → HTTPException(500) → test passes (but for the wrong reason — it never tests the happy path)

4. **`--deselect` usage**: NOT present in `.github/workflows/pytest.yml`. Only referenced in plan documents (`2026-07-17-backend-silent-except-sweep.md`, `2026-07-10-halo-functional-enhancements.md`) as local run instructions. The CI yaml runs `python -m pytest -q --cov=api --cov=agent --cov-report=xml --cov-fail-under=50` with no deselect.

5. **Dependencies**: `pytest-timeout` and `pytest-mock` are NOT in `requirements-lock.txt`. Will use `unittest.mock` (stdlib) to avoid adding dependencies. Will install `pytest-timeout` locally as a safety net (not committed to lock file — that's another agent's scope).

6. **Test purpose**: The test verifies that in development mode, the 403 runtime-mode error is NOT raised. This is **non-GUI logic** (runtime mode check), so mocking the GUI layer is the correct approach (Method B).

---

## Design Decision: Method B — Mock tkinter

**Chosen over:**
- Method A (conditional skip): Would skip the test in CI, losing coverage of the happy path
- Method C (manual marker): Same drawback as A

**Mock targets** (using `unittest.mock.patch`):
- `tkinter.Tk` → `MagicMock()` (prevents real window creation, makes `withdraw`/`destroy`/`attributes`/`winfo_fpixels`/`tk.call` into no-ops)
- `tkinter.filedialog.askopenfilename` → returns `"/tmp/test_file.txt"` (fixed path, no dialog)
- `tkinter.filedialog.askdirectory` → returns `"/tmp/test_folder"` (fixed path, no dialog)

**Why this works:** The `select_file` function imports `tkinter as tk` and `from tkinter import filedialog` at call time. Patching `tkinter.Tk` and `tkinter.filedialog.askopenfilename` at the module level intercepts these lookups. The function executes its real logic (runtime check, executor call, path return) without ever opening a real GUI.

---

## File Structure

- **Create:** `docs/superpowers/plans/2026-07-17-gui-test-fix.md` — This plan
- **Modify:** `tests/test_api/test_files.py` — Mock tkinter in `test_allowed_in_development`
- **Read-only:** `api/routes/files.py` — Source of `select_file` (do NOT modify)
- **Check:** `.github/workflows/pytest.yml` — Verify no `--deselect` to remove

---

## Task 1: Write and commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-07-17-gui-test-fix.md`

- [x] **Step 1: Write the plan document** (this file)

- [ ] **Step 2: Commit the plan**

```bash
cd d:\Maxma\MaxmaHere
git add docs/superpowers/plans/2026-07-17-gui-test-fix.md
git commit -m "docs: add GUI test hang fix plan"
```

---

## Task 2: Install pytest-timeout (local safety net)

**Files:** None (local pip install only — not committing to lock file)

- [ ] **Step 1: Install pytest-timeout into .venv**

```bash
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pip install pytest-timeout
```

**Note:** `pytest-timeout` is a dev-only safety net to prevent any future hang from blocking the suite. It is NOT added to `requirements-lock.txt` (out of scope — another agent owns that file). If installation fails, proceed anyway — the mock fix itself prevents the hang.

---

## Task 3: Fix `test_allowed_in_development` with tkinter mock

**Files:**
- Modify: `tests/test_api/test_files.py`

**Design:**
- Add `import os` and `from unittest.mock import patch, MagicMock`
- In `test_allowed_in_development`, wrap `await select_file()` with `patch` context managers for:
  - `tkinter.Tk` → `MagicMock()`
  - `tkinter.filedialog.askopenfilename` → `"/tmp/test_file.txt"`
- Assert the return value is `{"path": "/tmp/test_file.txt"}` (verifies happy path)
- Remove the old try/except/ImportError-skip pattern (no longer needed — mock guarantees no hang and no ImportError)
- Keep `test_blocked_in_production` unchanged (it correctly tests the 403 path)

**TDD verification:**
- RED: Before fix, running the test on Windows hangs (requires manual kill)
- GREEN: After fix, the test passes instantly by returning the mocked path
- The test now verifies BOTH: (a) no 403 raised in development mode, AND (b) the return shape `{"path": ...}` is correct

- [ ] **Step 1: Read the current test file** (already done in context)

- [ ] **Step 2: Implement the mock fix**

- [ ] **Step 3: Run the single test to verify it passes without hanging**

```bash
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/test_api/test_files.py -v --timeout=30
```

---

## Task 4: Run full test suite without `--deselect`

**Files:** None (verification only)

- [ ] **Step 1: Run the complete suite**

```bash
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/ -v --timeout=30
```

- [ ] **Step 2: Verify no hangs, no failures caused by the change**
  - All previously-passing tests still pass
  - `test_allowed_in_development` passes (not skipped, not hanging)
  - `test_blocked_in_production` still passes

---

## Task 5: Commit the test fix

- [ ] **Step 1: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add tests/test_api/test_files.py
git commit -m "test: mock tkinter in test_allowed_in_development to prevent GUI hang

The test called select_file() which opens a real tkinter file dialog,
hanging forever in non-interactive environments. Mock tkinter.Tk and
tkinter.filedialog.askopenfilename so the test verifies the runtime-mode
check logic without opening a GUI. The test now also asserts the return
shape {path: ...} for the happy path."
```

---

## Task 6: Check CI config for `--deselect`

**Files:**
- Check: `.github/workflows/pytest.yml`

- [ ] **Step 1: Verify whether `--deselect` is present in CI yaml**

Based on context findings, `.github/workflows/pytest.yml` does NOT contain `--deselect` — it runs `python -m pytest -q --cov=api --cov=agent --cov-report=xml --cov-fail-under=50`. No modification needed.

If Agent 8 (ci-coverage-expansion) has added `--deselect` in the meantime, remove only that line. Otherwise, no action.

- [ ] **Step 2: If `--deselect` was found and removed, commit the CI change**

---

## Risk & Rollback

- **Risk:** Mocking too broadly could hide real bugs in `select_file`. Mitigation: mock only the GUI boundary (`Tk`, `askopenfilename`, `askdirectory`), not the function itself — the runtime check, executor call, and return logic all run for real.
- **Rollback:** Revert the test file commit; the old try/except behavior is restored (test will hang again on local Windows, but that's the pre-existing state).
