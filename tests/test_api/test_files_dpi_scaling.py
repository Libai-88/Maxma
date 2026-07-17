"""Tests for api/routes/files.py — DPI scaling exception branch (lines 58-59).

Lines 45-49 (Windows DPI awareness ctypes nested fallback) intentionally not
covered per task scope hint (Windows-specific shcore/user32 fallback chain).
"""

from unittest.mock import MagicMock, patch

import pytest

from api.routes.files import select_file


def _tkinter_available() -> bool:
    try:
        import tkinter  # noqa: F401
        return True
    except ImportError:
        return False


@pytest.mark.asyncio
async def test_dpi_scaling_exception_is_swallowed(monkeypatch):
    """覆盖 lines 58-59: winfo_fpixels 抛异常时应被 except 捕获并
    logger.debug，不影响后续逻辑。"""
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
