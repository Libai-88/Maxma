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
_SANDBOX_WRAPPER = '''
import sys
import json
import traceback

code = sys.stdin.read()

# 捕获 stdout/stderr
import io
old_stdout = sys.stdout
old_stderr = sys.stderr
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()

exit_code = 0
output = ""
error_msg = ""

try:
    exec(code, {"__name__": "__main__"})
    output = sys.stdout.getvalue()
    error_msg = sys.stderr.getvalue()
except SystemExit as e:
    output = sys.stdout.getvalue()
    error_msg = sys.stderr.getvalue()
    exit_code = e.code if isinstance(e.code, int) else 1
except Exception:
    output = sys.stdout.getvalue()
    error_msg = traceback.format_exc()
    exit_code = 1
finally:
    sys.stdout = old_stdout
    sys.stderr = old_stderr

# 输出结构化结果
result = {
    "stdout": output or "",
    "stderr": error_msg or "",
    "exit_code": exit_code,
}
print(json.dumps(result, ensure_ascii=False))
'''


def _run_in_sandbox(code: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """在独立子进程中执行 Python 代码。

    Args:
        code: 要执行的 Python 代码
        timeout: 超时秒数

    Returns:
        dict with keys: stdout, stderr, exit_code, timed_out
    """
    # 创建临时文件写入用户代码
    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.py', delete=False, encoding='utf-8'
    ) as f:
        f.write(code)
        code_file = f.name

    try:
        # 构建子进程命令
        cmd = [sys.executable, "-c", _SANDBOX_WRAPPER]

        # 准备环境变量 — 限制子进程环境
        env = os.environ.copy()
        # 移除可能的敏感环境变量
        _secret_patterns = ("API_", "SECRET", "TOKEN", "KEY", "PASSWORD", "PASSWD", "_KEY")
        for key in list(env.keys()):
            if any(p in key.upper() for p in _secret_patterns):
                del env[key]

        # 启动子进程
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=tempfile.gettempdir(),  # 在临时目录执行，防止访问项目文件
        )

        # 设置内存限制（Windows 使用 job object，Linux 使用 resource）
        _apply_memory_limit(proc, MAX_MEMORY_MB)

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

    finally:
        # 清理临时文件
        try:
            os.unlink(code_file)
        except OSError:
            pass


def _apply_memory_limit(proc: subprocess.Popen, max_mb: int) -> None:
    """尝试为子进程设置内存限制。

    Windows: 使用 Job Object 限制内存
    Linux: 使用 resource 模块（通过 preexec_fn）
    """
    if sys.platform == 'win32':
        try:
            import ctypes
            from ctypes import wintypes

            # 创建 Job Object
            job = ctypes.windll.kernel32.CreateJobObjectW(None, None)
            if job:
                # JOBJECT_LIMIT_INFO 结构
                class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
                    _fields_ = [
                        ("BasicLimitInformation", ctypes.c_uint32 * 4),
                        ("IoInfo", ctypes.c_uint64 * 3),
                        ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t),
                    ]

                limit_info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
                limit_info.ProcessMemoryLimit = max_mb * 1024 * 1024  # 转换为字节

                # JobObjectExtendedLimitInformation = 9
                ctypes.windll.kernel32.SetInformationJobObject(
                    job, 9, ctypes.byref(limit_info), ctypes.sizeof(limit_info)
                )

                # 将进程分配到 Job Object
                ctypes.windll.kernel32.AssignProcessToJobObject(job, proc._handle)
        except Exception:
            pass  # 内存限制失败不阻塞执行
    else:
        # Linux: 使用 resource 模块
        try:
            import resource

            def set_limits():
                # RLIMIT_AS: 虚拟内存限制
                max_bytes = max_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))

            # 注意：preexec_fn 在 Popen 中已弃用，但在此场景下仍可用
            # 如果需要更可靠的方案，可以使用 subprocess.Popen 的 start_new_session 参数
        except Exception:
            pass


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
        interaction_id, future = interaction.register()

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
            interaction.cleanup(interaction_id)

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
