# Remaining Routes Coverage Final Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for 6 remaining low-coverage modules (`api/routes/sticker_upload.py`, `api/routes/files.py`, `api/routes/providers.py`, `api/routes/tool_stats.py`, `api/errors.py`, `api/activity_hub.py`) to 95%+, pushing overall from 97% to 98%+.

**Architecture:** Read each module → identify uncovered lines from `--cov-report=term-missing` → design tests targeting those lines → implement in new test files → verify pass + coverage. Only new test files; no source edits.

**Tech Stack:** Python 3.13, FastAPI, pytest, pytest-cov, pytest-asyncio, PIL/Pillow.

---

## Current State (measured before plan)

| Module | Statements | Missing | Coverage | Missing lines |
|---|---|---|---|---|
| `api/routes/sticker_upload.py` | 85 | 14 | 84% | 37-53, 61, 78 |
| `api/routes/files.py` | 48 | 7 | 85% | 45-49, 58-59 |
| `api/routes/providers.py` | 5 | 1 | 80% | 9 |
| `api/routes/tool_stats.py` | 7 | 1 | 86% | 42 |
| `api/errors.py` | 53 | 7 | 87% | 64, 77, 83, 89-92, 113 |
| `api/activity_hub.py` | 74 | 13 | 82% | 117-125, 129-131, 135-141 |
| **TOTAL** | 4700 | 128 | 97% | — |

### Line-level analysis

- **sticker_upload 37-53**: GIF branch of `_convert_to_webp` (animated WebP).
- **sticker_upload 61**: RGB-mode static image convert branch (else of `if img.mode in ('RGBA','LA','P')`).
- **sticker_upload 78**: `raise HTTPException(400, "缺少文件名")` — Starlette returns 422 before reaching this when filename="" via TestClient; must call route fn directly with a fake UploadFile.
- **files 45-49**: Windows DPI awareness ctypes fallback (nested except). Per task hint, skip.
- **files 58-59**: `tk.call("tk", "scaling", ...)` exception handler — coverable by mocking `winfo_fpixels` to raise.
- **providers 9**: `list_providers` body (route never invoked by any test).
- **tool_stats 42**: `list_tools` return body (route never invoked by any test).
- **errors 64**: `result["trace_id"] = self.trace_id` branch (when trace_id set).
- **errors 77/83/89-92**: `category` property branches — user_error / tool_error / rate_limit / cancelled / system_error.
- **errors 113**: `format_ws_error` function body (never called directly in tests).
- **activity_hub 117-125**: `rehydrate_orphans` method body.
- **activity_hub 129-131**: `list_by_session` method body.
- **activity_hub 135-141**: `clear_by_session` method body.

---

## File Structure (new files only)

| File | Purpose |
|---|---|
| `tests/test_api/test_sticker_upload_extra.py` | GIF conversion, RGB static conversion, empty-filename route-direct test |
| `tests/test_api/test_files_dpi_scaling.py` | tk.call scaling exception branch (lines 58-59) |
| `tests/test_api/test_providers_routes.py` | `/providers` endpoint via TestClient |
| `tests/test_api/test_tool_stats_routes.py` | `/tools` endpoint via TestClient |
| `tests/test_api/test_errors.py` | `AppError.to_dict`, `category` branches, `make_error`, `format_ws_error` |
| `tests/test_api/test_activity_hub.py` | `rehydrate_orphans`, `list_by_session`, `clear_by_session`, singleton |

---

## Task 1: sticker_upload extra coverage (84% → 95%+)

**Files:**
- Create: `tests/test_api/test_sticker_upload_extra.py`

Uncovered lines: 37-53 (GIF branch), 61 (RGB static), 78 (empty filename).

- [ ] **Step 1: Write test file**

