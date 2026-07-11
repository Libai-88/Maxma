"""SandboxRunner — OS 级沙箱隔离平台抽象层（阶段 3.4）。

在现有 subprocess + builtins 白名单 + AST 变换基础上，按平台叠加可用的
OS 资源限制。网络和文件系统的 OS 级隔离只在 firejail 可用时成立；其他
平台必须通过 ``isolation_report()`` 如实报告降级能力。

能力探测 + 优雅降级链：
    firejail (Linux) → setrlimit (Unix) → Job Object (Windows) → 纯 subprocess

每个降级层级在日志中明确告警。

跨平台内存限制（MAX_MEMORY_MB 真正生效）：
- Linux: firejail 内置内存限制 + resource.setrlimit(RLIMIT_AS)
- Unix (通用): resource.setrlimit(RLIMIT_AS)
- Windows: Job Object (JOB_OBJECT_LIMIT_PROCESS_MEMORY) via ctypes
- macOS: RLIMIT_AS 可能导致 Python 自身崩溃，降级到无内存限制

使用方式：
    runner = SandboxRunner(memory_mb=512, network_isolation=True)
    cmd = runner.build_command([sys.executable, "-c", wrapper_code])
    kwargs = runner.get_popen_kwargs()
    proc = subprocess.Popen(cmd, **kwargs, ...)
    runner.on_process_started(proc)  # Windows Job Object 模式下分配进程
    stdout, stderr = proc.communicate(...)
    runner.cleanup_process(proc)
"""

from __future__ import annotations

import logging
import platform
import shutil
import subprocess
import threading
from pathlib import Path

logger = logging.getLogger(__name__)


