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


# ── _load_whitelist ────────────────────────────────────────


class TestLoadWhitelist:
    """_load_whitelist reads PATH_WHITELIST_YAML_PATH; missing file => []."""

    def test_missing_file_returns_empty(self, tmp_path, monkeypatch) -> None:
        missing = tmp_path / "no_such.yaml"
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", missing)
        assert security_adapter._load_whitelist() == []

    def test_empty_yaml_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_valid_entries_with_recursive(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n"
            "  - path: /a\n"
            "  - path: /b\n"
            "    recursive: false\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/a", True), ("/b", False)]

    def test_default_recursive_is_true(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist:\n  - path: /x\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/x", True)]

    def test_non_dict_entries_skipped(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n  - 'just a string'\n  - 42\n  - path: /ok\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/ok", True)]

    def test_entry_without_path_key_skipped(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text(
            "whitelist:\n  - recursive: true\n  - path: /ok\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/ok", True)]

    def test_empty_whitelist_key_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist: []\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_missing_whitelist_key_returns_empty(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("other: data\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        assert security_adapter._load_whitelist() == []

    def test_unicode_path_preserved(self, tmp_path, monkeypatch) -> None:
        f = tmp_path / "wl.yaml"
        f.write_text("whitelist:\n  - path: /数据/中文\n", encoding="utf-8")
        monkeypatch.setattr(security_adapter, "PATH_WHITELIST_YAML_PATH", f)
        result = security_adapter._load_whitelist()
        assert result == [("/数据/中文", True)]


# ── check_path_access: resolve-failure branches ────────────


class TestCheckPathAccessResolveFailure:
    """Lines 101-103 (input path resolve fail) & 108-109 (whitelist entry resolve fail).

    On Python 3.13 Windows, Path(...).resolve(strict=False) tolerates NUL bytes,
    so we mock Path.resolve to force OSError/ValueError for the fail-closed branches.
    """

    def test_input_path_resolve_failure_fails_closed(self, monkeypatch) -> None:
        """Input path resolve failure -> fail-closed block with '解析失败' message."""
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        with patch.object(Path, "resolve", side_effect=OSError("mocked")):
            result = security_adapter.check_path_access("/some/path")
        assert result is not None
        assert "解析失败" in result

    def test_input_path_resolve_valueerror_fails_closed(self, monkeypatch) -> None:
        """ValueError from resolve is also caught -> fail-closed."""
        monkeypatch.setattr(
            security_adapter, "_load_whitelist", lambda: [("/tmp", True)]
        )
        with patch.object(Path, "resolve", side_effect=ValueError("mocked")):
            result = security_adapter.check_path_access("/some/path")
        assert result is not None
        assert "解析失败" in result

    def test_whitelist_entry_resolve_failure_skipped(self, tmp_path, monkeypatch) -> None:
        """A whitelist entry that fails to resolve is skipped (continue).
        The valid entry still matches the input path."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        real_resolve = Path.resolve

        def fake_resolve(self, strict=False):
            if "unresolvable" in str(self):
                raise OSError("mocked bad entry")
            return real_resolve(self, strict=strict)

        monkeypatch.setattr(
            security_adapter,
            "_load_whitelist",
            lambda: [("unresolvable_bad", True), (str(allowed), True)],
        )
        with patch.object(Path, "resolve", fake_resolve):
            result = security_adapter.check_path_access(str(allowed))
        assert result is None

    def test_all_whitelist_entries_unresolvable_blocks(self, monkeypatch) -> None:
        """If every whitelist entry fails to resolve, path is not matched -> blocked."""
        real_resolve = Path.resolve

        def fake_resolve(self, strict=False):
            if "unresolvable" in str(self):
                raise OSError("mocked")
            return real_resolve(self, strict=strict)

        monkeypatch.setattr(
            security_adapter,
            "_load_whitelist",
            lambda: [("unresolvable_a", True), ("unresolvable_b", False)],
        )
        with patch.object(Path, "resolve", fake_resolve):
            result = security_adapter.check_path_access("/some/valid/path")
        assert result is not None
        assert "白名单" in result


# ── _find_blocker_path: non-NUL resolve failure (147-149) ──


class TestFindBlockerResolveFailure:
    """Line 147-149: Path.resolve raises (non-NUL) -> fail-closed return path."""

    def test_resolve_oserror_fail_closed(self) -> None:
        """When resolve raises OSError (not NUL), _find_blocker_path returns the
        path string itself (fail-closed: treat as blocker present)."""
        with patch.object(
            Path, "resolve", side_effect=OSError("mocked resolve failure")
        ):
            result = security_adapter._find_blocker_path("/some/valid/looking/path")
        assert result is not None
        assert result == "/some/valid/looking/path"

    def test_resolve_valueerror_fail_closed(self) -> None:
        with patch.object(
            Path, "resolve", side_effect=ValueError("mocked")
        ):
            result = security_adapter._find_blocker_path("/another/path")
        assert result is not None
        assert result == "/another/path"

    def test_resolve_failure_is_blocker_present_true(self) -> None:
        """_is_blocker_present returns True when resolve fails (fail-closed)."""
        with patch.object(
            Path, "resolve", side_effect=OSError("mocked")
        ):
            assert security_adapter._is_blocker_present("/any/path") is True