```python
"""Tests for api/routes/sticker_upload.py — GIF branch, RGB static, empty filename."""

import io
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image

from api.routes import sticker_upload as mod


def _make_gif_bytes(n_frames: int = 3) -> bytes:
    """生成 n 帧的动态 GIF。"""
    frames = []
    for i in range(n_frames):
        img = Image.new("RGBA", (20, 20), (i * 60, 0, 0, 255))
        frames.append(img)
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:],
                   duration=100, loop=0)
    return buf.getvalue()


def _make_rgb_jpeg_bytes() -> bytes:
    """生成 RGB 模式的 JPEG（非 RGBA/LA/P）。"""
    img = Image.new("RGB", (30, 30), (0, 128, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class TestConvertGif:
    def test_convert_animated_gif_success(self, tmp_path):
        src = tmp_path / "anim.gif"
        src.write_bytes(_make_gif_bytes(3))
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()
        out = Image.open(dst)
        assert out.format == "WEBP"

    def test_convert_single_frame_gif(self, tmp_path):
        src = tmp_path / "one.gif"
        src.write_bytes(_make_gif_bytes(1))
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()


class TestConvertRgbStatic:
    def test_convert_rgb_jpeg_to_webp(self, tmp_path):
        """覆盖 line 61: img.mode 不在 ('RGBA','LA','P') 的 else 分支。"""
        src = tmp_path / "rgb.jpg"
        src.write_bytes(_make_rgb_jpeg_bytes())
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()
        out = Image.open(dst)
        assert out.format == "WEBP"


class TestEmptyFilenameRoute:
    """覆盖 line 78: file.filename 为空字符串时 raise 400。

    TestClient 路径下 Starlette 会先返回 422，因此直接调用 route 函数，
    传入 filename="" 的伪 UploadFile。
    """

    class _FakeUploadFile:
        def __init__(self, filename: str, content: bytes = b""):
            self.filename = filename
            self._content = content

        async def read(self) -> bytes:
            return self._content

    def test_empty_filename_raises_400(self):
        fake = self._FakeUploadFile(filename="", content=b"x")
        with pytest.raises(HTTPException) as exc:
            import asyncio
            asyncio.run(mod.upload_sticker(file=fake))
        assert exc.value.status_code == 400
        assert "缺少文件名" in exc.value.detail

    def test_none_filename_raises_400(self):
        fake = self._FakeUploadFile(filename=None, content=b"x")
        with pytest.raises(HTTPException) as exc:
            import asyncio
            asyncio.run(mod.upload_sticker(file=fake))
        assert exc.value.status_code == 400
```

- [ ] **Step 2: Run new tests, verify pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_sticker_upload_extra.py -v`
Expected: 5 passed.

- [ ] **Step 3: Verify coverage delta**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_sticker_upload_extra.py tests/test_api/test_sticker_upload.py --cov=api.routes.sticker_upload --cov-report=term-missing -q`
Expected: sticker_upload.py ≥ 95%.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_sticker_upload_extra.py
git commit -m "test: cover sticker_upload GIF/RGB/empty-filename branches (84% -> 95%+)"
```

---

## Task 2: providers + tool_stats route tests (80%/86% → 100%)

**Files:**
- Create: `tests/test_api/test_providers_routes.py`
- Create: `tests/test_api/test_tool_stats_routes.py`

Both modules have a single route whose body is never invoked.

- [ ] **Step 1: Write providers test**

```python
"""Tests for api/routes/providers.py — GET /providers."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.providers import router


def test_list_providers_returns_all():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/providers")
    assert resp.status_code == 200
    body = resp.json()
    assert "providers" in body
    providers = body["providers"]
    ids = [p["id"] for p in providers]
    # 至少包含核心 provider
    assert "openai" in ids
    assert "anthropic" in ids
    assert "deepseek" in ids
    assert "google" in ids
    assert "openrouter" in ids
    assert "ollama" in ids
    # 每个 provider 必要字段
    for p in providers:
        assert "label" in p
        assert "models" in p
        assert isinstance(p["models"], list)
        assert "context_window" in p
        assert p["context_window"] > 0


def test_list_providers_count_consistent():
    """多次调用应稳定返回相同结构。"""
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    r1 = client.get("/providers").json()["providers"]
    r2 = client.get("/providers").json()["providers"]
    assert len(r1) == len(r2)
```

- [ ] **Step 2: Write tool_stats test**

```python
"""Tests for api/routes/tool_stats.py — GET /tools."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.tool_stats import _BUILTIN_TOOLS, _CUSTOM_TOOLS, router


