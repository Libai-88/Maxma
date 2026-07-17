"""Tests for api/routes/files.py — DPI awareness + scaling branches.

Covers:
- lines 45-49: Windows DPI awareness ctypes fallback chain (shcore -> user -> pass)
- lines 58-59: tk.call('tk', 'scaling', ...) exception handler
"""

import sys
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


@pytest.mark.asyncio
async def test_dpi_awareness_shcore_oserror_falls_back_to_user(monkeypatch):
    """覆盖 lines 45-49: shcore.SetProcessDpiAwareness 抛 OSError 时，
    回退到 user.SetProcessDPIAware（成功路径）。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")
    if sys.platform != "win32":
        pytest.skip("Windows-specific DPI awareness test")

    import ctypes

    fake_windll = MagicMock()
    # shcore 失败 → 进入第一个 except 分支
    fake_windll.shcore.SetProcessDpiAwareness.side_effect = OSError("shcore fail")
    # user 成功 → 不进入第二个 except (line 49 pass 不被覆盖)
    fake_windll.user.SetProcessDPIAware.return_value = None
    monkeypatch.setattr(ctypes, "windll", fake_windll)

    fake_root = MagicMock()
    fake_root.winfo_fpixels.return_value = 96.0
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/a.txt"
    ):
        result = await select_file()

    assert result == {"path": "/tmp/a.txt"}
    fake_windll.shcore.SetProcessDpiAwareness.assert_called_once_with(1)
    fake_windll.user.SetProcessDPIAware.assert_called_once_with()


@pytest.mark.asyncio
async def test_dpi_awareness_shcore_attrerror_falls_back_to_user(monkeypatch):
    """覆盖 line 45 第一个 except 分支的 AttributeError 情况。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")
    if sys.platform != "win32":
        pytest.skip("Windows-specific DPI awareness test")

    import ctypes

    fake_windll = MagicMock()
    # shcore 属性不存在 → AttributeError
    fake_windll.shcore.SetProcessDpiAwareness.side_effect = AttributeError("no shcore")
    fake_windll.user.SetProcessDPIAware.return_value = None
    monkeypatch.setattr(ctypes, "windll", fake_windll)

    fake_root = MagicMock()
    fake_root.winfo_fpixels.return_value = 96.0
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/b.txt"
    ):
        result = await select_file()

    assert result == {"path": "/tmp/b.txt"}
    fake_windll.user.SetProcessDPIAware.assert_called_once_with()


@pytest.mark.asyncio
async def test_dpi_awareness_both_fallbacks_fail_silently(monkeypatch):
    """覆盖 lines 47-49: 两个 fallback 都失败时，inner except 静默 pass。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")
    if sys.platform != "win32":
        pytest.skip("Windows-specific DPI awareness test")

    import ctypes

    fake_windll = MagicMock()
    # shcore 抛 OSError → 进入第一个 except
    fake_windll.shcore.SetProcessDpiAwareness.side_effect = OSError("shcore fail")
    # user 也抛 OSError → 进入第二个 except 的 pass（line 49）
    fake_windll.user.SetProcessDPIAware.side_effect = OSError("user fail")
    monkeypatch.setattr(ctypes, "windll", fake_windll)

    fake_root = MagicMock()
    fake_root.winfo_fpixels.return_value = 96.0
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/c.txt"
    ):
        # 两个 fallback 都失败也不抛异常（静默 pass）
        result = await select_file()

    assert result == {"path": "/tmp/c.txt"}
    fake_windll.shcore.SetProcessDpiAwareness.assert_called_once_with(1)
    fake_windll.user.SetProcessDPIAware.assert_called_once_with()


@pytest.mark.asyncio
async def test_dpi_awareness_user_attrerror_silently_passes(monkeypatch):
    """覆盖 line 49: user.SetProcessDPIAware 抛 AttributeError 时静默 pass。"""
    monkeypatch.setenv("MAXMA_ENV", "development")
    if not _tkinter_available():
        pytest.skip("tkinter not available")
    if sys.platform != "win32":
        pytest.skip("Windows-specific DPI awareness test")

    import ctypes

    fake_windll = MagicMock()
    fake_windll.shcore.SetProcessDpiAwareness.side_effect = OSError("shcore fail")
    # user 抛 AttributeError → 第二个 except 分支
    fake_windll.user.SetProcessDPIAware.side_effect = AttributeError("no user")
    monkeypatch.setattr(ctypes, "windll", fake_windll)

    fake_root = MagicMock()
    fake_root.winfo_fpixels.return_value = 96.0
    fake_root.attributes.return_value = None
    fake_root.tk = MagicMock()

    with patch("tkinter.Tk", return_value=fake_root), patch(
        "tkinter.filedialog.askopenfilename", return_value="/tmp/d.txt"
    ):
        result = await select_file()

    assert result == {"path": "/tmp/d.txt"}
