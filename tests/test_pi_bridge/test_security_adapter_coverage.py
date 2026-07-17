"""Coverage boost for api.pi_bridge.security_adapter.

Targets uncovered lines: check_tool_security (31-46), _extract_paths (51-63),
_load_whitelist (72-81), resolve-failure branches (101-103, 108-109, 147-149).

Does NOT modify the existing test_security_adapter.py.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from api.pi_bridge import security_adapter


# ── _extract_paths ─────────────────────────────────────────


class TestExtractPaths:
    """_extract_paths dispatches by tool_name to pull path/pattern from args."""

    def test_read_extracts_path(self) -> None:
        result = security_adapter._extract_paths("read", {"path": "/a/b.txt"})
        assert result == ["/a/b.txt"]

    def test_read_missing_path_key_returns_empty_string(self) -> None:
        result = security_adapter._extract_paths("read", {})
        assert result == [""]

    def test_write_extracts_path(self) -> None:
        result = security_adapter._extract_paths("write", {"path": "/x/y"})
        assert result == ["/x/y"]

    def test_edit_extracts_path(self) -> None:
        result = security_adapter._extract_paths("edit", {"path": "/e.txt"})
        assert result == ["/e.txt"]

    def test_glob_extracts_pattern(self) -> None:
        result = security_adapter._extract_paths("glob", {"pattern": "*.py"})
        assert result == ["*.py"]

    def test_glob_missing_pattern_returns_empty_string(self) -> None:
        result = security_adapter._extract_paths("glob", {})
        assert result == [""]

    def test_bash_returns_empty_list(self) -> None:
        result = security_adapter._extract_paths("bash", {"command": "ls -la"})
        assert result == []

    def test_bash_missing_command_still_empty(self) -> None:
        result = security_adapter._extract_paths("bash", {})
        assert result == []

    def test_unknown_tool_returns_empty_list(self) -> None:
        result = security_adapter._extract_paths("mystery", {"path": "/x"})
        assert result == []


# ── check_tool_security ────────────────────────────────────


class TestCheckToolSecurity:
    """check_tool_security(tool_name, tool_args) -> str | None (None=allow)."""

    def test_read_allowed_path_returns_none(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "file.txt"
        target.write_text("ok", encoding="utf-8")
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("read", {"path": str(target)})
        assert result is None

    def test_read_blocked_path_returns_reason(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("read", {"path": str(outside)})
        assert result is not None
        assert "白名单" in result

    def test_read_path_with_blocker_returns_blocker_reason(
        self, tmp_path, monkeypatch
    ) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: True)
        result = security_adapter.check_tool_security(
            "read", {"path": str(allowed)}
        )
        assert result is not None
        assert "MaxmaBlocker" in result

    def test_empty_path_skipped_returns_none(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": ""})
        assert result is None

    def test_none_path_skipped_returns_none(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": None})
        assert result is None

    def test_non_string_path_skipped(self, monkeypatch) -> None:
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        result = security_adapter.check_tool_security("read", {"path": 12345})
        assert result is None

    def test_write_tool_blocked(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("write", {"path": str(outside)})
        assert result is not None

    def test_edit_tool_allowed(self, tmp_path, monkeypatch) -> None:
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "e.txt"
        target.write_text("x", encoding="utf-8")
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security("edit", {"path": str(target)})
        assert result is None

    def test_glob_tool_blocked_pattern_resolves_outside(
        self, tmp_path, monkeypatch
    ) -> None:
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [(str(allowed), True)]
        )
        monkeypatch.setattr(security_adapter, "_is_blocker_present", lambda _p: False)
        result = security_adapter.check_tool_security(
            "glob", {"pattern": str(outside / "*.txt")}
        )
        assert result is not None

    def test_bash_tool_returns_none_no_path_check(self, monkeypatch) -> None:
        # bash extracts no paths; must return None without touching whitelist
        call_count = {"n": 0}

        def _fail_if_called(*_a, **_k):
            call_count["n"] += 1
            return [("/never", True)]

        monkeypatch.setattr(security_adapter, "_load_whitelist", _fail_if_called)
        result = security_adapter.check_tool_security("bash", {"command": "ls"})
        assert result is None
        assert call_count["n"] == 0
