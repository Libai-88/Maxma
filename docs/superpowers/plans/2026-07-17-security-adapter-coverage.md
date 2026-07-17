# Security Adapter Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for `api/pi_bridge/security_adapter.py` (52% → 85%+) and `api/pi_bridge/approval_adapter.py` (0% → 90%+) by creating new test files only — no source modifications.

**Architecture:** Read each module → map uncovered lines → design tests covering happy path + security boundaries (NUL bytes, resolve failures, Unicode, path traversal) → implement in new test files → verify with `pytest --cov-report=term-missing`.

**Tech Stack:** Python 3.13, pytest, pytest-cov, unittest.mock, security boundary testing

---

## Uncovered Lines Analysis (from `--cov-report=term-missing`)

### `security_adapter.py` — 83 stmts, 40 missing (52%)
Missing lines:
- **31-46**: `check_tool_security` body — main entry point, never tested
- **51-63**: `_extract_paths` body — tool-name dispatch (read/write/edit/glob/bash)
- **72-81**: `_load_whitelist` body — YAML loading & parsing
- **101-103**: `check_path_access` except branch — input path resolve failure (fail-closed)
- **108-109**: `check_path_access` except branch — whitelist entry resolve failure (`continue`)
- **147-149**: `_find_blocker_path` except branch — non-NUL path resolve failure (fail-closed)

### `approval_adapter.py` — 7 stmts, 7 missing (0%, never imported)
Missing: entire module (`TOOL_APPROVAL_MAP` + `get_approval_level` + `is_high_risk`)

### Note on task description vs. reality
Task mentions `check_path_blocked` — this function does **not exist** in the source. The actual public functions are `check_path_access`, `check_tool_security`, `_is_blocker_present`, `_find_blocker_path`. Tests target the real functions.

---

## File Structure

- **Create**: `tests/test_pi_bridge/test_security_adapter_coverage.py` — coverage for `check_tool_security`, `_extract_paths`, `_load_whitelist`, resolve-failure branches
- **Create**: `tests/test_pi_bridge/test_approval_adapter.py` — full coverage for `approval_adapter.py`

Existing `tests/test_pi_bridge/test_security_adapter.py` is **out of scope** (must not modify).

---

## Task 1: Write `test_approval_adapter.py` (full coverage, simplest module)

**Files:**
- Create: `tests/test_pi_bridge/test_approval_adapter.py`

- [ ] **Step 1: Write the test file**

```python
"""Coverage for api.pi_bridge.approval_adapter — tool approval-level mapping."""

from __future__ import annotations

import pytest

from api.pi_bridge.approval_adapter import (
    TOOL_APPROVAL_MAP,
    get_approval_level,
    is_high_risk,
)


class TestGetApprovalLevel:
    """get_approval_level(tool_name) -> 'read'/'write'/'interactive'/'ask'."""

    @pytest.mark.parametrize(
        "tool,expected",
        [
            ("file_write", "write"),
            ("file_manage", "write"),
            ("file_edit", "write"),
            ("file_read", "read"),
            ("file_search", "read"),
            ("run_python", "write"),
            ("tavily_search", "read"),
            ("tavily_extract", "read"),
            ("get_current_weather", "read"),
            ("call_sub_agent", "write"),
            ("parallel_execute", "write"),
            ("ask_user_qa", "interactive"),
            ("ask_user_confirm", "interactive"),
        ],
    )
    def test_known_tools(self, tool: str, expected: str) -> None:
        assert get_approval_level(tool) == expected

    def test_unknown_tool_returns_ask_default(self) -> None:
        assert get_approval_level("nonexistent_tool") == "ask"

    def test_empty_string_returns_ask(self) -> None:
        assert get_approval_level("") == "ask"

    def test_every_map_entry_consistent(self) -> None:
        for tool, level in TOOL_APPROVAL_MAP.items():
            assert get_approval_level(tool) == level
            assert level in ("read", "write", "interactive")


class TestIsHighRisk:
    """is_high_risk(tool_name) -> bool. True for write/interactive."""

    @pytest.mark.parametrize(
        "tool,expected",
        [
            ("file_write", True),
            ("file_edit", True),
            ("run_python", True),
            ("call_sub_agent", True),
            ("parallel_execute", True),
            ("ask_user_qa", True),
            ("ask_user_confirm", True),
            ("file_read", False),
            ("file_search", False),
            ("tavily_search", False),
            ("tavily_extract", False),
            ("get_current_weather", False),
        ],
    )
    def test_known_tools(self, tool: str, expected: bool) -> None:
        assert is_high_risk(tool) is expected

    def test_unknown_tool_not_high_risk(self) -> None:
        assert is_high_risk("nonexistent_tool") is False

    def test_empty_string_not_high_risk(self) -> None:
        assert is_high_risk("") is False


class TestToolApprovalMapContents:
    """Sanity-check the constant mapping."""

    def test_map_is_dict(self) -> None:
        assert isinstance(TOOL_APPROVAL_MAP, dict)

    def test_map_has_expected_entries(self) -> None:
        expected_keys = {
            "file_write", "file_manage", "file_edit",
            "file_read", "file_search",
            "run_python",
            "tavily_search", "tavily_extract", "get_current_weather",
            "call_sub_agent", "parallel_execute",
            "ask_user_qa", "ask_user_confirm",
        }
        assert set(TOOL_APPROVAL_MAP.keys()) == expected_keys

    def test_all_values_valid_levels(self) -> None:
        for level in TOOL_APPROVAL_MAP.values():
            assert level in ("read", "write", "interactive")
```

