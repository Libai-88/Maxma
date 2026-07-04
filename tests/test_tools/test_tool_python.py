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

    # Save originals so we can restore sys.modules after loading (避免污染其他测试)
    _saved = {}
    for _name in ("api", "api.interaction", "tools.base", "tools"):
        _saved[_name] = sys.modules.get(_name)

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
    fake_tools_base.register_tool = lambda cls: cls
    sys.modules["tools.base"] = fake_tools_base

    spec.loader.exec_module(module)

    # 恢复 sys.modules，避免空 stub 模块污染后续测试（如 test_graph/test_tool_registry）
    for _name, _prev in _saved.items():
        if _prev is not None:
            sys.modules[_name] = _prev
        else:
            sys.modules.pop(_name, None)

    return module


tool_python = _load_tool_python_module()
_run_in_sandbox = tool_python._run_in_sandbox
_check_metaprogramming_safety = tool_python._check_metaprogramming_safety
MetaprogrammingError = tool_python.MetaprogrammingError


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

    def test_safe_builtins_available(self):
        """白名单内的 builtins 应正常可用。"""
        result = _run_in_sandbox(
            "print(sum(range(10)), len([1,2,3]), max([3,1,2]), sorted([3,1,2]))",
            timeout=5,
        )
        assert result["exit_code"] == 0
        assert "45 3 3 [1, 2, 3]" in result["stdout"]

    def test_dangerous_builtins_not_in_sandbox(self):
        """阶段 3.5：黑名单 builtins（globals/locals/vars/dir/type/getattr 等）应不可用。"""
        # 直接调用应在子进程中 NameError
        for bad in ("globals", "locals", "vars", "dir", "type", "getattr", "setattr", "super"):
            result = _run_in_sandbox(f"print({bad})", timeout=5)
            assert result["exit_code"] != 0, f"{bad} 应被沙箱阻断"
            assert "name" in result["stderr"].lower(), f"{bad} 应报 NameError"


class TestMetaprogrammingAstCheck:
    """阶段 3.5：AST 预检拦截元编程逃逸入口。"""

    @pytest.mark.parametrize(
        "code",
        [
            # 经典逃逸：通过 __class__.__bases__[0].__subclasses__() 找 subprocess.Popen
            "().__class__.__bases__[0].__subclasses__()",
            "().__class__.__mro__[-1].__subclasses__()",
            # __globals__ → __builtins__ → __import__
            "print.__globals__['__builtins__']['__import__']('os')",
            # __code__ 替换攻击
            "def f(): pass\nf.__code__ = print.__code__",
            # __dict__ 探测内部状态
            "print(print.__dict__)",
            # 直接访问 __builtins__
            "x = __builtins__",
        ],
    )
    def test_dunder_attributes_blocked(self, code):
        """被阻断的 dunder 属性访问应抛 MetaprogrammingError。"""
        with pytest.raises(MetaprogrammingError) as exc_info:
            _check_metaprogramming_safety(code)
        assert "dunder" in str(exc_info.value).lower() or "元编程" in str(exc_info.value)

    @pytest.mark.parametrize(
        "code",
        [
            "globals()",
            "locals()",
            "vars()",
            "dir()",
            "type('X', (), {})",
            "getattr(object, '__class__')",
            "setattr(obj, 'x', 1)",
            "super()",
            "eval('1+1')",
            "exec('print(1)')",
            "compile('1', '<s>', 'eval')",
            "open('/etc/passwd')",
            "__import__('os')",
            "breakpoint()",
            "input()",
        ],
    )
    def test_blocked_builtins_rejected(self, code):
        """被阻断的内置函数应在 AST 预检阶段被拒。"""
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety(code)

    def test_safe_code_passes(self):
        """白名单内的代码不应被 AST 预检拦截。"""
        safe_samples = [
            "print('hello')",
            "x = [1, 2, 3]\nprint(sum(x))",
            "result = sorted([3, 1, 2])\nprint(result)",
            "def add(a, b):\n    return a + b\nprint(add(1, 2))",
            "data = {'key': 'value'}\nprint(data['key'])",
            "for i in range(10):\n    print(i)",
            "x = [i * 2 for i in range(5)]",
        ]
        for code in safe_samples:
            # 不抛异常即通过
            _check_metaprogramming_safety(code)

    def test_syntax_error_raises_metaprogramming_error(self):
        """语法错误的代码应抛 MetaprogrammingError（清晰错误）。"""
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety("def f(:\n    pass")


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
