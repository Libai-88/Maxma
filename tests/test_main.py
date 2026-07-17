"""Tests for silent-except logging in main.py _start_parent_watchdog."""

import builtins
import importlib.util
import logging
import sys
from pathlib import Path

import pytest


def _load_main_module():
    """Load main.py fresh, bypassing sys.modules cache."""
    module_path = Path(__file__).resolve().parent.parent / "main.py"
    spec = importlib.util.spec_from_file_location("main_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(sys.platform != "win32", reason="Watchdog is Windows-only")
def test_watchdog_logs_warning_when_setup_fails(monkeypatch, caplog):
    """_start_parent_watchdog should log warning when setup fails, not silently pass."""
    # Load module first with real __import__ (so top-level imports succeed)
    main_module = _load_main_module()

    # Now mock __import__ to fail for ctypes — only affects import inside the function
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "ctypes":
            raise ImportError("mocked: ctypes unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    with caplog.at_level(logging.WARNING):
        main_module._start_parent_watchdog()

    assert any(
        "watchdog" in r.message.lower() or "父进程" in r.message or "安装" in r.message
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )
