"""Tests for tools/system/tool_python.py sandbox execution."""

import importlib.util
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest


def _load_tool_python_module():
    module_path = (
        Path(__file__).resolve().parents[2] / "tools" / "system" / "tool_python.py"
    )
    spec = importlib.util.spec_from_file_location("tool_python_under_test", module_path)
    module = importlib.util.module_from_spec(spec)

    # Provide lightweight stubs for dependencies that are not needed in tests
    if "api" not in sys.modules:
        sys.modules["api"] = types.ModuleType("api")
    if "api.interaction" not in sys.modules:
        sys.modules["api.interaction"] = types.ModuleType("api.interaction")

    # Stub tools.base to avoid importing heavy langchain tooling in tests.
    fake_tools_base = types.ModuleType("tools.base")

    class _FakeToolBase:
        pass

    fake_tools_base.ToolBase = _FakeToolBase
    fake_tools_base.format_error = lambda message: {"ok": False, "error": message}
    fake_tools_base.format_success = lambda data: {"ok": True, "data": data}
    sys.modules["tools.base"] = fake_tools_base

    spec.loader.exec_module(module)
    return module


tool_python = _load_tool_python_module()
_run_in_sandbox = tool_python._run_in_sandbox


class TestRunInSandbox:
    """Tests for _run_in_sandbox()."""

    def test_simple_code_runs(self):
        result = _run_in_sandbox("print('hello')", timeout=5)

        assert result["exit_code"] == 0
        assert "hello" in result["stdout"]
        assert result["timed_out"] is False

    def test_timeout_is_reported(self):
        # Avoid importing modules inside the sandbox; use an infinite loop instead.
        result = _run_in_sandbox("while True:\n    pass", timeout=1)

        assert result["timed_out"] is True
        assert result["exit_code"] != 0

    def test_eval_is_blocked(self):
        result = _run_in_sandbox("eval('1+1')", timeout=5)

        assert result["exit_code"] != 0
        assert "eval" in result["stderr"].lower() or "name" in result["stderr"].lower()

    def test_import_is_blocked(self):
        result = _run_in_sandbox("import os; print(os.getcwd())", timeout=5)

        assert result["exit_code"] != 0
        assert "导入" in result["stderr"] or "import" in result["stderr"].lower()

    def test_open_is_blocked(self):
        result = _run_in_sandbox("open('/etc/passwd')", timeout=5)

        assert result["exit_code"] != 0

    def test_sensitive_env_vars_are_not_exposed(self, monkeypatch):
        # The subprocess should not inherit arbitrary env vars.
        monkeypatch.setenv("MY_SECRET_API_KEY", "leak-me")
        monkeypatch.setenv("CUSTOM_TOKEN", "leak-token")

        result = _run_in_sandbox(
            "print('ran')",
            timeout=5,
        )

        assert result["exit_code"] == 0
        assert "ran" in result["stdout"]


class TestSandboxEnv:
    """Tests for environment variable filtering."""

    def test_build_sandbox_env_filters_arbitrary_vars(self, monkeypatch):
        monkeypatch.setenv("MY_SECRET_API_KEY", "leak-me")
        monkeypatch.setenv("CUSTOM_TOKEN", "leak-token")

        env = tool_python._build_sandbox_env()

        assert "MY_SECRET_API_KEY" not in env
        assert "CUSTOM_TOKEN" not in env
        # Necessary Windows/Python variables are preserved.
        assert "PATH" in env

    def test_subprocess_env_does_not_leak_secrets(self, monkeypatch):
        monkeypatch.setenv("MY_SECRET_API_KEY", "leak-me")

        proc = subprocess.run(
            [
                sys.executable,
                "-c",
                "import os; print(os.environ.get('MY_SECRET_API_KEY', 'NOT_FOUND'))",
            ],
            env=tool_python._build_sandbox_env(),
            capture_output=True,
            text=True,
        )

        assert proc.returncode == 0
        assert "leak-me" not in proc.stdout
        assert "NOT_FOUND" in proc.stdout