- [ ] **Step 2: Run the new test file to verify it passes + covers**

Run:
```
.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_approval_adapter.py --cov=api.pi_bridge.approval_adapter --cov-report=term-missing -v
```
Expected: All tests PASS, `approval_adapter.py` coverage 100%.

- [ ] **Step 3: Run ruff on the new file**

Run:
```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_pi_bridge/test_approval_adapter.py
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add tests/test_pi_bridge/test_approval_adapter.py
git commit -m "test(pi_bridge): add approval_adapter coverage (0% -> 100%)"
```

---

## Task 2: Write `test_security_adapter_coverage.py` — `_extract_paths` + `check_tool_security`

**Files:**
- Create: `tests/test_pi_bridge/test_security_adapter_coverage.py`

Covers lines 31-46 (`check_tool_security`) and 51-63 (`_extract_paths`).

- [ ] **Step 1: Create the file with imports and `_extract_paths` tests + `check_tool_security` tests**

```python
"""Coverage boost for api.pi_bridge.security_adapter.

Targets uncovered lines: check_tool_security (31-46), _extract_paths (51-63),
_load_whitelist (72-81), resolve-failure branches (101-103, 108-109, 147-149).

Does NOT modify the existing test_security_adapter.py.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from api.pi_bridge import security_adapter


# ── _extract_paths ─────────────────────────────────────────


class TestExtractPaths:
    """_extract_paths dispatches by tool_name to pull path/pattern from args."""

    def test_read_extracts_path(self) -> None:
        result = security_adapter._extract_paths("read", {"path": "/a/b.txt"})
        assert result == ["/a/b.txt"]

    def test_read_missing_path_key_returns_empty_string(self) -> None:
        result = security_adapter._extract_paths("read", {})
        assert result == [""]

    def test_write_extracts_path(self) -> None:
        result = security_adapter._extract_paths("write", {"path": "/x/y"})
        assert result == ["/x/y"]

    def test_edit_extracts_path(self) -> None:
        result = security_adapter._extract_paths("edit", {"path": "/e.txt"})
        assert result == ["/e.txt"]

    def test_glob_extracts_pattern(self) -> None:
        result = security_adapter._extract_paths("glob", {"pattern": "*.py"})
        assert result == ["*.py"]

    def test_glob_missing_pattern_returns_empty_string(self) -> None:
        result = security_adapter._extract_paths("glob", {})
        assert result == [""]

    def test_bash_returns_empty_list(self) -> None:
        result = security_adapter._extract_paths("bash", {"command": "ls -la"})
        assert result == []

    def test_bash_missing_command_still_empty(self) -> None:
        result = security_adapter._extract_paths("bash", {})
        assert result == []

    def test_unknown_tool_returns_empty_list(self) -> None:
        result = security_adapter._extract_paths("mystery", {"path": "/x"})
        assert result == []


# ── check_tool_security ────────────────────────────────────


class TestCheckToolSecurity:
    """check_tool_security(tool_name, tool_args) -> str | None (None=allow)."""

    def test_read_allowed_path_returns_none(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "file.txt"
        target.write_text("ok", encoding="utf-8")
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("read", {"path": str(target)})
        assert result is None

    def test_read_blocked_path_returns_reason(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("read", {"path": str(outside)})
        assert result is not None
        assert "白名单" in result

    def test_read_path_with_blocker_returns_blocker_reason(
        self, tmp_path, monkeypatch
    ) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: True)
        result = security_adapter.check_tool_security(
            "read", {"path": str(allowed)}
        )
        assert result is not None
        assert "MaxmaBlocker" in result

    def test_empty_path_skipped_returns_none(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": ""})
        assert result is None

    def test_none_path_skipped_returns_none(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": None})
        assert result is None

    def test_non_string_path_skipped(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": 12345})
        assert result is None

    def test_write_tool_blocked(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("write", {"path": str(outside)})
        assert result is not None

    def test_edit_tool_allowed(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "e.txt"
        target.write_text("x", encoding="utf-8")
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("edit", {"path": str(target)})
        assert result is None

    def test_glob_tool_blocked_pattern_resolves_outside(
        self, tmp_path, monkeypatch
    ) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security(
            "glob", {"pattern": str(outside / "*.txt")}
        )
        assert result is not None

    def test_bash_tool_returns_none_no_path_check(self, monkeypatch) -> None:
        # bash extracts no paths; must return None without touching whitelist
        call_count = {"n": 0}

        def _fail_if_called(*_a, **_k):
            call_count["n"] += 1
            return [("/never", True)]

        monkeypatch.setattr(security_adapter, "_load_whitelist", _fail_if_called)
        result = security_adapter.check_tool_security("bash", {"command": "ls"})
        assert result is None
        assert call_count["n"] == 0
```

