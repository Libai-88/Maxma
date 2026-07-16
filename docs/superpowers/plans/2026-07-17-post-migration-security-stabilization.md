# Post-Migration Security Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the P0 security stubs and runtime crash bugs discovered after the oh-my-pi migration, making the declared path-safety defenses actually enforce.

**Architecture:** The migration from LangGraph to oh-my-pi sidecar deleted `tools/path_security.py` (which had real security logic) and replaced it with `api/pi_bridge/security_adapter.py` (which has stubs). This plan ports the real logic back, hardens fail-open exception handlers to fail-closed, implements the stub `check_path_blocked` endpoint, scrubs leaked credentials, and adds CI guards to prevent regression.

**Tech Stack:** Python 3.13, FastAPI, pytest (asyncio auto mode), ruff, gitleaks, GitHub Actions

---

## Scope Check

This plan covers **one subsystem**: backend Python path-security stabilization. The following related issues are **out of scope** and should be separate plans:

- **Frontend memory leak fixes** (`ModelSelector.vue`, `useTheme.ts`, `App.vue`) — separate plan
- **CI coverage expansion** (frontend Vitest, Bun sidecar tests, build verification) — separate plan
- **Sidecar `done` event refactor** (`session-bridge.ts` BUG3/BUG4) — separate plan
- **Silent `except Exception: pass` sweep** (11 locations in chat/session/rpc) — separate plan

Each of those produces working, testable software on its own.

---

## File Structure

**Files to modify:**
- `api/routes/upload.py` — add `import re` (P0 runtime crash)
- `api/pi_bridge/security_adapter.py` — implement `check_path_access`, harden `_is_blocker_present` to fail-closed, add `_find_blocker_path`
- `api/routes/path_whitelist.py` — implement `check_path_blocked` endpoint (currently stub)
- `docs/了解_Maxma_大迭代_2026-07-16_11-52.md` — scrub leaked TOKEN / API key
- `.github/workflows/pytest.yml` — add ruff F821 + gitleaks steps

**Files to create:**
- `tests/test_pi_bridge/__init__.py` — test package init
- `tests/test_pi_bridge/test_security_adapter.py` — unit tests for security_adapter
- `tests/test_api/test_path_whitelist_check.py` — integration tests for check-path-blocked endpoint
- `tests/test_api/test_upload.py` — integration test for upload route (catches the `import re` regression)
- `docs/security-contract.md` — Maxma ↔ oh-my-pi security responsibility contract

**Files to delete:**
- `tests/test_path_security.py` — dead test file (tests deleted `tools/path_security.py`, always skipped)

---

## Task 1: Fix `upload.py` missing `import re` (P0 runtime crash)

> **EXECUTION NOTE:** Completed as commit `e812a6b`. Two-stage review found a bonus bug: the Windows reserved-name check compared `safe.upper()` (including extension) against the reserved set, so `CON.txt` was not caught. Fix applied: use `safe.split(".", 1)[0].upper()` to compare the stem before the first dot. All 6 tests pass.

**Files:**
- Modify: `api/routes/upload.py:1-6` (import) and `:35-43` (reserved-name check)

- [ ] **Step 1: Write the failing test**

Create `tests/test_api/test_upload.py`:

```python
"""Integration tests for the upload route — catches the missing `import re` regression."""

import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.upload import router, _sanitize_filename


app = FastAPI()
app.include_router(router)
client = TestClient(app)


class TestSanitizeFilename:
    def test_strips_unicode_and_spaces(self):
        assert _sanitize_filename("hello world.txt") == "helloworld.txt"

    def test_strips_chinese_chars(self):
        assert _sanitize_filename("文件 名.py") == ".py"

    def test_keeps_allowed_chars(self):
        assert _sanitize_filename("my-file_v1.2.txt") == "my-file_v1.2.txt"

    def test_windows_reserved_name_gets_prefix(self):
        result = _sanitize_filename("CON.txt")
        assert result.startswith("_")

    def test_empty_after_sanitization_returns_default(self):
        assert _sanitize_filename("中文") == "unnamed_file"


class TestUploadRoute:
    def test_upload_txt_file_succeeds(self, tmp_path, monkeypatch):
        """Upload route must not crash with NameError on `re.sub`."""
        from api.routes import upload as upload_mod
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)

        response = client.post(
            "/upload",
            files={"file": ("test file.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "testfile.txt"
        assert data["size"] == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_upload.py -v`
