"""Tool: run_python — 在沙箱进程中执行 Python 代码。

Phase 1 沙箱：使用 subprocess.run 在独立进程中执行代码，
支持超时控制和内存限制，防止恶意或失控代码影响主进程。

阶段 3.5 加固：
- _SANDBOX_WRAPPER 改为白名单策略（与 path_security.get_safe_builtins 一致）
- 主进程 AST 预检拦截元编程逃逸入口（__subclasses__/__globals__/__class__ 等 dunder）
- 与 path_security._BLOCKED_DUNDER_ATTRIBUTES 双层防御
- MAX_MEMORY_MB 真正生效由阶段 3.4 SandboxRunner 落地（Unix: RLIMIT_AS / Windows: Job Object）
"""

import ast
import asyncio
import os
import subprocess
import sys
import tempfile

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success, register_tool

# 沙箱配置
DEFAULT_TIMEOUT = 30  # 默认超时（秒）
MAX_TIMEOUT = 120  # 最大超时（秒）
MAX_MEMORY_MB = 512  # 最大内存（MB）—— 实际生效由阶段 3.4 SandboxRunner 实现

# 沙箱内允许的 builtins 白名单（与 tools/path_security._SAFE_BUILTIN_NAMES 同步，
# 但移除 hasattr — 可触发 __getattr__ 链导致元编程逃逸；移除 open — 沙箱内禁文件 I/O）。
# 子进程无法 import path_security 模块，故在此内联维护白名单。
_SANDBOX_BUILTIN_NAMES: frozenset[str] = frozenset({
    "abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool", "bytearray",
    "bytes", "callable", "chr", "complex", "dict",
    "divmod", "enumerate", "filter", "float", "format", "frozenset",
    "hash", "hex", "id", "int",
    "isinstance", "issubclass", "iter", "len", "list", "map", "max",
    "min", "next", "object", "oct", "ord", "pow", "print",
    "range", "repr", "reversed", "round", "set", "slice", "sorted",
    "str", "sum", "tuple", "zip",
})

# 受限 exec 环境中明令阻断的 dunder 属性名（与 path_security._BLOCKED_DUNDER_ATTRIBUTES 一致）。
# AST 预检会扫描代码中所有 `obj.<attr>` 形式的属性访问，命中即拒绝执行。
# 阶段 3.5 增强：新增 __getattribute__/__getattr__/__reduce__/__reduce_ex__/__closure__
# 等"元 dunder"——它们可绕过属性访问拦截器本身，是已知的二级逃逸向量。
_BLOCKED_DUNDER_ATTRIBUTES: frozenset[str] = frozenset({
    "__subclasses__", "__bases__", "__mro__", "__class__", "__globals__",
    "__builtins__", "__dict__", "__code__", "__func__", "__self__",
    "__module__", "__loader__", "__spec__", "__import_subclasses__",
    "__getattribute__", "__getattr__", "__reduce__", "__reduce_ex__",
    "__closure__", "__init_subclass__", "__subclasshook__",
})

