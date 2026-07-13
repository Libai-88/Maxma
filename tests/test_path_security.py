"""Comprehensive tests for tools/path_security.py.

Uses tmp_path + monkeypatch so every test is fully isolated from the
real project filesystem state.

The module is loaded directly via importlib to avoid triggering the
heavy ``tools/__init__.py`` (which pulls in langchain_core and many
other dependencies that may be broken in the test environment).
"""

import builtins
import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# ── Load path_security directly, bypassing tools/__init__.py ──

_MODULE_PATH = (
    Path(__file__).resolve().parent.parent / "tools" / "path_security.py"
)
_spec = importlib.util.spec_from_file_location("path_security", _MODULE_PATH)
ps = importlib.util.module_from_spec(_spec)
# Prevent the module-level _ensure_whitelist / _ensure_blocker from touching
# real project files: point the constants at a throwaway temp dir *before*
# exec_module runs.  We do this by pre-populating the module dict.
import tempfile as _tempfile

_fake_root = Path(_tempfile.mkdtemp(prefix="pathsec_test_"))
_fake_api_data = _fake_root / "api" / "data"
_fake_api_data.mkdir(parents=True)

ps.__dict__["_WHITELIST_PATH"] = _fake_api_data / "path_whitelist.yaml"
ps.__dict__["_BLOCKER_YAML_PATH"] = _fake_api_data / "maxma_blocker.yaml"
ps.__dict__["_PROJECT_ROOT"] = str(_fake_root)
ps.__dict__["_DEFAULT_WHITELIST_PATH"] = str(_fake_root / "anthropic_skills")
ps.__dict__["_DEFAULT_MACROS_WHITELIST_PATH"] = str(_fake_root / "macros")
ps.__dict__["_AUTO_BLOCKER_PATH"] = str(_fake_api_data)

_spec.loader.exec_module(ps)

# 注册清理：测试进程退出时删除临时目录
import atexit
atexit.register(_tempfile._crmtree, _fake_root)

# Register so monkeypatch string-references work
sys.modules["path_security"] = ps

check_maxma_blocker = ps.check_maxma_blocker
check_path_whitelisted = ps.check_path_whitelisted
check_path_access = ps.check_path_access
require_path_access = ps.require_path_access
get_safe_builtins = ps.get_safe_builtins


# ── Helpers ──────────────────────────────────────────────────


def _create_blocker(directory: Path, name: str = "MaxmaBlocker") -> Path:
    """Create a MaxmaBlocker marker file in *directory*."""
    directory.mkdir(parents=True, exist_ok=True)
    blocker = directory / name
    blocker.write_text("", encoding="utf-8")
    return blocker


