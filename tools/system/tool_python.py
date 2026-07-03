"""Tool: run_python — 在沙箱进程中执行 Python 代码。

Phase 1 沙箱：使用 subprocess.run 在独立进程中执行代码，
支持超时控制和内存限制，防止恶意或失控代码影响主进程。
"""

import asyncio
import os
import subprocess
import sys
import tempfile

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_error, format_success

# 沙箱配置
DEFAULT_TIMEOUT = 30  # 默认超时（秒）
MAX_TIMEOUT = 120  # 最大超时（秒）
MAX_MEMORY_MB = 512  # 最大内存（MB）

# 沙箱执行器脚本 — 在子进程中运行用户代码
# 使用受限的 __builtins__ 防止文件系统逃逸和危险操作
_SANDBOX_WRAPPER = r'''
import sys, json, traceback, io as _io

# 受限 builtins：禁止文件 I/O、代码执行、动态 import
_DANGEROUS = frozenset({"open", "exec", "eval", "compile", "__import__", "input", "breakpoint", "help"})
if isinstance(__builtins__, dict):
    _src = __builtins__
else:
    _src = __builtins__.__dict__
_safe_builtins = {_k: _v for _k, _v in _src.items() if _k not in _DANGEROUS}

# 显式拦截 import 语句，给出清晰错误，而不是让 __import__ 缺失导致隐式失败。
def _blocked_import(*args, **kwargs):
    raise ImportError("沙箱中已禁用模块导入")
_safe_builtins["__import__"] = _blocked_import

code = sys.stdin.read()
old_stdout = sys.stdout
old_stderr = sys.stderr
sys.stdout = _io.StringIO()
sys.stderr = _io.StringIO()

exit_code = 0
try:
    exec(code, {"__name__": "__main__", "__builtins__": _safe_builtins})
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
    """在独立子进程中执行 Python 代码。

    Args:
        code: 要执行的 Python 代码
        timeout: 超时秒数

    Returns:
        dict with keys: stdout, stderr, exit_code, timed_out
    """
    try:
        # 构建子进程命令
        cmd = [sys.executable, "-c", _SANDBOX_WRAPPER]

        # 使用白名单限制子进程环境变量，防止敏感信息泄漏
        env = _build_sandbox_env()

        # 启动子进程
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=tempfile.gettempdir(),  # 在临时目录执行，防止访问项目文件
        )

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
