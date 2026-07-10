"""Regression tests for the local platform-primitives package name."""

from pathlib import Path

import platform


def test_stdlib_platform_is_not_shadowed() -> None:
    """The project package must never replace Python's standard-library module."""
    assert not hasattr(platform, "__path__")
    assert Path(platform.__file__).name == "platform.py"