def _create_directory_link(link: Path, target: Path) -> None:
    """Create a directory symlink, skipping where the host forbids it.

    Windows may require Developer Mode or a privilege for symlink creation.  The
    production check still covers its junction/reparse-point behaviour through
    ``realpath``; this test is skipped only when the test host cannot create a
    link fixture at all.
    """
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (NotImplementedError, OSError) as exc:
        symlink_error = exc

    # A directory junction is the common unprivileged reparse point on Windows.
    # It exercises the same production ``realpath`` defence when Developer Mode
    # is unavailable and ``os.symlink`` therefore fails.
    if os.name == "nt":
        command = f'mklink /J "{link}" "{target}"'
        result = subprocess.run(
            # ``link`` and ``target`` are pytest-created paths, not user input.
            # shell=True is needed here because ``mklink`` is a cmd built-in.
            command,
            shell=True,
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return

    pytest.skip(f"directory links are unavailable on this host: {symlink_error}")


# ====================================================================
# check_maxma_blocker
# ====================================================================


class TestCheckMaxmaBlocker:
    """Tests for check_maxma_blocker(target_path) -> str | None."""

    def test_empty_path_returns_none(self):
        assert check_maxma_blocker("") is None

    def test_no_blocker_in_any_ancestor(self, tmp_path):
        """Clean directory tree with no MaxmaBlocker files anywhere."""
        target = tmp_path / "clean" / "subdir"
        target.mkdir(parents=True)
        assert check_maxma_blocker(str(target)) is None

    def test_blocker_in_immediate_parent(self, tmp_path):
        """MaxmaBlocker in the target directory itself is detected."""
        target = tmp_path / "blocked_dir"
        _create_blocker(target)
        result = check_maxma_blocker(str(target))
        assert result is not None
        assert os.path.normpath(result) == os.path.normpath(str(target))

    def test_blocker_in_grandparent(self, tmp_path):
        """MaxmaBlocker in a grandparent directory is detected."""
        grandparent = tmp_path / "gp"
        parent = grandparent / "parent"
        target = parent / "child"
        target.mkdir(parents=True)
        _create_blocker(grandparent)

        result = check_maxma_blocker(str(target))
        assert result is not None
        assert os.path.normpath(result) == os.path.normpath(str(grandparent))

    @pytest.mark.parametrize(
        "filename",
        ["maxmablocker", "MaxmaBlocker", "MAXMABLOCKER", "Maxmablocker"],
    )
    def test_case_insensitive(self, tmp_path, filename):
        """Blocker detection is case-insensitive."""
        target = tmp_path / "case_test"
        target.mkdir(parents=True)
        _create_blocker(target, name=filename)

        result = check_maxma_blocker(str(target))
        assert result is not None

    @pytest.mark.parametrize(
        "filename",
        ["MaxmaBlocker.txt", "MaxmaBlocker.bak", "MaxmaBlocker.dat"],
    )
    def test_ignores_extension(self, tmp_path, filename):
        """Blocker matches regardless of file extension."""
        target = tmp_path / "ext_test"
        target.mkdir(parents=True)
        _create_blocker(target, name=filename)

        result = check_maxma_blocker(str(target))
        assert result is not None

    def test_nonexistent_path_checks_parent(self, tmp_path):
        """For a path that doesn't exist, the parent directory is checked."""
        parent = tmp_path / "real_dir"
        parent.mkdir(parents=True)
        _create_blocker(parent)

        nonexistent = parent / "does_not_exist_yet"
        assert not nonexistent.exists()

        result = check_maxma_blocker(str(nonexistent))
        assert result is not None
        assert os.path.normpath(result) == os.path.normpath(str(parent))

    def test_permission_error_gracefully_skipped(self, tmp_path):
        """PermissionError on a directory is silently skipped."""
        target = tmp_path / "perm_test"
        target.mkdir(parents=True)
        # No blocker anywhere -- the PermissionError must not cause a crash.

        original_listdir = os.listdir

        def fake_listdir(path):
            if os.path.normpath(path) == os.path.normpath(str(target)):
                raise PermissionError("simulated")
            return original_listdir(path)

        with patch.object(ps.os, "listdir", side_effect=fake_listdir):
            result = check_maxma_blocker(str(target))

        assert result is None


# ====================================================================
# check_path_whitelisted
# ====================================================================


class TestCheckPathWhitelisted:
    """Tests for check_path_whitelisted(target_path) -> str | None."""

    def test_empty_path_returns_none(self):
        assert check_path_whitelisted("") is None

    def test_exact_match_allowed(self, tmp_path, monkeypatch):
        """Target exactly matching a whitelist entry is allowed."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )
        assert check_path_whitelisted(str(allowed)) is None

    def test_recursive_child_allowed(self, tmp_path, monkeypatch):
        """Child of a recursive whitelist entry is allowed."""
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )
        assert check_path_whitelisted(str(child)) is None

    def test_recursive_grandchild_allowed(self, tmp_path, monkeypatch):
        """Grandchild of a recursive whitelist entry is allowed."""
        allowed = tmp_path / "allowed"
        grandchild = allowed / "child" / "grandchild"
        grandchild.mkdir(parents=True)
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )
        assert check_path_whitelisted(str(grandchild)) is None

    def test_nonrecursive_blocks_children(self, tmp_path, monkeypatch):
        """Non-recursive entry blocks access to child paths."""
        allowed = tmp_path / "allowed"
        child = allowed / "child"
        child.mkdir(parents=True)
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), False)]
        )
        result = check_path_whitelisted(str(child))
        assert result is not None
        assert "\u9650\u5b9a\u4ec5\u5f53\u524d\u76ee\u5f55" in result

    def test_nonrecursive_allows_exact_path(self, tmp_path, monkeypatch):
        """Non-recursive entry still allows the exact path itself."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), False)]
        )
        assert check_path_whitelisted(str(allowed)) is None

    def test_no_match_blocks(self, tmp_path, monkeypatch):
        """Path not under any whitelist entry is blocked."""
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )
        result = check_path_whitelisted(str(other))
        assert result is not None
        assert "\u4e0d\u5728\u767d\u540d\u5355\u4e2d" in result

    def test_empty_whitelist_blocks_all(self, monkeypatch):
        """Empty whitelist blocks every path (fail-secure)."""
        monkeypatch.setattr(ps, "_load_path_whitelist", lambda: [])
        result = check_path_whitelisted("/some/random/path")
        assert result is not None
        assert "\u767d\u540d\u5355\u4e3a\u7a7a" in result

    def test_symlink_to_outside_is_blocked(self, tmp_path, monkeypatch):
        """A link under an allowed directory cannot expose an outside file."""
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        secret = outside / "secret.txt"
        secret.write_text("secret", encoding="utf-8")
        _create_directory_link(allowed / "linked_outside", outside)

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        result = check_path_whitelisted(str(allowed / "linked_outside" / "secret.txt"))
        assert result is not None
        assert "\u4e0d\u5728\u767d\u540d\u5355\u4e2d" in result

    def test_new_file_below_symlink_to_outside_is_blocked(self, tmp_path, monkeypatch):
        """A not-yet-created file still resolves existing linked parents."""
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        _create_directory_link(allowed / "linked_outside", outside)

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        result = check_path_whitelisted(str(allowed / "linked_outside" / "new.txt"))
        assert result is not None

    def test_link_to_an_allowed_location_remains_allowed(self, tmp_path, monkeypatch):
        """Canonicalisation does not reject safe links within the allowlist."""
        allowed = tmp_path / "allowed"
        destination = allowed / "destination"
        allowed.mkdir()
        destination.mkdir()
        _create_directory_link(allowed / "linked_inside", destination)

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        assert check_path_whitelisted(str(allowed / "linked_inside" / "new.txt")) is None


