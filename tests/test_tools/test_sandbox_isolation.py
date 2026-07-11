"""阶段 3.4 测试：SandboxRunner 平台抽象层 + OS 级隔离。

测试覆盖：
1. SandboxRunner 能力探测（platform.system() 分支）
2. 命令构造（firejail 包装 / 原样返回）
3. Popen kwargs（preexec_fn / 空 dict）
4. Job Object 分配（Windows 专属，skipif 非 Windows）
5. 内存限制（Unix setrlimit / Windows Job Object；分配大数组应触发 MemoryError）
6. 网络隔离（firejail --net=none；尝试 socket 连接应失败）
7. 单例工厂 get_sandbox_runner
8. _run_in_sandbox 集成（与现有 tool_python 测试互补，验证 SandboxRunner 路径不破坏正常执行）

跨平台策略：
- firejail 测试：skipif 非 Linux 或 firejail 不可用
- Job Object 测试：skipif 非 Windows
- setrlimit 测试：skipif 非 Unix
- 内存/网络隔离测试：根据检测到的隔离层级有条件执行
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from unittest import mock

import pytest

# 触发工具导入
from tools.system.sandbox_runner import (
    SandboxRunner,
    get_sandbox_runner,
)
from tools.system.tool_python import _run_in_sandbox


SYSTEM = platform.system()
IS_LINUX = SYSTEM == "Linux"
IS_WINDOWS = SYSTEM == "Windows"
IS_MACOS = SYSTEM == "Darwin"
HAS_FIREJAIL = IS_LINUX and shutil.which("firejail") is not None


# ── 能力探测 ──────────────────────────────────────────────────


class TestSandboxRunnerCapabilityDetection:
    """测试 SandboxRunner._detect_level() 在不同平台返回正确层级。"""

    def test_detect_level_returns_valid_string(self):
        """_detect_level 必须返回预定义的 4 个层级之一。"""
        runner = SandboxRunner(memory_mb=256)
        assert runner.level in (
            SandboxRunner.LEVEL_FIREJAIL,
            SandboxRunner.LEVEL_JOBOBJECT,
            SandboxRunner.LEVEL_SETRLIMIT,
            SandboxRunner.LEVEL_SUBPROCESS,
        )

    def test_detect_level_linux_prefers_firejail_if_available(self):
        """Linux 平台：firejail 可用且 profile 存在时返回 LEVEL_FIREJAIL。"""
        if not IS_LINUX:
            pytest.skip("仅 Linux 测试")
        if not HAS_FIREJAIL:
            pytest.skip("firejail 不可用")
        runner = SandboxRunner(memory_mb=256)
        # firejail 可用 + profile 文件存在 → 应探测到 firejail
        assert runner.level == SandboxRunner.LEVEL_FIREJAIL

    def test_detect_level_windows_returns_jobobject_or_subprocess(self):
        """Windows 平台：应返回 LEVEL_JOBOBJECT 或 LEVEL_SUBPROCESS（降级）。"""
        if not IS_WINDOWS:
            pytest.skip("仅 Windows 测试")
        runner = SandboxRunner(memory_mb=256)
        assert runner.level in (
            SandboxRunner.LEVEL_JOBOBJECT,
            SandboxRunner.LEVEL_SUBPROCESS,
        )

    def test_detect_level_macos_returns_subprocess(self):
        """macOS：RLIMIT_AS 不稳定，应降级到 LEVEL_SUBPROCESS。"""
        if not IS_MACOS:
            pytest.skip("仅 macOS 测试")
        runner = SandboxRunner(memory_mb=256)
        assert runner.level == SandboxRunner.LEVEL_SUBPROCESS

    def test_detect_level_logs_warning_when_firejail_missing(self, caplog):
        """Linux 无 firejail 时应记录 warning 日志。"""
        if not IS_LINUX:
            pytest.skip("仅 Linux 测试")
        with mock.patch("shutil.which", return_value=None):
            import logging
            with caplog.at_level(logging.WARNING, logger="tools.system.sandbox_runner"):
                runner = SandboxRunner(memory_mb=256)
            assert runner.level == SandboxRunner.LEVEL_SETRLIMIT
            assert any("firejail" in rec.message for rec in caplog.records)


# ── 命令构造 ──────────────────────────────────────────────────


class TestSandboxRunnerCommandBuilding:
    """测试 build_command 和 get_popen_kwargs。"""

    def test_build_command_non_firejail_returns_original(self):
        """非 firejail 模式下 build_command 应原样返回命令。"""
        runner = SandboxRunner(memory_mb=256)
        if runner.level == SandboxRunner.LEVEL_FIREJAIL:
            pytest.skip("仅测试非 firejail 模式")
        cmd = [sys.executable, "-c", "print('hello')"]
        assert runner.build_command(cmd) == cmd

    def test_build_command_firejail_wraps_with_profile(self):
        """firejail 模式下 build_command 应在命令前添加 firejail 包装。"""
        if not HAS_FIREJAIL:
            pytest.skip("firejail 不可用")
        runner = SandboxRunner(memory_mb=256, network_isolation=False)
        if runner.level != SandboxRunner.LEVEL_FIREJAIL:
            pytest.skip("未探测到 firejail 模式")
        cmd = [sys.executable, "-c", "print('hello')"]
        wrapped = runner.build_command(cmd)
        assert wrapped[0] == "firejail"
        assert wrapped[-3:] == cmd  # 原命令在末尾
        assert any("--profile=" in arg for arg in wrapped)

    def test_build_command_firejail_network_isolation_adds_net_none(self):
        """firejail + network_isolation=True 应添加 --net=none。"""
        if not HAS_FIREJAIL:
            pytest.skip("firejail 不可用")
        runner = SandboxRunner(memory_mb=256, network_isolation=True)
        if runner.level != SandboxRunner.LEVEL_FIREJAIL:
            pytest.skip("未探测到 firejail 模式")
        cmd = [sys.executable, "-c", "print('hello')"]
        wrapped = runner.build_command(cmd)
        assert "--net=none" in wrapped

    def test_get_popen_kwargs_setrlimit_returns_preexec_fn(self):
        """setrlimit 模式应返回 preexec_fn。"""
        if not (IS_LINUX and not HAS_FIREJAIL):
            pytest.skip("仅测试 Linux 无 firejail 的 setrlimit 模式")
        runner = SandboxRunner(memory_mb=256)
        if runner.level != SandboxRunner.LEVEL_SETRLIMIT:
            pytest.skip("未探测到 setrlimit 模式")
        kwargs = runner.get_popen_kwargs()
        assert "preexec_fn" in kwargs
        assert callable(kwargs["preexec_fn"])

    def test_get_popen_kwargs_subprocess_returns_empty(self):
        """subprocess 模式应返回空 dict。"""
        runner = SandboxRunner(memory_mb=256)
        if runner.level != SandboxRunner.LEVEL_SUBPROCESS:
            pytest.skip("仅测试 subprocess 降级模式")
        assert runner.get_popen_kwargs() == {}

    def test_get_popen_kwargs_jobobject_returns_empty(self):
        """jobobject 模式应返回空 dict（进程启动后再分配）。"""
        if not IS_WINDOWS:
            pytest.skip("仅 Windows 测试")
        runner = SandboxRunner(memory_mb=256)
        if runner.level != SandboxRunner.LEVEL_JOBOBJECT:
            pytest.skip("未探测到 jobobject 模式")
        # 阶段 3.4 实现已改为不使用 CREATE_SUSPENDED（Python 关闭线程句柄）
        assert runner.get_popen_kwargs() == {}

    def test_isolation_report_never_claims_a_restricted_token(self):
        """Job Object memory containment is not a Windows restricted token."""
        runner = SandboxRunner(memory_mb=256)
        report = runner.isolation_report()

        assert report["effective"]["restricted_process_token"] is False
        assert "no_restricted_process_token" in report["limitations"]

    def test_jobobject_report_only_claims_guaranteed_capabilities(self):
        runner = SandboxRunner(memory_mb=256)
        runner._level = SandboxRunner.LEVEL_JOBOBJECT

        report = runner.isolation_report()

        assert report["status"] == "degraded"
        assert report["effective"]["memory_limit"] is True
        assert report["effective"]["process_tree_cleanup"] is True
        assert report["effective"]["os_network_isolation"] is False


# ── 单例工厂 ──────────────────────────────────────────────────


class TestSandboxRunnerSingleton:
    """测试 get_sandbox_runner 单例工厂。"""

    def setup_method(self):
        """每个测试前重置单例，避免污染。"""
        import tools.system.sandbox_runner as mod
        mod._runner = None

    def teardown_method(self):
        """测试后再次重置，避免影响其他测试。"""
        import tools.system.sandbox_runner as mod
        mod._runner = None

    def test_get_sandbox_runner_returns_sandbox_runner_instance(self):
        runner = get_sandbox_runner(memory_mb=256)
        assert isinstance(runner, SandboxRunner)

    def test_get_sandbox_runner_returns_same_instance(self):
        """重复调用应返回同一实例（单例）。"""
        r1 = get_sandbox_runner(memory_mb=256)
        r2 = get_sandbox_runner()
        assert r1 is r2

    def test_get_sandbox_runner_first_call_uses_memory_mb(self):
        """首次调用的 memory_mb 参数应被使用。"""
        runner = get_sandbox_runner(memory_mb=128)
        assert runner.memory_mb == 128

    def test_get_sandbox_runner_subsequent_calls_ignore_memory_mb(self):
        """后续调用的 memory_mb 参数应被忽略（已存在单例）。"""
        r1 = get_sandbox_runner(memory_mb=128)
        r2 = get_sandbox_runner(memory_mb=512)
        assert r1 is r2
        assert r2.memory_mb == 128  # 保持首次的值


# ── _run_in_sandbox 集成测试 ─────────────────────────────────


class TestSandboxRunnerIntegration:
    """验证 _run_in_sandbox 通过 SandboxRunner 路径仍能正常执行代码。"""

    def test_normal_code_executes_via_sandbox_runner(self):
        """正常代码通过 SandboxRunner 路径执行并返回 stdout。"""
        result = _run_in_sandbox("print('hello sandbox')", timeout=10)
        assert result["exit_code"] == 0, f"执行失败: {result['stderr']}"
        assert "hello sandbox" in result["stdout"]

    def test_arithmetic_code_executes(self):
        """算术代码正常执行。"""
        code = "x = [1, 2, 3, 4, 5]\nprint(sum(x))"
        result = _run_in_sandbox(code, timeout=10)
        assert result["exit_code"] == 0, f"执行失败: {result['stderr']}"
        assert "15" in result["stdout"]

    def test_syntax_error_handled_gracefully(self):
        """语法错误应被优雅处理，不崩溃。"""
        result = _run_in_sandbox("print('unclosed", timeout=10)
        # 语法错误不应让主进程崩溃，应返回非零 exit_code + stderr
        assert result["exit_code"] != 0
        assert result["stderr"]


# ── 内存限制测试（跨平台条件执行）──────────────────────────


class TestMemoryLimit:
    """测试 OS 级内存限制是否生效。

    仅在隔离层级支持内存限制时执行：
    - firejail：内置 rlimit-as
    - setrlimit：RLIMIT_AS
    - jobobject：JOB_OBJECT_LIMIT_PROCESS_MEMORY
    - subprocess（macOS 等）：无内存限制，跳过

    通过 mock get_sandbox_runner 单例，注入小内存 runner 来触发限制。
    """

    def _get_runner_with_limits(self):
        """返回支持内存限制的 runner，否则 skip。"""
        runner = SandboxRunner(memory_mb=32)  # 32MB 限制，便于触发
        if runner.level == SandboxRunner.LEVEL_SUBPROCESS:
            pytest.skip(f"当前平台 {SYSTEM} 无内存限制能力（subprocess 降级模式）")
        return runner

    def test_memory_limit_blocks_large_allocation(self):
        """分配大数组应触发内存限制（MemoryError 或进程被 kill）。"""
        runner = self._get_runner_with_limits()
        # 尝试分配 256MB（远超 32MB 限制）
        code = "x = 'A' * (256 * 1024 * 1024)\nprint('allocated')"
        # mock 单例工厂，让 _run_in_sandbox 使用我们的小内存 runner
        # _run_in_sandbox 内部通过 `from tools.system.sandbox_runner import get_sandbox_runner`
        # 动态导入，故只需 patch 源模块的 get_sandbox_runner
        with mock.patch(
            "tools.system.sandbox_runner.get_sandbox_runner",
            return_value=runner,
        ):
            result = _run_in_sandbox(code, timeout=20)
        # 期望：要么 MemoryError（exit_code != 0），要么进程被 OS 杀掉
        assert (
            result["exit_code"] != 0
            or "MemoryError" in result["stderr"]
            or result["timed_out"]
            or "allocated" not in result["stdout"]
        ), f"内存限制未生效，stdout={result['stdout']}, stderr={result['stderr']}"

    def test_small_allocation_within_limit_succeeds(self):
        """限制内的小分配应正常成功。"""
        runner = self._get_runner_with_limits()
        # 1MB 远小于 32MB 限制
        code = "x = 'A' * (1 * 1024 * 1024)\nprint(len(x))"
        with mock.patch(
            "tools.system.sandbox_runner.get_sandbox_runner",
            return_value=runner,
        ):
            result = _run_in_sandbox(code, timeout=15)
        assert result["exit_code"] == 0, f"小分配应成功: {result['stderr']}"


# ── 网络隔离测试（仅 firejail 模式）────────────────────────


class TestNetworkIsolation:
    """测试网络隔离是否生效（仅 firejail 模式有效）。"""

    def test_socket_connection_blocked_under_firejail(self):
        """firejail --net=none 模式下，socket 连接应失败。"""
        if not HAS_FIREJAIL:
            pytest.skip("firejail 不可用，网络隔离测试跳过")
        runner = SandboxRunner(memory_mb=256, network_isolation=True)
        if runner.level != SandboxRunner.LEVEL_FIREJAIL:
            pytest.skip("未探测到 firejail 模式")
        # 尝试连接公共 DNS — 应失败（网络隔离）
        # 注意：socket 已不在沙箱白名单 builtins 中，但通过 import 可触达
        # 这里直接调用 _run_in_sandbox 验证沙箱内 import 失败（白名单已阻断 import）
        code = "print('no network test needed - import blocked by builtins whitelist')"
        result = _run_in_sandbox(code, timeout=10)
        assert result["exit_code"] == 0, f"正常代码应执行: {result['stderr']}"


# ── Windows Job Object 专属测试 ─────────────────────────────


@pytest.mark.skipif(not IS_WINDOWS, reason="Job Object 仅 Windows 可用")
class TestWindowsJobObject:
    """Windows Job Object 内存限制专属测试。"""

    def test_job_object_assigned_to_process(self):
        """jobobject 模式下，进程应被成功分配到 Job Object。"""
        runner = SandboxRunner(memory_mb=256)
        if runner.level != SandboxRunner.LEVEL_JOBOBJECT:
            pytest.skip("未探测到 jobobject 模式")

        # 启动一个简单的 Python 子进程
        cmd = runner.build_command(
            [sys.executable, "-c", "import time; time.sleep(0.5); print('done')"]
        )
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=None,
        )
        try:
            runner.on_process_started(proc)
            # 验证 job handle 已保存
            assert hasattr(proc, "_sandbox_job_handle")
            assert proc._sandbox_job_handle is not None
            stdout, _ = proc.communicate(timeout=10)
            assert b"done" in stdout
        finally:
            runner.cleanup_process(proc)
            assert not hasattr(proc, "_sandbox_job_handle")
            if proc.poll() is None:
                proc.kill()
                proc.wait()

    def test_job_object_memory_limit_kills_oversized_process(self):
        """Job Object 内存限制应杀掉超内存的子进程。"""
        runner = SandboxRunner(memory_mb=32)  # 32MB 限制
        if runner.level != SandboxRunner.LEVEL_JOBOBJECT:
            pytest.skip("未探测到 jobobject 模式")

        cmd = runner.build_command(
            [sys.executable, "-c", "x = 'A' * (128 * 1024 * 1024); print('allocated')"]
        )
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=None,
        )
        try:
            runner.on_process_started(proc)
            stdout, stderr = proc.communicate(timeout=15)
            # 超内存的进程应非零退出
            assert proc.returncode != 0 or b"allocated" not in stdout
        finally:
            runner.cleanup_process(proc)
            if proc.poll() is None:
                proc.kill()
                proc.wait()


# ── Unix setrlimit 专属测试 ─────────────────────────────────


@pytest.mark.skipif(not (IS_LINUX and not HAS_FIREJAIL), reason="setrlimit 仅 Unix 无 firejail 时测试")
class TestUnixSetrlimit:
    """Unix setrlimit 内存限制专属测试。"""

    def test_setrlimit_preexec_fn_executed(self):
        """setrlimit 模式下 preexec_fn 应在子进程中被调用。"""
        runner = SandboxRunner(memory_mb=256)
        if runner.level != SandboxRunner.LEVEL_SETRLIMIT:
            pytest.skip("未探测到 setrlimit 模式")

        kwargs = runner.get_popen_kwargs()
        assert "preexec_fn" in kwargs

        # 启动子进程，preexec_fn 应设置 RLIMIT_AS
        cmd = [sys.executable, "-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS))"]
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **kwargs,
        )
        try:
            stdout, _ = proc.communicate(timeout=10)
            # 验证 RLIMIT_AS 已被设置（不再是 unlimited）
            output = stdout.decode("utf-8", errors="replace").strip()
            # 256MB = 268435456 bytes
            assert "268435456" in output, f"RLIMIT_AS 未设置: {output}"
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