- [ ] **Step 2: Run the partial file to verify `_extract_paths` + `check_tool_security` are covered**

Run:
```
.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter_coverage.py --cov=api.pi_bridge.security_adapter --cov-report=term-missing -v
```
Expected: Tests PASS; lines 31-46 and 51-63 now covered.

- [ ] **Step 3: Commit (intermediate)**

```bash
git add tests/test_pi_bridge/test_security_adapter_coverage.py
git commit -m "test(pi_bridge): cover check_tool_security + _extract_paths"
```

---

## Task 3: Add `_load_whitelist` tests (lines 72-81)

**Files:**
- Modify: `tests/test_pi_bridge/test_security_adapter_coverage.py` (append new test class)

- [ ] **Step 1: Append the `TestLoadWhitelist` class to the file**

Add at end of file:

```python
# ── _load_whitelist ────────────────────────────────────────


class TestLoadWhitelist:
    """_load_whitelist reads PATH_WHITELIST_YAML_PATH; missing file => []."""

    def test_missing_file_returns_empty(self, tmp_path, monkeypatch) -> None:
        missing = tmp_path / "no_such.yaml"
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", missing)
        assert security_adapter._load_whitelist() == []

    def test_empty_yaml_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_valid_entries_with_recursive(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n"
            "  - path: /a\n"
            "  - path: /b\n"
            "    recursive: false\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/a", True), ("/b", False)]

    def test_default_recursive_is_true(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist:\n  - path: /x\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/x", True)]

    def test_non_dict_entries_skipped(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n  - 'just a string'\n  - 42\n  - path: /ok\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/ok", True)]

    def test_entry_without_path_key_skipped(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n  - recursive: true\n  - path: /ok\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/ok", True)]

    def test_empty_whitelist_key_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist: []\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_missing_whitelist_key_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("other: data\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_unicode_path_preserved(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist:\n  - path: /数据/中文\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/数据/中文", True)]
```

- [ ] **Step 2: Run the file; verify lines 72-81 covered**

Run:
```
.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter_coverage.py::TestLoadWhitelist --cov=api.pi_bridge.security_adapter --cov-report=term-missing -v
```
Expected: PASS; lines 72-81 now covered.

- [ ] **Step 3: Commit**

```bash
git add tests/test_pi_bridge/test_security_adapter_coverage.py
git commit -m "test(pi_bridge): cover _load_whitelist YAML parsing"
```

---

## Task 4: Add resolve-failure branch tests (lines 101-103, 108-109, 147-149)

**Files:**
- Modify: `tests/test_pi_bridge/test_security_adapter_coverage.py` (append new test classes)

Covers:
- `check_path_access` input-path resolve failure (101-103) via NUL-byte path
- `check_path_access` whitelist-entry resolve failure (108-109) via NUL in whitelist entry
- `_find_blocker_path` non-NUL resolve failure (147-149) via mocked `Path.resolve`

- [ ] **Step 1: Append `TestCheckPathAccessResolveFailure`, `TestFindBlockerResolveFailure` classes**