# 沙箱执行器脚本 — 在子进程中运行用户代码
# 阶段 3.5 双层防御：
#   1. 白名单 builtins（仅 _SANDBOX_BUILTIN_NAMES 可用，不暴露 type/getattr/open 等）
#   2. AST 变换 + 运行时 dunder 拦截（_safe_getattr 阻断所有 __*__ 属性访问）
# AST 变换将 `obj.attr` (Load) 重写为 `_safe_getattr(obj, 'attr')`，即便主进程
# AST 预检漏检，子进程仍在运行时阻断 __subclasses__/__class__/__globals__ 等逃逸入口。
# 隐式 dunder 调用（len(obj)→obj.__len__()、str(obj)→obj.__str__()）不受影响——
# 它们由内置函数/语法触发，不经过用户代码的属性访问路径。
_SANDBOX_WRAPPER = r'''
import sys, json, traceback, io as _io, ast

# 白名单 builtins：仅暴露纯计算/数据结构函数。
_SAFE_NAMES = frozenset({
    "abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool", "bytearray",
    "bytes", "callable", "chr", "complex", "dict",
    "divmod", "enumerate", "filter", "float", "format", "frozenset",
    "hash", "hex", "id", "int",
    "isinstance", "issubclass", "iter", "len", "list", "map", "max",
    "min", "next", "object", "oct", "ord", "pow", "print",
    "range", "repr", "reversed", "round", "set", "slice", "sorted",
    "str", "sum", "tuple", "zip",
})

if isinstance(__builtins__, dict):
    _src = __builtins__
else:
    _src = __builtins__.__dict__

_safe_builtins = {_k: _v for _k, _v in _src.items() if _k in _SAFE_NAMES}

# 显式拦截 import 语句，给出清晰错误。
def _blocked_import(*args, **kwargs):
    raise ImportError("沙箱中已禁用模块导入")
_safe_builtins["__import__"] = _blocked_import


# ── 运行时 dunder 属性拦截（第二层防御）──────────────────────
# _safe_getattr 阻断所有 __*__ 形式的 dunder 属性（__name__/__doc__ 等少数无害除外）。
# 阻断 dunder 是因为 __subclasses__/__class__/__globals__/__getattribute__ 等
# 是 Python 沙箱逃逸的标准跳板。允许的 dunder 仅限纯字符串元数据。
_ALLOWED_DUNDER = frozenset({
    "__name__", "__doc__", "__qualname__", "__annotations__",
})

def _safe_getattr(obj, name):
    """运行时属性访问拦截：阻断所有 dunder 属性（少数无害元数据除外）。"""
    if isinstance(name, str) and name.startswith("__") and name.endswith("__"):
        if name not in _ALLOWED_DUNDER:
            raise AttributeError(f"沙箱禁止访问 dunder 属性: .{name}")
    return getattr(obj, name)

def _blocked_name(name):
    """运行时名称拦截：阻断 __builtins__ 等危险名称引用。"""
    raise NameError(f"沙箱禁止访问名称: {name}")


class _SandboxTransformer(ast.NodeTransformer):
    """AST 变换器：将属性访问重写为 _safe_getattr 调用，__builtins__ 名称重写为 _blocked_name 调用。"""

    def visit_Attribute(self, node):
        self.generic_visit(node)
        if isinstance(node.ctx, ast.Load):
            # obj.attr (Load) → _safe_getattr(obj, 'attr')
            return ast.Call(
                func=ast.Name(id='_safe_getattr', ctx=ast.Load()),
                args=[node.value, ast.Constant(value=node.attr)],
                keywords=[]
            )
        return node

    def visit_Name(self, node):
        if node.id == '__builtins__' and isinstance(node.ctx, ast.Load):
            # __builtins__ (Load) → _blocked_name('__builtins__')
            return ast.Call(
                func=ast.Name(id='_blocked_name', ctx=ast.Load()),
                args=[ast.Constant(value=node.id)],
                keywords=[]
            )
        return node


code = sys.stdin.read()

# 解析并变换 AST：将所有 Load 属性访问替换为 _safe_getattr 调用
parse_error = None
code_obj = None
try:
    tree = ast.parse(code)
    transformer = _SandboxTransformer()
    tree = transformer.visit(tree)
    ast.fix_missing_locations(tree)
    code_obj = compile(tree, '<sandbox>', 'exec')
except SyntaxError as e:
    parse_error = e

old_stdout = sys.stdout
old_stderr = sys.stderr
sys.stdout = _io.StringIO()
sys.stderr = _io.StringIO()

exit_code = 0
try:
    if code_obj is None:
        # 语法错误或 AST 变换失败 — 不执行
        _stdout = ""
        _stderr = f"SyntaxError: {parse_error}"
        exit_code = 1
    else:
        exec(code_obj, {
            "__name__": "__main__",
            "__builtins__": _safe_builtins,
            "_safe_getattr": _safe_getattr,
            "_blocked_name": _blocked_name,
        })
        _stdout = sys.stdout.getvalue()
        _stderr = sys.stderr.getvalue()
except SystemExit as e:
    _stdout = sys.stdout.getvalue()
    _stderr = sys.stderr.getvalue()
    exit_code = e.code if isinstance(e.code, int) else 1
except Exception:
    _stdout = sys.stdout.getvalue()
    _stderr = traceback.format_exc()
    exit_code = 1
finally:
    sys.stdout = old_stdout
    sys.stderr = old_stderr

print(json.dumps({"stdout": _stdout or "", "stderr": _stderr or "", "exit_code": exit_code}, ensure_ascii=False))
'''


class MetaprogrammingError(Exception):
    """用户代码包含被拦截的元编程逃逸入口（阶段 3.5）。"""


