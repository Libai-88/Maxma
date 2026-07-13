"""阶段 3.5 专项测试 — Python 沙箱元编程逃逸拦截。

覆盖 10+ 种已知 Python 沙箱逃逸技巧，验证两层防御：
1. 主进程 AST 预检（_check_metaprogramming_safety）
2. 子进程白名单 builtins（_SANDBOX_WRAPPER）

已知逃逸路径参考：
- https://book.hacktricks.xyz/generic-methodologies-and-resources/python/bypass-python-sandboxes
- https://nedbatchelder.com/blog/201206/eval_really_is_dangerous.html
"""

import importlib.util
import sys
import types
from pathlib import Path
from unittest.mock import patch

import pytest


def _load_tool_python_module():
    """与 test_tool_python.py 相同的加载逻辑（避免依赖 langchain 工具链）。"""
    module_path = (
        Path(__file__).resolve().parents[2] / "tools" / "system" / "tool_python.py"
    )
    spec = importlib.util.spec_from_file_location("tool_python_meta_test", module_path)
    module = importlib.util.module_from_spec(spec)

    fake_tools_base = types.ModuleType("tools.base")

    class _FakeToolBase:
        pass

    fake_tools_base.ToolBase = _FakeToolBase
    fake_tools_base.format_error = lambda message: {"ok": False, "error": message}
    fake_tools_base.format_success = lambda data: {"ok": True, "data": data}
    fake_tools_base.register_tool = lambda cls: cls

    mock_modules: dict[str, types.ModuleType] = {
        "api": types.ModuleType("api"),
        "api.interaction": types.ModuleType("api.interaction"),
        "tools.base": fake_tools_base,
    }

    with patch.dict(sys.modules, mock_modules, clear=False):
        spec.loader.exec_module(module)

    return module


tool_python = _load_tool_python_module()
_run_in_sandbox = tool_python._run_in_sandbox
_check_metaprogramming_safety = tool_python._check_metaprogramming_safety
MetaprogrammingError = tool_python.MetaprogrammingError


# ── 已知元编程逃逸 payload（应在 AST 预检阶段被拦截）──────────────

KNOWN_ESCAPE_PAYLOADS = [
    # 1. 经典 __subclasses__ 链 — 找到 subprocess.Popen
    "().__class__.__bases__[0].__subclasses__()",
    # 2. __mro__ 顺链
    "().__class__.__mro__[-1].__subclasses__()",
    # 3. 通过类型对象的 __subclasses__
    "object.__subclasses__()",
    # 4. 通过 list 类型
    "[].__class__.__bases__[0].__subclasses__()",
    # 5. dict 类型
    "{}.__class__.__bases__[0].__subclasses__()",
    # 6. __globals__ → __builtins__ → __import__
    "print.__globals__['__builtins__']['__import__']('os')",
    # 7. 任意函数对象的 __globals__
    "def f():\n    pass\nf.__globals__",
    # 8. __code__ 替换攻击
    "def f():\n    pass\nf.__code__ = print.__code__",
    # 9. __builtins__ 直接访问
    "x = __builtins__",
    # 10. __dict__ 探测内部状态
    "print(print.__dict__)",
    # 11. bound method 的 __self__ / __func__
    "print(''.join.__self__)",
    "print(''.join.__func__)",
    # 12. __module__ 反查
    "print(print.__module__)",
    # 13. __loader__ / __spec__ 反查 import 系统
    "print(print.__loader__)",
    "print(print.__spec__)",
]


class TestKnownEscapePayloads:
    """已知逃逸 payload 必须被 AST 预检拦截。"""

    @pytest.mark.parametrize("payload", KNOWN_ESCAPE_PAYLOADS)
    def test_ast_check_rejects_payload(self, payload):
        """AST 预检应对所有已知逃逸 payload 抛 MetaprogrammingError。"""
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety(payload)

    @pytest.mark.parametrize("payload", KNOWN_ESCAPE_PAYLOADS)
    def test_sandbox_rejects_payload_even_if_ast_misses(self, payload):
        """即便 AST 预检漏检，子进程白名单 builtins 应作为第二层防御。

        此测试模拟 AST 漏检场景：直接调用 _run_in_sandbox（绕过 _arun 中的预检）。
        子进程应因白名单 builtins 缺失 type/getattr/__import__ 等而失败。
        """
        result = _run_in_sandbox(payload, timeout=5)
        # 应非零退出（要么 NameError 要么 AttributeError，但都不应成功逃逸）
        assert result["exit_code"] != 0, f"payload 不应执行成功: {payload}"
        # 不应在 stdout 中暴露敏感信息
        assert "subprocess" not in result.get("stdout", "").lower()
        assert "Popen" not in result.get("stdout", "")
        assert "os.system" not in result.get("stdout", "").lower()