# ====================================================================
# check_path_access
# ====================================================================


class TestCheckPathAccess:
    """Tests for check_path_access(target_path) -> str | None."""

    def test_blocker_takes_priority_over_whitelist(self, tmp_path, monkeypatch):
        """MaxmaBlocker blocks even when the path is whitelisted."""
        target = tmp_path / "both"
        _create_blocker(target)

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(target), True)]
        )

        result = check_path_access(str(target))
        assert result is not None
        assert "MaxmaBlocker" in result

    def test_whitelist_blocks_non_matching(self, tmp_path, monkeypatch):
        """Non-whitelisted path is blocked (no blocker present)."""
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        result = check_path_access(str(other))
        assert result is not None
        assert "\u62d2\u7edd\u8bbf\u95ee" in result or "\u4e0d\u5728\u767d\u540d\u5355\u4e2d" in result

    def test_allowed_path_returns_none(self, tmp_path, monkeypatch):
        """Whitelisted path with no blocker returns None."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        assert check_path_access(str(allowed)) is None

    def test_link_to_blocked_destination_checks_real_ancestors(self, tmp_path, monkeypatch):
        """A blocker at a link destination cannot be bypassed via its alias."""
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        _create_blocker(outside)
        _create_directory_link(allowed / "linked_outside", outside)

        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(tmp_path), True)]
        )

        result = check_path_access(str(allowed / "linked_outside" / "new.txt"))
        assert result is not None
        assert "MaxmaBlocker" in result


class TestPathGuard:
    """New filesystem operations should receive a canonical path or fail."""

    def test_require_returns_canonical_checked_path(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        nested = allowed / "nested" / "new.txt"
        monkeypatch.setattr(ps, "_load_path_whitelist", lambda: [(str(allowed), True)])

        assert require_path_access(nested) == ps.resolve_path_for_access(nested)

    def test_require_denies_empty_path(self):
        with pytest.raises(PermissionError):
            require_path_access("")


# ====================================================================
# get_safe_builtins
# ====================================================================


class TestGetSafeBuiltins:
    """Tests for get_safe_builtins() -> dict."""

    def test_open_is_replaced(self):
        """open() is replaced with the whitelisted wrapper, not the builtin."""
        safe = get_safe_builtins()
        assert safe["open"] is not builtins.open

    def test_common_builtins_preserved(self):
        """len, print, str, etc. are the real builtins."""
        safe = get_safe_builtins()
        assert safe["len"] is builtins.len
        assert safe["print"] is builtins.print
        assert safe["str"] is builtins.str
        assert safe["int"] is builtins.int
        assert safe["dict"] is builtins.dict
        assert safe["list"] is builtins.list

    def test_dangerous_builtins_removed(self):
        """危险内置函数不应出现在受限 builtins 中。"""
        safe = get_safe_builtins()
        dangerous = {
            "__import__", "eval", "exec", "compile", "breakpoint", "input",
            "exit", "quit",
        }
        for name in dangerous:
            assert name not in safe, f"{name} should not be in safe builtins"

    def test_open_is_replaced_wrapper(self):
        """open() is replaced with the whitelisted wrapper."""
        safe = get_safe_builtins()
        assert safe["open"] is ps._whitelisted_open

    def test_open_uses_resolved_path_after_validation(self, tmp_path, monkeypatch):
        """The safe open wrapper must not reopen the unchecked link alias."""
        allowed = tmp_path / "allowed"
        outside = tmp_path / "outside"
        allowed.mkdir()
        outside.mkdir()
        secret = outside / "secret.txt"
        secret.write_text("secret", encoding="utf-8")
        _create_directory_link(allowed / "linked_outside", outside)
        monkeypatch.setattr(
            ps, "_load_path_whitelist", lambda: [(str(allowed), True)]
        )

        with pytest.raises(PermissionError):
            ps._whitelisted_open(allowed / "linked_outside" / "secret.txt")

    def test_builtins_key_is_self_referencing(self):
        """__builtins__ in the returned dict points to the dict itself."""
        safe = get_safe_builtins()
        assert safe["__builtins__"] is safe

    def test_metaprogramming_entries_blocked(self):
        """阶段 3.5：元编程逃逸入口不应出现在 safe builtins 中。"""
        safe = get_safe_builtins()
        metaprogramming_entries = {
            # 内省/反射函数
            "globals", "locals", "vars", "dir",
            # 类型/属性操作
            "type", "getattr", "setattr", "delattr", "super",
            # 描述符协议
            "classmethod", "staticmethod", "property",
            # 内存视图
            "memoryview",
            # 代码执行/动态求值（应在 _DANGEROUS_BUILTIN_NAMES 中）
            "eval", "exec", "compile", "__import__",
        }
        for name in metaprogramming_entries:
            assert name not in safe, (
                f"{name} 不应在 get_safe_builtins() 中（元编程逃逸入口）"
            )

    def test_sandbox_builtins_stricter_than_safe_builtins(self):
        """阶段 3.5：get_sandbox_builtins() 应比 get_safe_builtins() 更严格。"""
        sandbox_builtins = ps.get_sandbox_builtins()
        safe_builtins = get_safe_builtins()

        # sandbox 不应含 open（沙箱内禁文件 I/O）
        assert "open" not in sandbox_builtins
        # safe 应含 open（白名单包装版本）
        assert "open" in safe_builtins

        # sandbox 不应含 hasattr（可触发 __getattr__ 链）
        assert "hasattr" not in sandbox_builtins
        # safe 应含 hasattr
        assert "hasattr" in safe_builtins

        # 两者都不应含元编程入口
        for bad in ("globals", "type", "getattr"):
            assert bad not in sandbox_builtins
            assert bad not in safe_builtins

    def test_blocked_dunder_attributes_constant_exists(self):
        """阶段 3.5：_BLOCKED_DUNDER_ATTRIBUTES 集合应包含已知逃逸路径。"""
        blocked = ps._BLOCKED_DUNDER_ATTRIBUTES
        # 已知逃逸路径必须被覆盖
        required = {
            "__subclasses__", "__bases__", "__mro__", "__class__",
            "__globals__", "__builtins__", "__dict__", "__code__",
        }
        assert required.issubset(blocked), (
            f"缺失关键 dunder 拦截: {required - blocked}"
        )
