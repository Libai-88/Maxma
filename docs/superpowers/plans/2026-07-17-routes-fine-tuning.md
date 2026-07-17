# Routes Coverage Fine-Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push 5 high-coverage modules (persona 99%, sessions 97%, sticker_favorites 96%, upload 96%, event_hooks 93%) to 100% or near-100%.

**Architecture:** Read each module → identify specific uncovered lines → design targeted tests → implement → verify. Only create new test files; never modify source code or existing tests.

**Tech Stack:** Python 3.13, FastAPI, pytest, pytest-cov

---

## Uncovered Lines Summary (from `--cov-report=term-missing`)

| Module | Stmts | Miss | Cover | Missing Lines |
|---|---|---|---|---|
| persona.py | 165 | 2 | 99% | 73, 92 |
| sessions.py | 308 | 10 | 97% | 213, 215, 219, 221, 224, 250, 251, 321, 409, 461 |
| sticker_favorites.py | 178 | 8 | 96% | 87, 89, 92, 102, 224, 228, 230, 234 |
| upload.py | 89 | 4 | 96% | 55, 72, 73, 89 |
| event_hooks.py | 30 | 2 | 93% | 54, 55 |

---

### Task 1: event_hooks.py → 100% (cover lines 54-55)

**Files:**
- Create: `tests/test_api/test_event_hooks_coverage.py`

Lines 54-55 are the body of `get_history()`. The route `/event-hooks/history` is shadowed by `/event-hooks/{hook_id}` (defined first), so the HTTP test never reaches `get_history`. Call it directly.

- [ ] **Step 1: Write test calling `get_history()` directly**

```python
"""覆盖 — api/routes/event_hooks.py get_history 函数体（lines 54-55）。

/event-hooks/history 路由被先注册的 /event-hooks/{hook_id} 遮蔽，
HTTP 请求永远不会路由到 get_history，需直接调用函数。
"""

from __future__ import annotations

from api.routes import event_hooks


async def test_get_history_returns_404_omp_message():
    resp = await event_hooks.get_history()
    assert resp.status_code == 404
    assert resp.body == b'{"detail":"Event hooks are unavailable — OMP replaces event hooks"}'
```

- [ ] **Step 2: Run test, verify pass + coverage 100%**

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_event_hooks_coverage.py --cov=api.routes.event_hooks --cov-report=term-missing -v
```

- [ ] **Step 3: Commit**

---

### Task 2: persona.py → 100% (cover lines 73, 92)

**Files:**
- Create: `tests/test_api/test_persona_routes_coverage.py`

- **Line 73**: `raise HTTPException(status_code=400, detail="非法路径")` in `_get_persona_variant_path`. The regex `^SOUL\.[\w\u4e00-\u9fff\-]+\.md$` rejects `/` and `..`, so the `is_relative_to` check (line 72) can never fail under normal input. Cover by monkeypatching `Path.is_relative_to` to return False for the target path.

- **Line 92**: `os.unlink(temp_name)` in `_write_text_atomically` `finally` block. Triggered when `os.replace` fails but temp file still exists. Monkeypatch `os.replace` to raise OSError.

- [ ] **Step 1: Write tests**

```python
"""覆盖 — api/routes/persona.py 防御性分支（lines 73, 92）。"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routes import persona


@pytest.fixture
def persona_dir(monkeypatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
    (tmp_path / "SOUL.md").write_text("default", encoding="utf-8")
    return tmp_path


class TestGetPersonaVariantPathTraversal:
    async def test_rejects_non_relative_path(self, persona_dir: Path, monkeypatch):
        """Line 73: is_relative_to 返回 False 时抛 400。"""
        (persona_dir / "SOUL.test.md").write_text("x", encoding="utf-8")
        target_resolved = (persona_dir / "SOUL.test.md").resolve()
        original = Path.is_relative_to

        def fake_is_relative_to(self, other):
            if self == target_resolved:
                return False
            return original(self, other)

        monkeypatch.setattr(Path, "is_relative_to", fake_is_relative_to)
        with pytest.raises(HTTPException) as exc:
            persona._get_persona_variant_path("SOUL.test.md")
        assert exc.value.status_code == 400
        assert "非法路径" in exc.value.detail


class TestWriteTextAtomicallyCleanup:
    async def test_cleans_temp_file_when_replace_fails(self, persona_dir: Path, monkeypatch):
        """Line 92: os.replace 失败时 finally 清理临时文件。"""
        target = persona_dir / "SOUL.cleanup.md"

        def fail_replace(*_args, **_kwargs):
            raise OSError("replace failed")

        monkeypatch.setattr(os, "replace", fail_replace)
        with pytest.raises(OSError):
            persona._write_text_atomically(target, "content")
        # 临时文件应被清理
        tmp_files = list(persona_dir.glob(".*.tmp"))
        assert tmp_files == []
```

- [ ] **Step 2: Run tests + verify coverage 100%**

- [ ] **Step 3: Commit**

---

### Task 3: upload.py → 100% (cover lines 55, 72, 73, 89)

**Files:**
- Create: `tests/test_api/test_upload_coverage.py`

- **Line 55**: `raise HTTPException(status_code=400, detail="文件名不能为空")`. TestClient sends multipart with empty filename → FastAPI returns 422 before handler. Must call `upload_file` directly with a mock file whose `filename` is empty string.

- **Lines 72-73**: `except (TypeError, ValueError): cl_value = None`. Send request with non-integer Content-Length header. TestClient may not allow invalid headers, so call route directly with a mock request.

- **Line 89**: `raise HTTPException(status_code=413, ...)` during chunk read. TestClient auto-adds Content-Length, so the header check fires first. Call route directly with a mock file that yields chunks totaling > MAX_FILE_SIZE, while request has no Content-Length (or small Content-Length).

- [ ] **Step 1: Write tests calling `upload_file` directly with mocks**

```python
"""覆盖 — api/routes/upload.py 错误分支（lines 55, 72, 73, 89）。

