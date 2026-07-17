"""Coverage push tests for api/const_session_store.py.

Targets previously uncovered lines:
- Lines 80-82: except Exception in load_const_session → return None
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from api import const_session_store as cs_mod
from api.const_session_store import load_const_session


def test_load_const_session_returns_none_on_exception(tmp_path, monkeypatch):
    """Lines 80-82: if an exception is raised inside load_const_session
    (e.g. yaml_file_lock raises), the function catches it and returns None."""
    filepath = tmp_path / "session.yaml"
    filepath.write_text("valid: yaml", encoding="utf-8")

    # Patch yaml_file_lock in the const_session_store module to raise Exception
    def _lock_boom(path, *args, **kwargs):
        raise RuntimeError("lock exploded")

    monkeypatch.setattr(cs_mod, "yaml_file_lock", _lock_boom)

    result = load_const_session(filepath)
    assert result is None
