"""Tests for api/routes/files.py — folder dialog, ImportError, exception paths."""

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
async def test_select_folder_success(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    with patch("tkinter.Tk", return_value=MagicMock()), patch(
        "tkinter.filedialog.askdirectory", return_value="/tmp/myfolder"
    ):
        result = await select_file(type="folder")
    assert result == {"path": "/tmp/myfolder"}


@pytest.mark.asyncio
async def test_select_file_returns_none_path(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    # askopenfilename returns "" -> path None
    with patch("tkinter.Tk", return_value=MagicMock()), patch(
        "tkinter.filedialog.askopenfilename", return_value=""
    ):
        result = await select_file()
    assert result == {"path": None}


@pytest.mark.asyncio
async def test_select_file_import_error(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    # Force tkinter import to fail by poisoning sys.modules entry.
    # `import tkinter` checks sys.modules first; a None value raises ImportError.
    import sys
    monkeypatch.setitem(sys.modules, "tkinter", None)
    with pytest.raises(HTTPException) as exc_info:
        await select_file()
    assert exc_info.value.status_code == 500
    assert "tkinter 不可用" in exc_info.value.detail


@pytest.mark.asyncio
async def test_select_file_generic_exception(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    # Tk() raises a generic exception (not ImportError) -> caught by outer except
    with patch("tkinter.Tk", side_effect=RuntimeError("boom")):
        with pytest.raises(HTTPException) as exc_info:
            await select_file()
    assert exc_info.value.status_code == 500
    assert "打开文件对话框失败" in exc_info.value.detail


@pytest.mark.asyncio
async def test_select_folder_returns_none_path(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")

    # askdirectory returns "" -> path None
    with patch("tkinter.Tk", return_value=MagicMock()), patch(
        "tkinter.filedialog.askdirectory", return_value=""
    ):
        result = await select_file(type="folder")
    assert result == {"path": None}


@pytest.mark.asyncio
async def test_select_file_blocked_in_production(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "production")
    with pytest.raises(HTTPException) as exc_info:
        await select_file()
    assert exc_info.value.status_code == 403
    assert "本地开发" in exc_info.value.detail
