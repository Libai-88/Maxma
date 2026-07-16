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