def _check_metaprogramming_safety(code: str) -> None:
    """AST 预检：拦截已知元编程逃逸入口（阶段 3.5）。

    扫描代码中所有属性访问 ``obj.attr``，若 ``attr`` 命中
    ``_BLOCKED_DUNDER_ATTRIBUTES`` 则抛出 ``MetaprogrammingError``。

    拦截示例：
    - ``().__class__.__bases__[0].__subclasses__()`` → 命中 __class__/__bases__/__subclasses__
    - ``type('X', (object,), {...})`` → type 不在白名单 builtins，子进程内 NameError
    - ``getattr(obj, '__class__')`` → getattr 不在白名单 builtins，子进程内 NameError
    - ``func.__globals__['__builtins__']`` → 命中 __globals__/__builtins__

    注意：AST 预检是第一层防御，第二层是沙箱 builtins 白名单。
    即便 AST 漏检，沙箱内仍因 type/getattr/globals 等不在白名单而失败。
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        # 语法错误交给子进程处理，这里不阻断
        raise MetaprogrammingError(f"代码语法错误: {e}") from None

    for node in ast.walk(tree):
        # 检测属性访问：obj.attr（含 obj."attr"）
        if isinstance(node, ast.Attribute):
            attr_name = node.attr
            if attr_name in _BLOCKED_DUNDER_ATTRIBUTES:
                raise MetaprogrammingError(
                    f"沙箱禁止访问 dunder 属性: .{attr_name}（元编程逃逸入口已拦截）"
                )
        # 检测名称引用：直接引用 globals/locals/vars/dir/type/getattr/setattr/delattr/super
        # 这些已不在白名单 builtins 中，但 AST 预检给出更清晰的错误信息
        if isinstance(node, ast.Name):
            name = node.id
            blocked_builtins = {
                "globals", "locals", "vars", "dir", "type",
                "getattr", "setattr", "delattr", "super",
                "classmethod", "staticmethod", "property", "memoryview",
                "eval", "exec", "compile", "open", "__import__",
                "breakpoint", "input", "help",
                # __builtins__ 作为名称引用也应阻断（直接拿到内置命名空间）
                "__builtins__",
            }
            if name in blocked_builtins and isinstance(node.ctx, ast.Load):
                raise MetaprogrammingError(
                    f"沙箱禁止使用内置函数: {name}（元编程/IO 入口已拦截）"
                )


# 允许传入沙箱子进程的环境变量白名单。
# 使用白名单而非黑名单，避免攻击者通过变换变量名绕过过滤。
_ALLOWED_ENV_VARS: frozenset[str] = frozenset({
    # Windows / Python 运行必需
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR",
    "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "PYTHONUTF8", "PYTHONIOENCODING", "PYTHONLEGACYWINDOWSSTDIO",
    "PYTHONHOME", "PYTHONPATH",
})


def _build_sandbox_env() -> dict[str, str]:
    """构建沙箱子进程使用的环境变量字典（白名单过滤）。"""
    return {
        key: value
        for key, value in os.environ.items()
        if key.upper() in _ALLOWED_ENV_VARS
    }


def _run_in_sandbox(code: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """在独立子进程中执行 Python 代码（阶段 3.4：集成 SandboxRunner OS 级隔离）。

    Args:
        code: 要执行的 Python 代码
        timeout: 超时秒数

    Returns:
        dict with keys: stdout, stderr, exit_code, timed_out
    """
    try:
        from tools.system.sandbox_runner import get_sandbox_runner

        # 获取 OS 级隔离运行器（首次调用时执行能力探测）
        runner = get_sandbox_runner(memory_mb=MAX_MEMORY_MB)

        # 选择子进程 Python 解释器：
        # - 打包模式：使用嵌入式 Python（PYTHON_EMBED_EXE），避免触发 PyInstaller
        #   bootloader 解压（每次调用 5-10 秒，极慢）
        # - 开发模式：使用当前解释器 sys.executable
        from app_paths import PYTHON_EMBED_EXE, _is_frozen
        if _is_frozen() and PYTHON_EMBED_EXE.exists():
            python_exe = str(PYTHON_EMBED_EXE)
        else:
            python_exe = sys.executable

        # 构建子进程命令（firejail 模式下会包装命令）
        cmd = runner.build_command([python_exe, "-c", _SANDBOX_WRAPPER])

        # 使用白名单限制子进程环境变量，防止敏感信息泄漏
        env = _build_sandbox_env()

        # 获取平台相关 Popen kwargs（preexec_fn / creationflags）
        popen_kwargs = runner.get_popen_kwargs()

        # 启动子进程
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=tempfile.gettempdir(),  # 在临时目录执行，防止访问项目文件
            **popen_kwargs,
        )

        # Windows Job Object 模式：分配进程到 job 并恢复线程（其他模式空操作）
        runner.on_process_started(proc)

        try:
            stdout, stderr = proc.communicate(
                input=code.encode('utf-8'),
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            return {
                "stdout": "",
                "stderr": f"代码执行超时（{timeout} 秒），已强制终止",
                "exit_code": -1,
                "timed_out": True,
            }

        # 解析子进程输出
        stdout_text = stdout.decode('utf-8', errors='replace').strip()

        # 尝试解析 JSON 结果
        import json
        try:
            result = json.loads(stdout_text)
            return {
                "stdout": result.get("stdout", ""),
                "stderr": result.get("stderr", ""),
                "exit_code": result.get("exit_code", proc.returncode),
                "timed_out": False,
            }
        except (json.JSONDecodeError, ValueError):
            # 如果输出不是 JSON，直接返回原始输出
            return {
                "stdout": stdout_text,
                "stderr": stderr.decode('utf-8', errors='replace'),
                "exit_code": proc.returncode,
                "timed_out": False,
            }

    except Exception as e:
        return {
            "stdout": "",
            "stderr": f"沙箱执行失败: {e}",
            "exit_code": -1,
            "timed_out": False,
        }


class RunPythonInput(BaseModel):
    get_doc: bool = Field(
        default=False, description="设为 true 以获取使用说明和安全限制"
    )
    code: str = Field(default="", description="要执行的 Python 代码，支持多行")
    timeout: int = Field(
        default=DEFAULT_TIMEOUT,
        description=f"执行超时秒数（默认 {DEFAULT_TIMEOUT}，最大 {MAX_TIMEOUT}）",
    )


@register_tool
class RunPythonTool(ToolBase):
    name: str = "run_python"
    description: str = (
        "在沙箱进程中执行 Python 代码，返回 stdout 输出。"
        "代码在独立进程中运行，有超时和内存限制。"
        "用于计算、数据处理、文本转换。"
        "[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = RunPythonInput

    def _run(self, get_doc: bool = False, code: str = "", timeout: int = DEFAULT_TIMEOUT) -> str:
        raise NotImplementedError("run_python 仅支持异步模式，请使用 _arun")

    async def _arun(self, get_doc: bool = False, code: str = "", timeout: int = DEFAULT_TIMEOUT) -> str:
        if get_doc:
            return self._load_doc()
        if not code:
            return format_error("code 不能为空")

        # 限制超时范围
        timeout = max(1, min(timeout, MAX_TIMEOUT))

        # 阶段 3.5：AST 预检拦截元编程逃逸入口（在用户确认前先阻断，
        # 避免恶意代码即便不被执行也消耗交互资源）
        try:
            _check_metaprogramming_safety(code)
        except MetaprogrammingError as e:
            return format_error(str(e))

        session_id = interaction.current_session_id.get()
        if session_id and interaction.get_session_auto_approve(session_id):
            try:
                result = await asyncio.to_thread(_run_in_sandbox, code, timeout)
                return self._format_result(result, code)
            except Exception as e:
                return format_error(f"沙箱执行错误: {e}")

        ws = interaction.current_ws.get()
        interaction_id, future = await interaction.register()

        await ws.send_json(
            {
                "type": "ask_user",
                "payload": {
                    "tool_name": self.name,
                    "question": "即将执行以下 Python 代码，是否确认执行？",
                    "mode": "confirm",
                    "options": ["执行", "取消"],
                    "interaction_id": interaction_id,
                    "code": code,
                },
            }
        )

        try:
            answer = await asyncio.wait_for(future, timeout=300)

            action = answer
            reason = ""
            if isinstance(answer, dict):
                action = answer.get("action", "")
                reason = answer.get("reason", "")

            # 接受多种确认方式: "approve" (标准), "确认" (confirm 模式), "执行" (选项)
            if action in ("approve", "确认", "执行"):
                try:
                    result = await asyncio.to_thread(_run_in_sandbox, code, timeout)
                    return self._format_result(result, code)
                except Exception as e:
                    return format_error(f"沙箱执行错误: {e}")
            else:
                if reason:
                    return format_error(f"用户拒绝执行代码。原因：{reason}")
                else:
                    return format_error("用户拒绝执行代码")

        except asyncio.TimeoutError:
            return format_error("确认超时（300 秒），代码执行已取消")
        except asyncio.CancelledError:
            return format_error("用户取消了回复")
        finally:
            await interaction.cleanup(interaction_id)

    def _format_result(self, result: dict, code: str) -> str:
        """格式化沙箱执行结果。"""
        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")
        exit_code = result.get("exit_code", 0)
        timed_out = result.get("timed_out", False)

        if timed_out:
            return format_error(stderr or "代码执行超时")

        if exit_code != 0:
            error_detail = stderr or stdout or "未知错误"
            return format_error(f"代码执行失败 (exit_code={exit_code}): {error_detail}")

        output = stdout or "（代码执行完毕，无输出）"
        return format_success({
            "output": output,
            "code": code,
            "stderr": stderr if stderr else None,
        })