class SandboxRunner:
    """OS 级沙箱隔离平台抽象层。

    按平台能力选择最强可用的隔离方案，构造带资源限制的子进程命令。
    所有方法均为线程安全（无共享可变状态）。
    """

    # 隔离层级（从强到弱）
    LEVEL_FIREJAIL = "firejail"
    LEVEL_JOBOBJECT = "jobobject"
    LEVEL_SETRLIMIT = "setrlimit"
    LEVEL_SUBPROCESS = "subprocess"

    # Windows Job Object 常量（通过 ctypes 调用，避免 pywin32 依赖）
    _JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    _JobObjectExtendedLimitInformation = 9

    def __init__(
        self,
        memory_mb: int = 512,
        network_isolation: bool = True,
        firejail_profile: str | None = None,
    ):
        """初始化沙箱运行器。

        Args:
            memory_mb: 最大内存限制（MB）
            network_isolation: 是否启用网络隔离
            firejail_profile: firejail profile 文件路径（None 则使用默认路径）
        """
        self.memory_mb = memory_mb
        self.network_isolation = network_isolation
        self._firejail_profile = firejail_profile or str(
            Path(__file__).parent / "firejail.profile"
        )
        self._level = self._detect_level()
        logger.info(
            "SandboxRunner: isolation=%s, memory=%dMB, network_isolation=%s",
            self._level, memory_mb, network_isolation,
        )

    @property
    def level(self) -> str:
        """当前隔离层级。"""
        return self._level

    # ── 能力探测 ──────────────────────────────────────────────

    def _detect_level(self) -> str:
        """探测当前平台可用的最强隔离方案。"""
        system = platform.system()

        if system == "Linux":
            if shutil.which("firejail"):
                profile = Path(self._firejail_profile)
                if profile.exists():
                    return self.LEVEL_FIREJAIL
                logger.warning(
                    "firejail 可用但 profile 文件不存在: %s，降级到 setrlimit",
                    self._firejail_profile,
                )
            else:
                logger.warning("firejail 不可用，降级到 setrlimit（仅内存限制）")
            return self.LEVEL_SETRLIMIT

        if system == "Windows":
            try:
                import ctypes
                kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
                if hasattr(kernel32, "CreateJobObjectW"):
                    return self.LEVEL_JOBOBJECT
            except (AttributeError, OSError):
                pass
            logger.warning(
                "Windows Job Object 不可用（ctypes.windll 失败），"
                "降级到纯 subprocess（无内存限制）"
            )
            return self.LEVEL_SUBPROCESS

        # macOS: RLIMIT_AS 可能导致 Python 自身崩溃
        if system == "Darwin":
            logger.warning(
                "macOS 不支持可靠的 RLIMIT_AS（可能导致 Python 崩溃），"
                "降级到纯 subprocess（无内存限制）"
            )
            return self.LEVEL_SUBPROCESS

        # 其他 Unix 平台
        logger.warning("未知平台 %s，尝试 setrlimit", system)
        return self.LEVEL_SETRLIMIT

    # ── 命令构造 ──────────────────────────────────────────────

    def build_command(self, cmd: list[str]) -> list[str]:
        """构造带 OS 级隔离包装的命令。

        firejail 模式下在命令前添加 firejail 包装；其他模式原样返回。

        Args:
            cmd: 原始命令列表（如 [sys.executable, "-c", wrapper_code]）

        Returns:
            包装后的命令列表
        """
        if self._level == self.LEVEL_FIREJAIL:
            firejail_cmd = ["firejail", "--quiet"]
            if self.network_isolation:
                firejail_cmd.append("--net=none")
            firejail_cmd.extend([
                f"--profile={self._firejail_profile}",
                "--noprofile",  # 不加载默认 profile，仅使用我们的 profile
            ])
            return firejail_cmd + cmd
        return cmd

    def get_popen_kwargs(self) -> dict:
        """获取 subprocess.Popen 需要的额外 kwargs。

        - setrlimit 模式: 返回 preexec_fn（fork 后、exec 前设置 RLIMIT_AS）
        - jobobject 模式: 返回空 dict（进程启动后再分配到 Job Object）
        - 其他: 返回空 dict

        Windows Job Object 不使用 CREATE_SUSPENDED：subprocess.Popen 在
        CreateProcess 后立即关闭线程句柄，无法 ResumeThread；改为进程
        启动后立即 AssignProcessToJobObject（Windows 8+ 支持）。

        Returns:
            Popen kwargs dict，可直接 **unpack 传给 subprocess.Popen
        """
        if self._level == self.LEVEL_SETRLIMIT:
            return {"preexec_fn": self._make_preexec_fn()}
        return {}

    def isolation_report(self) -> dict[str, object]:
        """Report guarantees actually established by this runner.

        Job Objects provide resource containment and child-process cleanup, but
        they do not by themselves create a restricted token or block network
        access.  Callers can surface this report without overstating isolation.
        """
        memory_limited = self._level in {
            self.LEVEL_FIREJAIL,
            self.LEVEL_SETRLIMIT,
            self.LEVEL_JOBOBJECT,
        }
        process_tree_cleanup = self._level == self.LEVEL_JOBOBJECT
        os_network_isolated = (
            self._level == self.LEVEL_FIREJAIL and self.network_isolation
        )
        limitations: list[str] = []
        if not os_network_isolated:
            limitations.append("no_os_network_isolation")
        if self._level != self.LEVEL_FIREJAIL:
            limitations.append("no_os_filesystem_isolation")
        if self._level != self.LEVEL_JOBOBJECT:
            limitations.append("no_windows_job_cleanup")
        # A restricted Windows token needs a carefully designed identity and
        # ACL model.  Until that exists, reporting false is safer than a partial
        # ctypes implementation that can lock users out or appear secure.
        limitations.append("no_restricted_process_token")
        return {
            "status": "ok" if self._level == self.LEVEL_FIREJAIL else "degraded",
            "level": self._level,
            "effective": {
                "memory_limit": memory_limited,
                "process_tree_cleanup": process_tree_cleanup,
                "os_network_isolation": os_network_isolated,
                "restricted_process_token": False,
            },
            "limitations": limitations,
        }

    # ── Unix: resource.setrlimit ─────────────────────────────

    def _make_preexec_fn(self):
        """构造 Unix preexec_fn（在 fork 后、exec 前调用）。

        限制进程虚拟内存地址空间（RLIMIT_AS），超过则触发 MemoryError。
        """
        # resource 仅 Unix 可用，延迟导入避免 Windows 上模块加载失败
        import resource
        mem_bytes = self.memory_mb * 1024 * 1024

        def _set_limits():
            try:
                resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
            except (ValueError, OSError) as e:
                logger.warning("setrlimit(RLIMIT_AS, %d) 失败: %s", mem_bytes, e)

        return _set_limits

    # ── Windows: Job Object ──────────────────────────────────

    def on_process_started(self, proc: subprocess.Popen) -> None:
        """进程启动后的 hook。

        Windows Job Object 模式下：分配进程到 Job Object（含内存限制）。
        其他模式下：空操作。

        必须在 subprocess.Popen 返回后、communicate() 之前调用。

        Args:
            proc: subprocess.Popen 创建的进程对象
        """
        if self._level != self.LEVEL_JOBOBJECT:
            return

        try:
            self._assign_to_job_object(proc)
        except Exception as e:
            logger.error("Job Object 分配失败: %s，终止进程", e)
            try:
                proc.kill()
            except Exception:
                pass
            raise

    def _assign_to_job_object(self, proc: subprocess.Popen) -> None:
        """将进程分配到 Job Object 并设置内存限制。

        进程已启动（未挂起），立即分配到 Job Object。Windows 8+ 支持为
        已启动的进程分配 Job Object。Python subprocess 在 CreateProcess 后
        立即关闭线程句柄，故无法用 CREATE_SUSPENDED + ResumeThread 模式。
        """
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

        # ── 定义 Windows API 结构体 ──────────────────────────

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_int64),
                ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_uint64),
                ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32),
            ]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        # ── 1. 创建 Job Object ───────────────────────────────
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]

        job_handle = kernel32.CreateJobObjectW(None, None)
        if not job_handle:
            raise ctypes.WinError()  # type: ignore[attr-defined]

        try:
            # ── 2. 设置内存限制 ──────────────────────────────
            mem_bytes = self.memory_mb * 1024 * 1024
            info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            info.BasicLimitInformation.LimitFlags = (
                self._JOB_OBJECT_LIMIT_PROCESS_MEMORY
                | self._JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            )
            info.ProcessMemoryLimit = mem_bytes
            info.JobMemoryLimit = mem_bytes

            kernel32.SetInformationJobObject.restype = wintypes.BOOL
            kernel32.SetInformationJobObject.argtypes = [
                wintypes.HANDLE,    # Job handle
                ctypes.c_int32,     # InfoClass
                ctypes.c_void_p,    # Info
                wintypes.DWORD,     # Info length
            ]

            if not kernel32.SetInformationJobObject(
                job_handle,
                self._JobObjectExtendedLimitInformation,
                ctypes.byref(info),
                ctypes.sizeof(info),
            ):
                raise ctypes.WinError()  # type: ignore[attr-defined]

            # ── 3. 分配进程到 Job Object ────────────────────
            # subprocess.Popen._handle 是进程句柄（Windows 8+ 支持为已启动进程分配 Job Object）
            process_handle = proc._handle  # type: ignore[attr-defined]
            kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
            kernel32.AssignProcessToJobObject.argtypes = [
                wintypes.HANDLE,  # Job handle
                wintypes.HANDLE,  # Process handle
            ]

            if not kernel32.AssignProcessToJobObject(job_handle, process_handle):
                raise ctypes.WinError()  # type: ignore[attr-defined]

        except Exception:
            # 出错时关闭 job handle，避免资源泄漏
            kernel32.CloseHandle(job_handle)
            raise

        # 保存 job_handle 防止 GC（进程结束时 OS 自动清理 job）
        proc._sandbox_job_handle = job_handle  # type: ignore[attr-defined]

    def cleanup_process(self, proc: subprocess.Popen) -> None:
        """Release per-process OS isolation resources after process completion.

        Closing a Windows Job Object configured with KILL_ON_JOB_CLOSE removes
        any surviving child processes.  This must run after ``communicate`` so
        normal output collection is unaffected.
        """
        job_handle = getattr(proc, "_sandbox_job_handle", None)
        if not job_handle:
            return
        try:
            import ctypes

            ctypes.windll.kernel32.CloseHandle(job_handle)  # type: ignore[attr-defined]
        except (AttributeError, OSError):
            logger.warning("Unable to close Windows sandbox Job Object", exc_info=True)
        finally:
            try:
                delattr(proc, "_sandbox_job_handle")
            except AttributeError:
                pass