TestClient/FastAPI 在路由前拦截部分错误（空文件名 422、自动 Content-Length），
需直接调用 upload_file 并注入 mock Request / UploadFile。
"""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from api.routes import upload as upload_mod


def _mock_request(headers: dict | None = None) -> MagicMock:
    req = MagicMock()
    req.headers = headers or {}
    return req


class TestUploadEmptyFilename:
    async def test_empty_filename_raises_400(self, monkeypatch, tmp_path):
        """Line 55: file.filename 为空字符串 → 400。"""
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        file = MagicMock()
        file.filename = ""
        file.read = AsyncMock(return_value=b"")
        with pytest.raises(HTTPException) as exc:
            await upload_mod.upload_file(_mock_request(), file)
        assert exc.value.status_code == 400
        assert "文件名不能为空" in exc.value.detail


class TestUploadInvalidContentLength:
    async def test_invalid_content_length_header_falls_back(self, monkeypatch, tmp_path):
        """Lines 72-73: Content-Length 非数字 → cl_value=None，继续读取。"""
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        file = MagicMock()
        file.filename = "ok.txt"
        file.read = AsyncMock(side_effect=[b"hi", b""])
        req = _mock_request(headers={"content-length": "not-a-number"})
        resp = await upload_mod.upload_file(req, file)
        assert resp["filename"] == "ok.txt"
        assert resp["size"] == 2


class TestUploadOversizeChunkRead:
    async def test_oversize_during_chunk_read_raises_413(self, monkeypatch, tmp_path):
        """Line 89: 分块累计超过 MAX_FILE_SIZE → 413（无 Content-Length 头）。"""
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        monkeypatch.setattr(upload_mod, "MAX_FILE_SIZE", 10)
        file = MagicMock()
        file.filename = "big.txt"
        # 第一次 read 返回 11 字节（>10），触发 line 89
        file.read = AsyncMock(return_value=b"x" * 11)
        req = _mock_request(headers={})  # 无 content-length
        with pytest.raises(HTTPException) as exc:
            await upload_mod.upload_file(req, file)
        assert exc.value.status_code == 413
        assert "文件过大" in exc.value.detail
```

- [ ] **Step 2: Run tests + verify coverage 100%**

- [ ] **Step 3: Commit**

---

### Task 4: sticker_favorites.py → 100% (cover lines 87, 89, 92, 102, 224, 228, 230, 234)

**Files:**
- Create: `tests/test_api/test_sticker_favorites_coverage.py`

- **Lines 87, 89, 92**: `_get_time_period` returns "late_night"/"morning"/"evening". Mock `datetime.datetime.now().hour`.
- **Line 102**: `_select_sticker` returns None when category dir exists but has no .webp files.
- **Line 224**: `categories.append(emotion.category)` in `get_recommendations`. Mock `_detect_emotion_from_text` to return an object with `.category`.
- **Lines 228, 230, 234**: time_period branches in `get_recommendations`. Mock `_get_time_period`.

- [ ] **Step 1: Write tests**

```python
"""覆盖 — api/routes/sticker_favorites.py 时间分支与推荐逻辑（lines 87,89,92,102,224,228,230,234）。"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from api.routes import sticker_favorites as sf