def test_list_tools_returns_builtin_plus_custom():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/tools")
    assert resp.status_code == 200
    tools = resp.json()
    assert isinstance(tools, list)
    assert len(tools) == len(_BUILTIN_TOOLS) + len(_CUSTOM_TOOLS)
    # builtin 工具在前
    names = [t["name"] for t in tools]
    assert names[: len(_BUILTIN_TOOLS)] == [t["name"] for t in _BUILTIN_TOOLS]
    assert names[len(_BUILTIN_TOOLS):] == [t["name"] for t in _CUSTOM_TOOLS]


def test_list_tools_schema_fields():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    for tool in client.get("/tools").json():
        assert {"name", "label", "description", "category", "builtin"} <= set(tool.keys())
        assert isinstance(tool["builtin"], bool)


def test_list_tools_has_known_categories():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    cats = {t["category"] for t in client.get("/tools").json()}
    # 已知核心类别
    assert {"file", "code", "web", "memory", "config"} <= cats
```

- [ ] **Step 3: Run tests, verify pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_providers_routes.py tests/test_api/test_tool_stats_routes.py -v`
Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_providers_routes.py tests/test_api/test_tool_stats_routes.py
git commit -m "test: cover providers and tool_stats route bodies (80%/86% -> 100%)"
```

---

## Task 3: api/errors.py coverage (87% → 100%)

**Files:**
- Create: `tests/test_api/test_errors.py`

Uncovered: 64 (trace_id branch), 77 (user_error), 83 (tool_error), 89-92 (rate_limit/cancelled/system_error), 113 (format_ws_error body).

- [ ] **Step 1: Write test file**

```python
"""Tests for api/errors.py — AppError, ErrorCode, make_error, format_ws_error."""

import pytest

from api.errors import AppError, ErrorCode, format_ws_error, make_error


class TestAppErrorToDict:
    def test_basic_to_dict_without_optional_fields(self):
        err = AppError(code=ErrorCode.INTERNAL_ERROR, message="boom")
        d = err.to_dict()
        assert d["code"] == "INTERNAL_ERROR"
        assert d["message"] == "boom"
        assert d["category"] == "system_error"
        # details / trace_id 未设置 → 不出现
        assert "details" not in d
        assert "trace_id" not in d

    def test_to_dict_with_details(self):
        err = AppError(code=ErrorCode.INTERNAL_ERROR, message="boom",
                       details={"k": "v"})
        assert err.to_dict()["details"] == {"k": "v"}

    def test_to_dict_with_trace_id(self):
        """覆盖 line 64: trace_id 分支。"""
        err = AppError(code=ErrorCode.INTERNAL_ERROR, message="boom",
                       trace_id="trace-abc")
        assert err.to_dict()["trace_id"] == "trace-abc"

    def test_to_dict_with_string_code(self):
        """code 传入字符串时也能正常转换。"""
        err = AppError(code="INTERNAL_ERROR", message="boom")
        d = err.to_dict()
        assert d["code"] == "INTERNAL_ERROR"


class TestCategoryProperty:
    @pytest.mark.parametrize("code,expected", [
        (ErrorCode.INVALID_INPUT, "user_error"),
        (ErrorCode.PATH_BLOCKED, "user_error"),
        (ErrorCode.PATH_NOT_WHITELISTED, "user_error"),
        (ErrorCode.MISSING_PARAMETER, "user_error"),
        (ErrorCode.TOOL_ERROR, "tool_error"),
        (ErrorCode.TOOL_TIMEOUT, "tool_error"),
        (ErrorCode.TOOL_NOT_FOUND, "tool_error"),
        (ErrorCode.RATE_LIMITED, "rate_limit"),
        (ErrorCode.QUOTA_EXCEEDED, "rate_limit"),
        (ErrorCode.CANCELLED, "cancelled"),
        # 其余归 system_error
        (ErrorCode.INTERNAL_ERROR, "system_error"),
        (ErrorCode.LLM_ERROR, "system_error"),
        (ErrorCode.DATABASE_ERROR, "system_error"),
        (ErrorCode.SESSION_NOT_FOUND, "system_error"),
        (ErrorCode.SESSION_EXPIRED, "system_error"),
        (ErrorCode.UNAUTHORIZED, "system_error"),
        (ErrorCode.TOKEN_EXPIRED, "system_error"),
        (ErrorCode.NO_LLM, "system_error"),
        (ErrorCode.AGENT_ERROR, "system_error"),
    ])
    def test_category_branches(self, code, expected):
        err = AppError(code=code, message="x")
        assert err.category == expected

    def test_category_with_raw_string_code(self):
        """code 是 str（非 Enum）时也应正确分类。"""
        err = AppError(code="RATE_LIMITED", message="x")
        assert err.category == "rate_limit"
        err2 = AppError(code="CANCELLED", message="x")
        assert err2.category == "cancelled"
        err3 = AppError(code="TOOL_ERROR", message="x")
        assert err3.category == "tool_error"