# ── 模块级单例 ────────────────────────────────────────────────

_runner: SandboxRunner | None = None
_runner_lock = threading.Lock()  # 保护单例初始化


def get_sandbox_runner(
    memory_mb: int | None = None,
    network_isolation: bool | None = None,
) -> SandboxRunner:
    """获取全局 SandboxRunner 单例。

    首次调用时执行能力探测，后续调用复用同一实例。
    参数从 config.settings 读取（除非显式传入）。

    线程安全：通过 _runner_lock 双重检查，保证仅创建一个实例。
    注意：首次调用传入的参数决定单例配置，后续调用的参数被忽略（与原行为一致）。
    """
    global _runner
    if _runner is not None:
        return _runner
    with _runner_lock:
        if _runner is not None:
            return _runner
        # 从配置读取默认值
        try:
            from config.settings import get_settings
            settings = get_settings()
            if memory_mb is None:
                memory_mb = settings.sandbox_memory_mb
            if network_isolation is None:
                network_isolation = settings.sandbox_network_isolation
        except Exception:
            # 配置读取失败时使用代码默认值
            if memory_mb is None:
                memory_mb = 512
            if network_isolation is None:
                network_isolation = True

        _runner = SandboxRunner(
            memory_mb=memory_mb,
            network_isolation=network_isolation,
        )
        return _runner