Expected: FAIL with `NameError: name 're' is not defined` in `_sanitize_filename`

- [ ] **Step 3: Add the missing import**

In `api/routes/upload.py`, add `import re` to the import block at the top. The modified header should read:

```python
"""文件上传 API — 用户上传文件供 Agent 读取和分析。"""

import os
import re
import time
import uuid
from pathlib import Path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_upload.py -v`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/routes/upload.py tests/test_api/test_upload.py
git commit -m "fix: add missing import re in upload.py — was crashing on every file upload"
```

---

## Task 2: Delete dead `test_path_security.py`

**Files:**
- Delete: `tests/test_path_security.py`

- [ ] **Step 1: Confirm the test file is dead**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_path_security.py -v --co`
Expected: All tests show `SKIPPED` with reason `tools/path_security.py not available (tools/ removed)`. This confirms the file tests a deleted module.

- [ ] **Step 2: Delete the file**

Delete `tests/test_path_security.py`.

- [ ] **Step 3: Verify no imports break**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v --co -q | head -20`
Expected: No `ImportError` or `ModuleNotFoundError`. Test collection succeeds.

- [ ] **Step 4: Commit**

```bash
cd d:\Maxma\MaxmaHere
git rm tests/test_path_security.py
git commit -m "chore: remove dead test_path_security.py — tests deleted tools/ module, always skipped"
```

---

## Task 3: Write failing tests for `check_path_access` whitelist enforcement

**Files:**
- Create: `tests/test_pi_bridge/__init__.py`
- Test: `tests/test_pi_bridge/test_security_adapter.py`

- [ ] **Step 1: Create test package init**

Create `tests/test_pi_bridge/__init__.py` with empty content (just a newline):

```python
```

- [ ] **Step 2: Write failing tests for `check_path_access`**

Create `tests/test_pi_bridge/test_security_adapter.py`:

```python
"""Unit tests for api.pi_bridge.security_adapter — path whitelist & MaxmaBlocker enforcement.

These tests verify that the security checks actually enforce (not stubs).
"""

from pathlib import Path
from unittest.mock import patch

import pytest

from api.pi_bridge import security_adapter


# ── check_path_access ───────────────────────────────────────


