"""Coverage push tests for api/routes/diagnostics.py cleanup_old_log_files.

Targets previously uncovered lines:
- Line 98: skip non-file entries (directories)
- Lines 117-118: OSError on entry.stat() → size = 0
- Lines 129-130: OSError/PermissionError on entry.unlink() → log warning
- Lines 139-141: outer Exception handler → error response
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import diagnostics as diag_mod
from api.diagnostics import error_collector
from api.routes import diagnostics as routes_diag
from api.routes.diagnostics import router


@pytest.fixture(autouse=True)
def reset_collector():
    error_collector.clear()
    yield
    error_collector.clear()


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    monkeypatch.setattr(routes_diag, "LOGS_DIR", logs_dir)
    monkeypatch.setattr(diag_mod, "LOGS_DIR", logs_dir)
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "logs_dir": logs_dir}


def test_cleanup_skips_directory_entries(isolated_env):
    """Line 98: a subdirectory inside LOGS_DIR is skipped by is_file() check."""
    d = isolated_env["logs_dir"]
    # Create a subdirectory (should be skipped, not deleted)
    subdir = d / "subdir"
    subdir.mkdir()
    # Create a rotation file that should be deleted
    rot = d / "maxma.log.1"
    rot.write_bytes(b"x" * 10)

    resp = isolated_env["client"].delete("/diagnostics/logs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["deleted_count"] == 1
    # Subdir still exists (was skipped)
    assert subdir.exists()
    # Rotation file deleted
    assert not rot.exists()


def test_cleanup_stat_oserror_sets_zero_size(isolated_env, monkeypatch):
    """Lines 117-118: if entry.stat() raises OSError, size falls back to 0.

    Python 3.14+ changed Path.is_file() to call os.path.isfile() directly
    instead of self.stat(). We monkeypatch Path.is_file to return True
    unconditionally and Path.stat to raise OSError so the test works across
    all Python versions.
    """
    d = isolated_env["logs_dir"]
    rot = d / "maxma.log.1"
    rot.write_bytes(b"data")

    # Ensure is_file() returns True regardless of Python version
    monkeypatch.setattr(Path, "is_file", lambda self: True)

    # Make Path.stat raise OSError for our target file
    real_stat = Path.stat

    def _stat_raising(self, *args, **kwargs):
        if self.name == "maxma.log.1":
            raise OSError("stat denied")
        return real_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", _stat_raising)

    resp = isolated_env["client"].delete("/diagnostics/logs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # File was deleted despite stat error
    assert body["deleted_count"] == 1
    # Size was 0 due to OSError
    assert body["deleted_files"][0]["size_bytes"] == 0


def test_cleanup_unlink_failure_logs_warning(isolated_env, monkeypatch):
    """Lines 129-130: if entry.unlink() raises PermissionError, the file is
    skipped and a warning is logged (not in deleted_files)."""
    d = isolated_env["logs_dir"]
    rot = d / "maxma.log.1"
    rot.write_bytes(b"data")

    real_unlink = Path.unlink

    def _unlink_raising(self, *args, **kwargs):
        if self.name == "maxma.log.1":
            raise PermissionError("unlink denied")
        return real_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", _unlink_raising)

    resp = isolated_env["client"].delete("/diagnostics/logs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # File could not be deleted
    assert body["deleted_count"] == 0
    assert body["deleted_files"] == []
    # File still exists
    assert rot.exists()


def test_cleanup_outer_exception_returns_error(isolated_env, monkeypatch):
    """Lines 139-141: a non-OSError exception from the cleanup body is caught
    by the outer except and returns an error response."""
    d = isolated_env["logs_dir"]
    rot = d / "maxma.log.1"
    rot.write_bytes(b"data")

    real_iterdir = Path.iterdir
    target_dir = d

    def _iterdir_boom(self):
        if self == target_dir:
            raise RuntimeError("iterdir crashed")
        return real_iterdir(self)

    monkeypatch.setattr(Path, "iterdir", _iterdir_boom)

    resp = isolated_env["client"].delete("/diagnostics/logs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert "iterdir crashed" in body["error"]