class TestMakeError:
    def test_make_error_with_enum_code(self):
        d = make_error(ErrorCode.PATH_BLOCKED, "blocked",
                       details={"path": "/etc"}, trace_id="t1")
        assert d["code"] == "PATH_BLOCKED"
        assert d["message"] == "blocked"
        assert d["category"] == "user_error"
        assert d["details"] == {"path": "/etc"}
        assert d["trace_id"] == "t1"

    def test_make_error_with_string_code(self):
        d = make_error("TOOL_TIMEOUT", "timed out")
        assert d["code"] == "TOOL_TIMEOUT"
        assert d["category"] == "tool_error"
        assert "details" not in d
        assert "trace_id" not in d

    def test_make_error_invalid_string_code_raises(self):
        with pytest.raises(ValueError):
            make_error("NOT_A_REAL_CODE", "x")


class TestFormatWsError:
    def test_format_ws_error_shape(self):
        """覆盖 line 113: format_ws_error 函数体。"""
        ev = format_ws_error(ErrorCode.RATE_LIMITED, "slow down",
                             details={"retry_after": 5})
        assert ev["type"] == "error"
        payload = ev["payload"]
        assert payload["code"] == "RATE_LIMITED"
        assert payload["message"] == "slow down"
        assert payload["category"] == "rate_limit"
        assert payload["details"] == {"retry_after": 5}

    def test_format_ws_error_with_string_code_and_trace_id(self):
        ev = format_ws_error("CANCELLED", "aborted", trace_id="t-99")
        assert ev["type"] == "error"
        assert ev["payload"]["code"] == "CANCELLED"
        assert ev["payload"]["category"] == "cancelled"
        assert ev["payload"]["trace_id"] == "t-99"

    def test_format_ws_error_minimal(self):
        ev = format_ws_error(ErrorCode.INTERNAL_ERROR, "boom")
        assert ev == {
            "type": "error",
            "payload": {
                "code": "INTERNAL_ERROR",
                "message": "boom",
                "category": "system_error",
            },
        }
```

- [ ] **Step 2: Run tests, verify pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_errors.py -v`
Expected: all passed.

- [ ] **Step 3: Verify coverage**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_errors.py --cov=api.errors --cov-report=term-missing -q`
Expected: 100%.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_errors.py
git commit -m "test: cover api/errors.py to 100% (category branches, format_ws_error)"
```

---

## Task 4: api/activity_hub.py coverage (82% → 95%+)

**Files:**
- Create: `tests/test_api/test_activity_hub.py`

Uncovered: 117-125 (`rehydrate_orphans`), 129-131 (`list_by_session`), 135-141 (`clear_by_session`).

- [ ] **Step 1: Write test file**