class TestCheckPathAccess:
    """check_path_access(path) -> str | None. None = allowed, str = block reason."""

    def test_empty_path_blocked(self):
        result = security_adapter.check_path_access("")
        assert result is not None

    def test_empty_whitelist_blocks_all(self, tmp_path, monkeypatch):
        """Empty whitelist must fail-secure (block everything)."""
        monkeypatch.setattr(security_adapter, "_load_whitelist", lambda: [])
        result = security_adapter.check_path_access(str(tmp_path))
        assert result is not None
        assert "白名单" in result

    def test_exact_match_allowed(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        assert security_adapter.check_path_access(str(allowed)) is None

    def test_recursive_child_allowed(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        assert security_adapter.check_path_access(str(child)) is None

    def test_non_recursive_blocks_child(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), False)]
        )
        result = security_adapter.check_path_access(str(child))
        assert result is not None

    def test_non_recursive_allows_exact(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), False)]
        )
        assert security_adapter.check_path_access(str(allowed)) is None

    def test_non_whitelisted_path_blocked(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        result = security_adapter.check_path_access(str(other))
        assert result is not None
        assert "白名单" in result

    def test_symlink_to_outside_blocked(self, tmp_path, monkeypatch):
        """Symlink under allowed dir pointing outside must be blocked."""
        import os
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        (outside / "secret.txt").write_text("secret", encoding="utf-8")
        try:
            os.symlink(outside, allowed / "link", target_is_directory=True)
        except (OSError, NotImplementedError):
            pytest.skip("symlinks unavailable on this host")

        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        result = security_adapter.check_path_access(str(allowed / "link" / "secret.txt"))
        assert result is not None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter.py::TestCheckPathAccess -v`
Expected: FAIL — `check_path_access` returns `None` for everything (stub), so `test_empty_path_blocked`, `test_empty_whitelist_blocks_all`, `test_non_recursive_blocks_child`, `test_non_whitelisted_path_blocked`, `test_symlink_to_outside_blocked` will fail.

- [ ] **Step 4: Commit the failing tests**

```bash
cd d:\Maxma\MaxmaHere
git add tests/test_pi_bridge/__init__.py tests/test_pi_bridge/test_security_adapter.py
git commit -m "test: add failing tests for security_adapter.check_path_access whitelist enforcement"
```

---

## Task 4: Implement `check_path_access` and `_load_whitelist` in `security_adapter.py`

**Files:**
- Modify: `api/pi_bridge/security_adapter.py:1-14` (imports), `:63-71` (check_path_access)

- [ ] **Step 1: Add imports for whitelist loading**

In `api/pi_bridge/security_adapter.py`, add imports after the existing `from pathlib import Path` line. The modified header should read:

```python
"""安全适配器 — 使 oh-my-pi 的工具遵守 Maxma 的安全策略。

包括：
- 路径白名单：限制 AI 可读写的文件目录范围
- MaxmaBlocker：在敏感目录下放置 .maxma_blocker 标记文件，发现即阻断
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app_paths import PATH_WHITELIST_YAML_PATH
from api.yaml_store import load_yaml

logger = logging.getLogger(__name__)
```

- [ ] **Step 2: Implement `_load_whitelist` and replace `check_path_access`**

Replace the entire `check_path_access` function (lines 63-71) with:

```python
def _load_whitelist() -> list[tuple[str, bool]]:
    """从 path_whitelist.yaml 加载白名单条目。

    Returns:
        (path, recursive) 元组列表。
    """
    if not PATH_WHITELIST_YAML_PATH.exists():
        return []
    raw = load_yaml(PATH_WHITELIST_YAML_PATH, default={}) or {}
    entries = raw.get("whitelist", []) or []
    result: list[tuple[str, bool]] = []
    for e in entries:
        if isinstance(e, dict) and "path" in e:
            recursive = e.get("recursive", True)
            result.append((str(e["path"]), bool(recursive)))
    return result


def check_path_access(path: str) -> str | None:
    """检查路径是否在白名单内（fail-secure）。

    空白名单拒绝所有访问。路径解析失败也拒绝。

    Returns:
        None 表示允许，字符串表示阻断原因。
    """
    if not path:
        return "路径为空，拒绝访问"

    whitelist = _load_whitelist()
    if not whitelist:
        return "白名单为空，拒绝所有访问"

    try:
        resolved = Path(path).resolve(strict=False)
    except (OSError, ValueError) as exc:
        logger.warning("[security] 路径解析失败（fail-closed）%s: %s", path, exc)
        return f"路径解析失败，拒绝访问: {exc}"

    for allowed_raw, recursive in whitelist:
        try:
            allowed = Path(allowed_raw).resolve(strict=False)
        except (OSError, ValueError):
            continue

        if resolved == allowed:
            return None  # 精确匹配

        if recursive:
            try:
                resolved.relative_to(allowed)
                return None  # 在递归白名单目录下
            except ValueError:
                pass

    return f"路径 '{path}' 不在白名单中"
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter.py::TestCheckPathAccess -v`
Expected: PASS (all 8 tests)

- [ ] **Step 4: Run full test suite to check for regressions**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v -x`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/pi_bridge/security_adapter.py
git commit -m "feat: implement check_path_access whitelist enforcement — was stub returning None"
```

---

## Task 5: Write failing tests for `_is_blocker_present` fail-closed behavior

**Files:**
- Test: `tests/test_pi_bridge/test_security_adapter.py` (append)

- [ ] **Step 1: Append failing tests for `_is_blocker_present` and `_find_blocker_path`**

Append to `tests/test_pi_bridge/test_security_adapter.py`:

```python
# ── _is_blocker_present / _find_blocker_path ────────────────


class TestIsBlockerPresent:
    """_is_blocker_present(path) -> bool. _find_blocker_path(path) -> str | None."""

    def test_no_blocker_returns_false(self, tmp_path):
        target = tmp_path / "clean"
        target.mkdir()
        assert security_adapter._is_blocker_present(str(target)) is False

    def test_blocker_in_target_dir_detected(self, tmp_path):
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        assert security_adapter._is_blocker_present(str(target)) is True

    def test_blocker_in_parent_detected(self, tmp_path):
        parent = tmp_path / "parent"
        child = parent / "child"
        child.mkdir(parents=True)
        (parent / ".maxma_blocker").write_text("", encoding="utf-8")
        assert security_adapter._is_blocker_present(str(child)) is True

    def test_find_blocker_returns_path(self, tmp_path):
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        result = security_adapter._find_blocker_path(str(target))
        assert result is not None
        assert Path(result).name == "blocked"

    def test_find_blocker_returns_none_when_clean(self, tmp_path):
        target = tmp_path / "clean"
        target.mkdir()
        assert security_adapter._find_blocker_path(str(target)) is None

    def test_malformed_path_fail_closed(self):
        """Resolve failure must fail-closed (block), not fail-open (allow)."""
        # NUL bytes in path cause OSError on Windows resolve
        result = security_adapter._is_blocker_present("foo\x00bar")
        assert result is True  # fail-closed: blocker "found"

    def test_malformed_path_find_returns_path(self):
        """_find_blocker_path on malformed path returns non-None (fail-closed)."""
        result = security_adapter._find_blocker_path("foo\x00bar")
        assert result is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter.py::TestIsBlockerPresent -v`
Expected: FAIL — `test_malformed_path_fail_closed` and `test_malformed_path_find_returns_path` fail because current `_is_blocker_present` has `except Exception: pass` (fail-open, returns False). Also `_find_blocker_path` does not exist yet (`AttributeError`).

- [ ] **Step 3: Commit the failing tests**

```bash
cd d:\Maxma\MaxmaHere
git add tests/test_pi_bridge/test_security_adapter.py
git commit -m "test: add failing tests for _is_blocker_present fail-closed behavior"
```

---

## Task 6: Implement fail-closed `_is_blocker_present` and `_find_blocker_path`

**Files:**
- Modify: `api/pi_bridge/security_adapter.py:74-84` (_is_blocker_present)

- [ ] **Step 1: Replace `_is_blocker_present` with fail-closed version + add `_find_blocker_path`**

Replace the entire `_is_blocker_present` function (lines 74-84) with:

```python
def _is_blocker_present(path: str) -> bool:
    """检查路径或其父目录中是否存在 .maxma_blocker（fail-closed）。

    路径解析失败时视为存在 blocker（fail-closed），防止攻击者构造
    畸形路径绕过 MaxmaBlocker 检查。
    """
    return _find_blocker_path(path) is not None


def _find_blocker_path(path: str) -> str | None:
    """查找路径或其父目录中的 .maxma_blocker，返回拒止锚所在目录路径。

    路径解析失败时返回 path 本身（fail-closed：视为存在 blocker）。

    Returns:
        拒止锚所在目录的字符串路径，或 None（未发现 blocker）。
    """
    try:
        p = Path(path).resolve(strict=False)
    except (OSError, ValueError) as exc:
        logger.warning("[security] 路径解析失败（fail-closed）%s: %s", path, exc)
        return str(path)  # fail-closed: 视为存在 blocker
    for parent in [p] + list(p.parents):
        if (parent / ".maxma_blocker").exists():
            logger.warning("[security] MaxmaBlocker found at %s", parent)
            return str(parent)
    return None
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter.py::TestIsBlockerPresent -v`
Expected: PASS (all 7 tests)

- [ ] **Step 3: Run full security_adapter test suite**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_security_adapter.py -v`
Expected: PASS (all 15 tests)

- [ ] **Step 4: Run full test suite for regressions**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v -x`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/pi_bridge/security_adapter.py
git commit -m "fix: harden _is_blocker_present to fail-closed — was fail-open via bare except Exception: pass"
```

---

## Task 7: Write failing test for `check_path_blocked` endpoint

**Files:**
- Test: `tests/test_api/test_path_whitelist_check.py`

- [ ] **Step 1: Write failing test for the endpoint**

Create `tests/test_api/test_path_whitelist_check.py`:

```python
"""Integration tests for GET /check-path-blocked endpoint — was a stub returning always False."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.path_whitelist import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


class TestCheckPathBlocked:
    def test_clean_path_not_blocked(self, tmp_path):
        """Path with no blocker and in whitelist should not be blocked."""
        target = tmp_path / "clean"
        target.mkdir()
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is False

    def test_blocker_path_blocked(self, tmp_path):
        """Path with .maxma_blocker should be blocked."""
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is True
        assert data["reason"] is not None

    def test_non_whitelisted_path_blocked(self, tmp_path):
        """Path not in whitelist should be blocked."""
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(allowed), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(other)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is True

    def test_blocker_path_returned_when_blocker_present(self, tmp_path):
        """blocker_path should contain the blocker directory."""
        target = tmp_path / "blocked_dir"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        data = response.json()
        assert data["blocked"] is True
        assert data["blocker_path"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_path_whitelist_check.py -v`
Expected: FAIL — `test_blocker_path_blocked`, `test_non_whitelisted_path_blocked`, `test_blocker_path_returned_when_blocker_present` fail because endpoint always returns `{"blocked": False, ...}` (stub).

- [ ] **Step 3: Commit the failing test**

```bash
cd d:\Maxma\MaxmaHere
git add tests/test_api/test_path_whitelist_check.py
git commit -m "test: add failing tests for check-path-blocked endpoint — was stub returning always False"
```

---

## Task 8: Implement `check_path_blocked` endpoint

**Files:**
- Modify: `api/routes/path_whitelist.py:83-99`

- [ ] **Step 1: Replace the stub endpoint with real implementation**

In `api/routes/path_whitelist.py`, replace the entire `check_path_blocked` function (lines 83-99, from `# ── 路径安全检查` through the end of the file) with:

```python
# ── 路径安全检查（供前端气泡标红使用） ──


@router.get("/check-path-blocked")
async def check_path_blocked(path: str = Query(..., description="要检查的路径")):
    """检查路径是否被拒止锚或白名单阻挡。

    返回:
        - ``blocked``: 是否被阻挡
        - ``reason``: 阻挡原因（仅 blocked=True 时有值）
        - ``blocker_path``: 拒止锚所在目录（仅拒止锚阻挡时有值）
    """
    from api.pi_bridge.security_adapter import _find_blocker_path, check_path_access

    # 先检查白名单
    blocked_reason = check_path_access(path)
    if blocked_reason:
        return {
            "blocked": True,
            "reason": blocked_reason,
            "blocker_path": None,
        }

    # 再检查 MaxmaBlocker
    blocker_path = _find_blocker_path(path)
    if blocker_path is not None:
        return {
            "blocked": True,
            "reason": f"路径包含 MaxmaBlocker 拒止锚: {blocker_path}",
            "blocker_path": blocker_path,
        }

    return {
        "blocked": False,
        "reason": None,
        "blocker_path": None,
    }
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_path_whitelist_check.py -v`
Expected: PASS (all 4 tests)

- [ ] **Step 3: Run full test suite for regressions**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v -x`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/routes/path_whitelist.py
git commit -m "feat: implement check_path_blocked endpoint — was stub returning always False"
```

---

## Task 9: Scrub leaked credentials from docs

**Files:**
- Modify: `docs/了解_Maxma_大迭代_2026-07-16_11-52.md` (lines 33830, 34389, 34501, 34735, 34811, 35366)

- [ ] **Step 1: Replace leaked TOKEN (appears 3 times with two variants)**

In `docs/了解_Maxma_大迭代_2026-07-16_11-52.md`, use replace_all to replace:

Old string: `TOKEN = '<redacted-token-1>'`
New string: `TOKEN = '<redacted-rotate-this-token>'`

- [ ] **Step 2: Replace leaked lowercase token**

Old string: `token = '<redacted-token-1>'`
New string: `token = '<redacted-rotate-this-token>'`

- [ ] **Step 3: Replace second TOKEN variant (appears twice)**

Old string: `TOKEN = '<redacted-token-2>'`
New string: `TOKEN = '<redacted-rotate-this-token>'`

- [ ] **Step 4: Replace leaked API key**

Old string: `p.api_key = '<redacted-api-key>'`
New string: `p.api_key = '<redacted-rotate-this-key>'`

- [ ] **Step 5: Verify no tokens remain**

Run: `cd d:\Maxma\MaxmaHere && findstr /S /R "<redacted-token-1> <redacted-token-2> sk-80c22ad320e6991e" docs\*.md`
Expected: No matches found (all redacted).

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add "docs/了解_Maxma_大迭代_2026-07-16_11-52.md"
git commit -m "security: scrub leaked TOKEN and API key from docs — rotate all exposed credentials"
```

---

## Task 10: Write Maxma ↔ oh-my-pi security responsibility contract

**Files:**
- Create: `docs/security-contract.md`

- [ ] **Step 1: Create the contract document**

Create `docs/security-contract.md`:

```markdown
# Security Responsibility Contract: Maxma ↔ oh-my-pi

> **Status:** Active. This document defines the security boundary between Maxma and the oh-my-pi sidecar. Any change to path-security behavior must update this contract.

## 1. Scope

This contract governs **filesystem path security** for all AI tool calls executed through the oh-my-pi sidecar.

## 2. Responsibility Boundary

### Maxma owns (enforced in `api/pi_bridge/security_adapter.py`):

| Responsibility | Implementation | Failure Mode |
|---|---|---|
| Path whitelist loading | `_load_whitelist()` reads `path_whitelist.yaml` | Empty/missing file → block all (fail-secure) |
| Path whitelist enforcement | `check_path_access(path)` checks resolved path against whitelist | Non-whitelisted → block |
| MaxmaBlocker detection | `_find_blocker_path(path)` walks ancestors for `.maxma_blocker` | Resolve error → block (fail-closed) |
| Tool-call security gate | `check_tool_security(tool_name, tool_args)` orchestrates both checks | Any block → return reason string |
| Frontend path-check API | `GET /check-path-blocked` exposes both checks for UI bubble display | Returns `blocked: true` with reason |

### oh-my-pi owns (enforced in sidecar):

| Responsibility | Implementation |
|---|---|
| Tool execution sandbox | Bun runtime process isolation |
| Command approval levels | `approval_adapter.py` maps Maxma approval → OMP approval |
| Session lifecycle | `session-bridge.ts` manages create/prompt/cancel/destroy |

### Neither side delegates to the other for path security.

The previous comment `# OMP sidecar handles path security` in `security_adapter.py` was **incorrect** and has been removed. Maxma enforces path security because only Maxma has access to `path_whitelist.yaml` (user-managed via REST API).

## 3. Fail-Secure Principles

1. **Empty whitelist = block all.** No implicit allow.
2. **Path resolve failure = block.** Fail-closed, never fail-open.
3. **Blocker check exception = block.** `except Exception: pass` is forbidden in security-critical paths.
4. **Symlink resolution.** `Path.resolve()` follows symlinks; a symlink under an allowed dir pointing outside is blocked because the resolved path won't match.

## 4. Testing Requirements

Any change to `security_adapter.py` or `path_whitelist.py` must:
- Run `pytest tests/test_pi_bridge/test_security_adapter.py tests/test_api/test_path_whitelist_check.py -v`
- All tests must pass with no skips.

## 5. Change Protocol

When upgrading oh-my-pi to a new major version:
1. Re-verify this contract against OMP's changelog.
2. Run the security test suite.
3. Confirm `check_tool_security` is still invoked at the correct hook point in the sidecar bridge.
```

- [ ] **Step 2: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add docs/security-contract.md
git commit -m "docs: add Maxma ↔ oh-my-pi security responsibility contract"
```

---

## Task 11: Add ruff F821 and gitleaks to CI

**Files:**
- Create: `.github/workflows/security.yml`

- [ ] **Step 1: Create the security CI workflow**

Create `.github/workflows/security.yml`:

```yaml
name: Security Checks

on: [push, pull_request]

jobs:
  ruff-undefined-names:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - run: pip install ruff
      - name: Check for undefined names (F821) — catches missing imports like `re`
        run: ruff check --select=F821 agent api config tests

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Scan for leaked secrets in all files (including docs)
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Verify ruff F821 passes locally**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=F821 agent api config tests`
Expected: No errors (after Task 1 fixed `import re`). If errors appear, fix them before committing.

- [ ] **Step 3: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add .github/workflows/security.yml
git commit -m "ci: add ruff F821 (undefined names) and gitleaks secret scanning"
```

---

## Task 12: Final verification — full test suite + ruff + compileall

- [ ] **Step 1: Run full test suite**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -v`
Expected: All tests PASS, zero skips (the dead skipif test was deleted in Task 2).

- [ ] **Step 2: Run ruff full check**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`
Expected: No errors.

- [ ] **Step 3: Run compileall**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m compileall -q agent api config tests`
Expected: No errors.

- [ ] **Step 4: Verify no leaked credentials in git history (optional but recommended)**

Run: `cd d:\Maxma\MaxmaHere && git log --all -p -- docs/ | findstr "<redacted-token-1>"`
Expected: Matches may appear in old commits. If they do, consider `git filter-repo` or BFG to purge history (coordinate with team first — rewrites history).

---

## Summary: What this plan fixes

| Bug | Severity | Task | Status before | Status after |
|---|---|---|---|---|
| `upload.py` missing `import re` | P0 crash | Task 1 | Runtime `NameError` on every upload | Fixed + regression test |
| `check_path_access` stub | P0 security | Tasks 3-4 | Always returns None (allow all) | Real whitelist enforcement, fail-secure |
| `_is_blocker_present` fail-open | P0 security | Tasks 5-6 | `except Exception: pass` bypassable | Fail-closed on resolve errors |
| `check_path_blocked` stub endpoint | P0 security | Tasks 7-8 | Always returns `blocked: False` | Real check using security_adapter |
| Dead `test_path_security.py` | P2 quality | Task 2 | Tests deleted module, always skipped | Deleted |
| Leaked TOKEN/API key in docs | P0 security | Task 9 | Real credentials in version control | Redacted (rotate externally!) |
| Security responsibility unclear | P1 design | Task 10 | Comment "OMP handles it" (wrong) | Contract document defines boundary |
| CI misses undefined names + secrets | P1 CI | Task 11 | Only E9/F63/F7, no gitleaks on docs | F821 + gitleaks added |

**External action required (not in this plan):** Rotate the leaked credentials — `<redacted-token-1>`, `<redacted-token-2>`, `<redacted-api-key>`. Scrubbing docs does not invalidate them.
