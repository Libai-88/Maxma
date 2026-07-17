"""Coverage push tests for api/yaml_store.py error paths.

Targets previously uncovered lines:
- Line 93: os.unlink(tmp_name) in dump_yaml_atomic finally (os.replace failure)
- Lines 117-118: except FileExistsError → return False in dump_yaml_backup_once
- Lines 122-123: except OSError on os.chmod → pass
- Line 127: os.unlink(tmp_name) in dump_yaml_backup_once finally (FileExistsError path)
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from api.yaml_store import dump_yaml_atomic, dump_yaml_backup_once


def test_dump_yaml_atomic_cleans_tmp_on_replace_failure(tmp_path, monkeypatch):
    """Line 93: when os.replace fails, the tmp file is cleaned up in finally."""
    target = tmp_path / "out.yaml"

    real_replace = os.replace

    def _replace_fail(src, dst):
        raise OSError("replace denied")

    monkeypatch.setattr(os, "replace", _replace_fail)

    with pytest.raises(OSError):
        dump_yaml_atomic(target, {"a": 1})

    # The tmp file should have been cleaned up by the finally block (line 93)
    tmps = list(tmp_path.glob(".*.tmp"))
    assert tmps == []


def test_dump_yaml_backup_once_returns_false_on_link_exists(tmp_path, monkeypatch):
    """Lines 117-118 + 127: when os.link raises FileExistsError (race condition),
    the function returns False and the tmp file is cleaned in finally."""
    backup = tmp_path / "backup.yaml"

    real_link = os.link

    def _link_raises_exists(src, dst):
        raise FileExistsError("backup already exists")

    monkeypatch.setattr(os, "link", _link_raises_exists)

    result = dump_yaml_backup_once(backup, {"v": 1})
    assert result is False

    # Tmp file cleaned up by finally (line 127)
    tmps = list(tmp_path.glob(".*.tmp"))
    assert tmps == []
    # Backup file was NOT created (link failed)
    assert not backup.exists()


def test_dump_yaml_backup_once_chmod_oserror_swallowed(tmp_path, monkeypatch):
    """Lines 122-123: when os.chmod raises OSError, it is silently swallowed
    and the function returns True."""
    backup = tmp_path / "backup.yaml"

    real_chmod = os.chmod

    def _chmod_raises(path, mode):
        raise OSError("chmod denied")

    monkeypatch.setattr(os, "chmod", _chmod_raises)

    result = dump_yaml_backup_once(backup, {"v": 1})
    assert result is True
    # Backup file was created successfully (chmod failure doesn't prevent return True)
    assert backup.exists()