```python
"""Tests for api/activity_hub.py — rehydrate_orphans, list_by_session,
clear_by_session, singleton behavior."""

import threading

import pytest

from api.activity_hub import ActivityHub, ActivityRecord, activity_hub


@pytest.fixture(autouse=True)
def _reset_hub():
    """每个测试前后清空全局 hub。"""
    activity_hub.clear()
    yield
    activity_hub.clear()


class TestSingleton:
    def test_get_returns_singleton(self):
        a = ActivityHub.get()
        b = ActivityHub.get()
        assert a is b
        assert a is activity_hub

    def test_get_thread_safe_concurrent(self):
        """并发调用 get() 也只创建一个实例。"""
        ActivityHub._instance = None  # 强制重建
        results = []

        def worker():
            results.append(ActivityHub.get())

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        # 所有线程拿到同一实例
        assert all(r is results[0] for r in results)
        # 清理：恢复全局单例
        ActivityHub._instance = results[0]


class TestListBySession:
    def test_list_by_session_empty(self):
        assert activity_hub.list_by_session("s1") == []

    def test_list_by_session_filters(self):
        """覆盖 lines 129-131。"""
        activity_hub.add("turn", "t1", session_id="s1", message="a")
        activity_hub.add("turn", "t2", session_id="s2", message="b")
        activity_hub.add("turn", "t3", session_id="s1", message="c")
        records = activity_hub.list_by_session("s1")
        assert len(records) == 2
        assert all(r.session_id == "s1" for r in records)
        # 按 append 顺序
        assert [r.event_type for r in records] == ["t1", "t3"]

    def test_list_by_session_limit(self):
        for i in range(5):
            activity_hub.add("turn", f"t{i}", session_id="s1")
        records = activity_hub.list_by_session("s1", limit=2)
        assert len(records) == 2
        # 返回最后 2 条
        assert [r.event_type for r in records] == ["t3", "t4"]

    def test_list_by_session_excludes_other_sessions(self):
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.add("turn", "t2", session_id="s2")
        activity_hub.add("tool", "tool1", session_id="s3")
        assert activity_hub.list_by_session("s1") == [activity_hub.recent()[-3]]


class TestClearBySession:
    def test_clear_by_session_no_match_returns_zero(self):
        """覆盖 lines 135-141。"""
        activity_hub.add("turn", "t1", session_id="s1")
        count = activity_hub.clear_by_session("nonexistent")
        assert count == 0
        # 原记录仍在
        assert len(activity_hub.recent()) == 1

    def test_clear_by_session_removes_only_matching(self):
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.add("turn", "t2", session_id="s2")
        activity_hub.add("turn", "t3", session_id="s1")
        count = activity_hub.clear_by_session("s1")
        assert count == 2
        remaining = activity_hub.recent()
        assert len(remaining) == 1
        assert remaining[0].session_id == "s2"

    def test_clear_by_session_all(self):
        for i in range(3):
            activity_hub.add("turn", f"t{i}", session_id="sx")
        assert activity_hub.clear_by_session("sx") == 3
        assert activity_hub.recent() == []

    def test_clear_by_session_preserves_maxlen(self):
        """清除后 deque 的 maxlen 仍应保留。"""
        activity_hub.add("turn", "t1", session_id="s1")
        activity_hub.clear_by_session("s1")
        # 仍能添加新记录
        for i in range(ActivityHub.MAX_IN_MEMORY + 10):
            activity_hub.add("turn", f"t{i}", session_id="s1")
        assert len(activity_hub.recent()) == ActivityHub.MAX_IN_MEMORY


class TestRehydrateOrphans:
    def test_rehydrate_orphans_empty_returns_zero(self):
        """覆盖 lines 117-125: 空缓冲区返回 0。"""
        assert activity_hub.rehydrate_orphans() == 0

    def test_rehydrate_orphans_with_records_returns_zero(self):
        """当前实现是 no-op 占位，always returns 0；验证不抛异常。"""
        activity_hub.add("turn", "t1", session_id="s1", message="running task")
        activity_hub.add("tool", "tool_end", message="done")
        # 当前实现不会实际修改记录，只返回 0
        count = activity_hub.rehydrate_orphans()
        assert count == 0
        # 记录未被清除
        assert len(activity_hub.recent()) == 2

    def test_rehydrate_orphans_message_with_running(self):
        """message 含 'running' 的记录进入启发式分支但不修改。"""
        activity_hub.add("tool", "tool_start", message="bash is running",
                         level="info")
        activity_hub.add("tool", "tool_start", message="idle", level="info")
        # 不抛异常即可
        assert activity_hub.rehydrate_orphans() == 0
        assert len(activity_hub.recent()) == 2
```