class TestGetTimePeriodBranches:
    @pytest.mark.parametrize("hour,expected", [
        (2, "late_night"),   # line 87
        (8, "morning"),      # line 89
        (20, "evening"),     # line 92
    ])
    def test_time_period_branches(self, monkeypatch, hour, expected):
        fake_now = MagicMock()
        fake_now.hour = hour
        monkeypatch.setattr(sf, "datetime", MagicMock(datetime=lambda: fake_now))
        assert sf._get_time_period() == expected


class TestSelectStickerEmptyDir:
    def test_returns_none_when_no_webp(self, tmp_path, monkeypatch):
        """Line 102: 分类目录存在但无 .webp 文件 → None。"""
        stickers = tmp_path / "stickers"
        (stickers / "空").mkdir(parents=True)
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        assert sf._select_sticker("空") is None


class TestRecommendationsEmotionBranch:
    async def test_emotion_detected_appends_category(self, tmp_path, monkeypatch):
        """Line 224: _detect_emotion_from_text 返回非 None → append category。"""
        stickers = tmp_path / "stickers"
        cat = stickers / "爱心"
        cat.mkdir(parents=True)
        (cat / "a.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)

        emotion = MagicMock()
        emotion.category = "爱心"
        monkeypatch.setattr(sf, "_detect_emotion_from_text", lambda _t: emotion)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "work")

        resp = await sf.get_recommendations(text="happy", limit=4)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "爱心" in cats


class TestRecommendationsTimeBranches:
    async def test_late_night_branch(self, tmp_path, monkeypatch):
        """Line 228: late_night → extend 爱心/委屈/日常。"""
        stickers = tmp_path / "stickers"
        for c in ["爱心", "委屈", "日常"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "late_night")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "委屈" in cats

    async def test_morning_branch(self, tmp_path, monkeypatch):
        """Line 230: morning → extend 日常/开心。"""
        stickers = tmp_path / "stickers"
        for c in ["日常", "开心"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "morning")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "日常" in cats

    async def test_evening_branch(self, tmp_path, monkeypatch):
        """Line 234: evening → extend 开心/爱心/日常。"""
        stickers = tmp_path / "stickers"
        for c in ["开心", "爱心", "日常"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "evening")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "开心" in cats
```

- [ ] **Step 2: Run tests + verify coverage 100%**

- [ ] **Step 3: Commit**

---

### Task 5: sessions.py → 100% (cover lines 213, 215, 219, 221, 224, 250, 251, 321, 409, 461)

**Files:**
- Create: `tests/test_api/test_sessions_routes_coverage.py`

Reuse the `_FakeSession` / `_FakeSessionManager` / `_FakeSidecarManager` / `_patch_session_map` patterns from `test_sessions_routes_sidecar.py`.

- **Lines 213, 215**: `_sync_const_session_after_undo` — SessionMap returns None, `session._sidecar_session_id` is None → return.
- **Lines 219, 221**: `_sync_const_session_after_undo` — `sidecar_mgr=None` param, `session._sidecar_mgr=None` → return.
- **Line 224**: `_sync_const_session_after_undo` — `sidecar_mgr.client is None` → return.
- **Lines 250, 251**: `_sync_const_session_after_undo` — exception in try block → logger.warning.
- **Line 321**: `get_context_usage` — SessionMap returns None, session has `_sidecar_session_id`.
- **Line 409**: `constify_session` — SessionMap returns None, session has `_sidecar_session_id`.
- **Line 461**: `generate_session_title` — SessionMap returns None, session has `_sidecar_session_id`.

- [ ] **Step 1: Write tests**

- [ ] **Step 2: Run tests + verify coverage 100%**

- [ ] **Step 3: Commit**

---

### Task 6: Final verification

- [ ] **Step 1: Run full test suite + coverage for all 5 modules**

```
cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --cov=api.routes.persona --cov=api.routes.sessions --cov=api.routes.sticker_favorites --cov=api.routes.upload --cov=api.routes.event_hooks --cov-report=term-missing -q
```

- [ ] **Step 2: Run ruff on new test files**

```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
```

- [ ] **Step 3: Final commit if needed**