```python
# ── check_path_access: resolve-failure branches ────────────


class TestCheckPathAccessResolveFailure:
    """Lines 101-103 (input path resolve fail) & 108-109 (whitelist entry resolve fail)."""

    def test_input_path_with_nul_fails_closed(self, monkeypatch) -> None:
        """NUL bytes make Path.resolve raise ValueError -> fail-closed block."""
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_path_access("foo\x00bar")
        assert result is not None
        assert "解析失败" in result

    def test_whitelist_entry_resolve_failure_skipped(self, tmp_path, monkeypatch) -> None:
        """A whitelist entry that fails to resolve is skipped (continue).
        The valid entry still matches the input path."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        # First entry has NUL -> resolve fails -> continue.
        # Second entry is valid and should match.
        monkeypatch.setattr(
            security_adapter,
            "_load_whitelist",
            lambda: [("bad\x00entry", True), (str(allowed), True)],
        )
        result = security_adapter.check_path_access(str(allowed))
        assert result is None

    def test_all_whitelist_entries_unresolvable_blocks(self, monkeypatch) -> None:
        """If every whitelist entry fails to resolve, path is not matched -> blocked."""
        monkeypatch.setattr(
            security_adapter,
            "_load_whitelist",
            lambda: [("bad\x00a", True), ("bad\x00b", False)],
        )
        result = security_adapter.check_path_access("/some/path")
        assert result is not None
        assert "白名单" in result


# ── _find_blocker_path: non-NUL resolve failure (147-149) ──


class TestFindBlockerResolveFailure:
    """Line 147-149: Path.resolve raises (non-NUL) -> fail-closed return path."""

    def test_resolve_oserror_fail_closed(self) -> None:
        """When resolve raises OSError (not NUL), _find_blocker_path returns the
        path string itself (fail-closed: treat as blocker present)."""
        with patch.object(
            Path, "resolve", side_effect=OSError("mocked resolve failure")
        ):
            result = security_adapter._find_blocker_path("/some/valid/looking/path")
        assert result is not None
        assert result == "/some/valid/looking/path"

    def test_resolve_valueerror_fail_closed(self) -> None:
        with patch.object(
            Path, "resolve", side_effect=ValueError("mocked")
        ):
            result = security_adapter._find_blocker_path("/another/path")
        assert result is not None
        assert result == "/another/path"

    def test_resolve_failure_is_blocker_present_true(self) -> None:
        """_is_blocker_present returns True when resolve fails (fail-closed)."""
        with patch.object(
            Path, "resolve", side_effect=OSError("mocked")
        ):
            assert security_adapter._is_blocker_present("/any/path") is True
```

- [ ] **Step 2: Run full new test file with coverage**

Run:
```
.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter_coverage.py --cov=api.pi_bridge.security_adapter --cov-report=term-missing -v
```
Expected: All PASS; `security_adapter.py` coverage ≥ 85%.

- [ ] **Step 3: Commit**

```bash
git add tests/test_pi_bridge/test_security_adapter_coverage.py
git commit -m "test(pi_bridge): cover resolve-failure fail-closed branches"
```

---

## Task 5: Final verification + ruff

- [ ] **Step 1: Run combined coverage for both modules**

Run:
```
.venv\Scripts\python.exe -m pytest tests/ --cov=api.pi_bridge.security_adapter --cov=api.pi_bridge.approval_adapter --cov-report=term-missing -q
```
Expected:
- `security_adapter.py` ≥ 85%
- `approval_adapter.py` ≥ 90% (target 100%)
- All tests pass (no regressions)

- [ ] **Step 2: Run ruff on both new test files**

Run:
```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests/test_pi_bridge/test_security_adapter_coverage.py tests/test_pi_bridge/test_approval_adapter.py
```
Expected: No errors.

- [ ] **Step 3: Final commit if any cleanup needed (otherwise skip)**

Only if there are uncommitted changes:
```bash
git add -A
git commit -m "test(pi_bridge): finalize security/approval adapter coverage"
```

---

## Self-Review Notes

- **Spec coverage**: All uncovered line ranges (31-46, 51-63, 72-81, 101-103, 108-109, 147-149) have dedicated tests. `approval_adapter.py` fully covered.
- **No source modifications**: Only new test files created.
- **No scope violations**: Does not touch `test_security_adapter.py` or any other agent's files.
- **Security boundaries covered**: NUL bytes (fail-closed), resolve failures (fail-closed), Unicode paths, empty/None/non-string path inputs.
- **Known doc bug in `approval_adapter.py`**: docstring says default is `"auto"` but code returns `"ask"`. Recorded; not fixed (source modifications out of scope). Test asserts the actual behavior (`"ask"`).