- [ ] **Step 2: Run tests, verify pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_activity_hub.py -v`
Expected: all passed.

- [ ] **Step 3: Verify coverage**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_activity_hub.py tests/test_api/test_activity_routes.py --cov=api.activity_hub --cov-report=term-missing -q`
Expected: ≥ 95%.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_activity_hub.py
git commit -m "test: cover activity_hub list_by_session/clear_by_session/rehydrate_orphans (82% -> 95%+)"
```

---

## Task 5: api/routes/files.py DPI scaling branch (85% → 95%+, DPI awareness ctypes fallback skipped)

**Files:**
- Create: `tests/test_api/test_files_dpi_scaling.py`

Uncovered: 45-49 (Windows DPI awareness ctypes fallback — skip per task hint), 58-59 (tk.call scaling exception handler — coverable).

- [ ] **Step 1: Write test file**

```python
"""Tests for api/routes/files.py — DPI scaling exception branch (lines 58-59).

Lines 45-49 (Windows DPI awareness ctypes nested fallback) intentionally not
covered per task scope hint.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from api.routes.files import select_file


def _tkinter_available() -> bool:
    try:
        import tkinter  # noqa: F401
        return True
    except ImportError:
        return False


@pytest.mark.asyncio
async def test_dpi_scaling_exception_is_swallowed(monkeypatch):
    """覆盖 lines 58-59: tk.call('tk', 'scaling', ...) 抛异常时应被
    except 捕获并 logger.debug，不影响后续逻辑。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    fake_root = MagicMock()
    # winfo_fpixels 抛异常 → 进入 except 分支 (line 58-59)
    fake_root.winfo_fpixels.side_effect = RuntimeError("no display")
    # 后续 attributes 仍可调用
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/foo.txt"
    ):
        result = await select_file()

    # 即使 DPI scaling 失败，对话框逻辑仍应正常返回
    assert result == {"path": "/tmp/foo.txt"}
    # 验证 winfo_fpixels 被调用过（确认走到了 except 分支）
    assert fake_root.winfo_fpixels.called
    # destroy 被调用
    fake_root.destroy.assert_called_once()


@pytest.mark.asyncio
async def test_dpi_scaling_succeeds_for_comparison(monkeypatch):
    """对照测试：DPI scaling 成功路径不抛异常。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    fake_root = MagicMock()
    fake_root.winfo_fpixels.return_value = 96.0  # 1 inch = 96 px
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/bar.txt"
    ):
        result = await select_file()

    assert result == {"path": "/tmp/bar.txt"}
    # tk.call 应被调用以设置 scaling
    fake_root.tk.call.assert_called()
    fake_root.destroy.assert_called_once()
```

- [ ] **Step 2: Run tests, verify pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_files_dpi_scaling.py -v`
Expected: 2 passed.

- [ ] **Step 3: Verify coverage**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_files.py tests/test_api/test_files_extra.py tests/test_api/test_files_dpi_scaling.py --cov=api.routes.files --cov-report=term-missing -q`
Expected: ≥ 90% (lines 45-49 intentionally left).

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_files_dpi_scaling.py
git commit -m "test: cover files.py DPI scaling exception branch (85% -> 90%+)"
```

---

## Task 6: Final coverage measurement & ruff check

- [ ] **Step 1: Full coverage measurement**

Run:
```
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/ --cov=api --cov=agent --cov-report=term -q
```

Expected:
- Each of the 6 target modules ≥ 95% (except files.py which may sit around 90% with DPI ctypes fallback skipped).
- Overall ≥ 98%.

- [ ] **Step 2: Ruff check on new test files**

Run:
```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
```

Expected: no errors in newly added files.

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "test: final coverage cleanup for remaining routes"
```

---

## Self-Review Checklist

- [ ] All 6 modules have new test files.
- [ ] No source files modified (only new test files created).
- [ ] Each task ends with a commit.
- [ ] Overall coverage target met.
- [ ] Ruff passes on new tests.
- [ ] No conflicts with other agents' file scopes (persona.py, sessions.py, sticker_favorites.py, upload.py, event_hooks.py, web/, bun-sidecar/, pyproject.toml, requirements-lock.txt untouched).
