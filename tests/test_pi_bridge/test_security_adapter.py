"""Unit tests for api.pi_bridge.security_adapter — path whitelist & MaxmaBlocker enforcement.

These tests verify that the security checks actually enforce (not stubs).
"""

from pathlib import Path
from unittest.mock import patch

import pytest

from api.pi_bridge import security_adapter


# ── check_path_access ───────────────────────────────────────


class TestCheckPathAccess:
    """check_path_access(path) -> str | None. None = allowed, str = block reason."""

    def test_empty_path_blocked(self):
        result = security_adapter.check_path_access("")
        assert result is not None

    def test_empty_whitelist_blocks_all(self, tmp_path, monkeypatch):
        """Empty whitelist must fail-secure (block everything)."""
        monkeypatch.setattr(security_adapter, "_load_whitelist", lambda: [])
        result = security_adapter.check_path_access(str(tmp_path))
        assert result is not None
        assert "白名单" in result

    def test_exact_match_allowed(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        assert security_adapter.check_path_access(str(allowed)) is None

    def test_recursive_child_allowed(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        assert security_adapter.check_path_access(str(child)) is None

    def test_non_recursive_blocks_child(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), False)]
        )
        result = security_adapter.check_path_access(str(child))
        assert result is not None

    def test_non_recursive_allows_exact(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), False)]
        )
        assert security_adapter.check_path_access(str(allowed)) is None

    def test_non_whitelisted_path_blocked(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        result = security_adapter.check_path_access(str(other))
        assert result is not None
        assert "白名单" in result

    def test_symlink_to_outside_blocked(self, tmp_path, monkeypatch):
        """Symlink under allowed dir pointing outside must be blocked."""
        import os
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        (outside / "secret.txt").write_text("secret", encoding="utf-8")
        try:
            os.symlink(outside, allowed / "link", target_is_directory=True)
        except (OSError, NotImplementedError):
            pytest.skip("symlinks unavailable on this host")

        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        result = security_adapter.check_path_access(str(allowed / "link" / "secret.txt"))
        assert result is not None


# ── _is_blocker_present / _find_blocker_path ────────────────


class TestIsBlockerPresent:
    """_is_blocker_present(path) -> bool. _find_blocker_path(path) -> str | None."""

    def test_no_blocker_returns_false(self, tmp_path):
        target = tmp_path / "clean"
        target.mkdir()
        assert security_adapter._is_blocker_present(str(target)) is False

    def test_blocker_in_target_dir_detected(self, tmp_path):
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        assert security_adapter._is_blocker_present(str(target)) is True

    def test_blocker_in_parent_detected(self, tmp_path):
        parent = tmp_path / "parent"
        child = parent / "child"
        child.mkdir(parents=True)
        (parent / ".maxma_blocker").write_text("", encoding="utf-8")
        assert security_adapter._is_blocker_present(str(child)) is True

    def test_find_blocker_returns_path(self, tmp_path):
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        result = security_adapter._find_blocker_path(str(target))
        assert result is not None
        assert Path(result).name == "blocked"

    def test_find_blocker_returns_none_when_clean(self, tmp_path):
        target = tmp_path / "clean"
        target.mkdir()
        assert security_adapter._find_blocker_path(str(target)) is None

    def test_malformed_path_fail_closed(self):
        """Resolve failure must fail-closed (block), not fail-open (allow)."""
        # NUL bytes in path cause OSError on Windows resolve
        result = security_adapter._is_blocker_present("foo\x00bar")
        assert result is True  # fail-closed: blocker "found"

    def test_malformed_path_find_returns_path(self):
        """_find_blocker_path on malformed path returns non-None (fail-closed)."""
        result = security_adapter._find_blocker_path("foo\x00bar")
        assert result is not None