class TestDirectBuiltinBlock:
    """直接调用危险 builtins 应被 AST 预检拦截。"""

    @pytest.mark.parametrize(
        "bad_builtin",
        [
            "globals", "locals", "vars", "dir",
            "type", "getattr", "setattr", "delattr", "super",
            "classmethod", "staticmethod", "property", "memoryview",
            "eval", "exec", "compile", "open", "__import__",
            "breakpoint", "input", "help",
        ],
    )
    def test_blocked_builtins_rejected_by_ast(self, bad_builtin):
        """直接引用危险 builtins 应在 AST 预检阶段被拒。"""
        code = f"x = {bad_builtin}"
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety(code)


class TestSafeCodeNotBlocked:
    """正常代码不应被 AST 预检误拦。"""

    @pytest.mark.parametrize(
        "code",
        [
            "print('hello')",
            "x = [1, 2, 3]\nprint(sum(x))",
            "result = sorted([3, 1, 2])\nprint(result)",
            "def add(a, b):\n    return a + b\nprint(add(1, 2))",
            "data = {'key': 'value'}\nprint(data['key'])",
            "for i in range(10):\n    print(i)",
            "x = [i * 2 for i in range(5)]",
            "nums = (1, 2, 3)\nprint(max(nums), min(nums))",
            "s = 'hello world'\nprint(s.upper(), s.split())",
            "d = {'a': 1, 'b': 2}\nprint(list(d.keys()))",
            # 函数定义、循环、条件
            "def fib(n):\n    if n < 2:\n        return n\n    return fib(n-1) + fib(n-2)\nprint(fib(10))",
            # 类定义（普通用法，不调用 type()）
            "class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\np = Point(1, 2)\nprint(p.x, p.y)",
        ],
    )
    def test_safe_code_passes_ast_check(self, code):
        """正常代码不应被 AST 预检拦截。"""
        _check_metaprogramming_safety(code)  # 不抛异常即通过

    @pytest.mark.parametrize(
        "code",
        [
            "print('hello')",
            "x = [1, 2, 3]\nprint(sum(x))",
            "result = sorted([3, 1, 2])\nprint(result)",
        ],
    )
    def test_safe_code_runs_in_sandbox(self, code):
        """正常代码应在沙箱中正常执行。"""
        result = _run_in_sandbox(code, timeout=5)
        assert result["exit_code"] == 0, f"代码应正常执行: {code}, stderr: {result['stderr']}"


class TestLayeredDefense:
    """双层防御一致性验证。"""

    def test_ast_blocks_dunder_and_builtins_independently(self):
        """AST 预检应分别拦截 dunder 访问和危险 builtins 引用。"""
        # 仅 dunder 访问（无危险 builtins 名）
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety("x = obj.__class__")
        # 仅危险 builtins 引用（无 dunder）
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety("x = type(1)")
        # 两者都命中（一条代码同时触发两类拦截）
        with pytest.raises(MetaprogrammingError):
            _check_metaprogramming_safety("x = type(obj).__class__")

    def test_sandbox_safe_builtins_subset(self):
        """沙箱白名单 builtins 应是 path_security._SAFE_BUILTIN_NAMES 的子集。"""
        # 通过实际执行验证：白名单内的 builtins 在沙箱内可用
        for safe_builtin in ("print", "len", "range", "sum", "sorted", "max", "min", "int", "str"):
            result = _run_in_sandbox(f"print({safe_builtin})", timeout=5)
            # print 自身是 print，其他会输出 <built-in function ...>
            assert result["exit_code"] == 0, f"{safe_builtin} 应在沙箱内可用"

    def test_no_subprocess_leak_through_metaprogramming(self):
        """综合测试：即便多层嵌套，subprocess 也不应被沙箱代码访问到。"""
        # 这个 payload 在未保护环境下会调起 notepad/calc
        payloads = [
            # 经典：通过 __subclasses__ 找到 Popen
            "().__class__.__bases__[0].__subclasses__()",
            # 通过 type()
            "type('X', (object,), {'run': lambda self: 1})()",
        ]
        for payload in payloads:
            # AST 预检应直接拦截
            with pytest.raises(MetaprogrammingError):
                _check_metaprogramming_safety(payload)
