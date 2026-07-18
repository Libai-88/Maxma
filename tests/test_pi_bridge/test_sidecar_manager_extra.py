"""补充测试 — api/pi_bridge/sidecar_manager.py 生命周期 + bun 路径解析。

通过 monkeypatch asyncio.create_subprocess_exec 和 JsonRpcClient 来
覆盖 start/stop/restart/_forward_stderr 的所有分支，不启动真实子进程。
"""

import asyncio
import logging
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.pi_bridge import sidecar_manager as sm_mod
from api.pi_bridge.sidecar_manager import (
    _DEFAULT_BUN_PATH,
    _resolve_bun_path,
    SidecarManager,
)


# ---------------------------------------------------------------------------
# _resolve_bun_path
# ---------------------------------------------------------------------------


class TestResolveBunPath:
    def test_meipass_returns_bundled_bun_when_exists(self, monkeypatch, tmp_path):
        # 模拟 PyInstaller 打包环境
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        bundled = tmp_path / "bun-sidecar" / "bun.exe"
        bundled.parent.mkdir(parents=True)
        bundled.write_text("fake")
        assert _resolve_bun_path() == str(bundled)

    def test_meipass_falls_back_when_bundled_missing(self, monkeypatch, tmp_path):
        # _MEIPASS 存在但 bun.exe 不存在，应走 settings 分支
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)

        class FakeSettings:
            sidecar_bun_path = "from-settings"
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _resolve_bun_path() == "from-settings"

    def test_settings_returns_value_when_no_meipass(self, monkeypatch):
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)

        class FakeSettings:
            sidecar_bun_path = "/custom/bun"
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _resolve_bun_path() == "/custom/bun"

    def test_settings_empty_returns_default(self, monkeypatch):
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)

        class FakeSettings:
            sidecar_bun_path = ""
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _resolve_bun_path() == _DEFAULT_BUN_PATH

    def test_settings_none_returns_default(self, monkeypatch):
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)

        class FakeSettings:
            sidecar_bun_path = None
        monkeypatch.setattr(
            "config.settings.get_settings", lambda: FakeSettings()
        )
        assert _resolve_bun_path() == _DEFAULT_BUN_PATH

    def test_settings_raises_returns_default(self, monkeypatch):
        monkeypatch.delattr(sys, "_MEIPASS", raising=False)

        def boom():
            raise RuntimeError("no config")

        monkeypatch.setattr("config.settings.get_settings", boom)
        assert _resolve_bun_path() == _DEFAULT_BUN_PATH

    def test_default_bun_path_is_absolute_or_path_resolvable(self):
        # 默认路径可以是绝对路径，或 "bun"（由 PATH 解析）
        import os
        assert os.path.isabs(_DEFAULT_BUN_PATH) or _DEFAULT_BUN_PATH == "bun"


# ---------------------------------------------------------------------------
# 属性
# ---------------------------------------------------------------------------


class TestProperties:
    def test_is_running_false_when_no_process(self):
        mgr = SidecarManager()
        assert mgr.is_running is False

    def test_is_running_true_when_process_returncode_none(self):
        mgr = SidecarManager()
        proc = MagicMock()
        proc.returncode = None
        mgr._process = proc
        assert mgr.is_running is True

    def test_is_running_false_when_process_returncode_set(self):
        mgr = SidecarManager()
        proc = MagicMock()
        proc.returncode = 0
        mgr._process = proc
        assert mgr.is_running is False

    def test_stdin_none_when_no_process(self):
        mgr = SidecarManager()
        assert mgr.stdin is None

    def test_stdin_returns_process_stdin(self):
        mgr = SidecarManager()
        proc = MagicMock()
        proc.stdin = "stdin-obj"
        mgr._process = proc
        assert mgr.stdin == "stdin-obj"

    def test_stdout_none_when_no_process(self):
        mgr = SidecarManager()
        assert mgr.stdout is None

    def test_stdout_returns_process_stdout(self):
        mgr = SidecarManager()
        proc = MagicMock()
        proc.stdout = "stdout-obj"
        mgr._process = proc
        assert mgr.stdout == "stdout-obj"

    def test_client_none_by_default(self):
        mgr = SidecarManager()
        assert mgr.client is None

    def test_client_returns_set_client(self):
        mgr = SidecarManager()
        mgr._client = "client-obj"
        assert mgr.client == "client-obj"


# ---------------------------------------------------------------------------
# start()
# ---------------------------------------------------------------------------


def _make_mock_proc(returncode=None, wait_return=0):
    """构造一个 mock 子进程。"""
    proc = MagicMock()
    proc.pid = 12345
    proc.returncode = returncode
    proc.stdin = MagicMock()
    proc.stdout = MagicMock()
    proc.stderr = MagicMock()
    proc.terminate = MagicMock()
    proc.kill = MagicMock()
    proc.wait = AsyncMock(return_value=wait_return)
    return proc


@pytest.fixture
def patched_subprocess(monkeypatch):
    """monkeypatch asyncio.create_subprocess_exec 和 JsonRpcClient，返回 mock proc + client。"""
    proc = _make_mock_proc()
    mock_client = MagicMock()
    mock_client.start_reading = AsyncMock()
    mock_client.stop = AsyncMock()

    async def fake_create_subprocess_exec(*args, **kwargs):
        return proc

    monkeypatch.setattr(
        sm_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    # 跳过 start() 里的 asyncio.sleep(0.5)
    async def fake_sleep(*args, **kwargs):
        return None
    monkeypatch.setattr(sm_mod.asyncio, "sleep", fake_sleep)
    # 替换 JsonRpcClient 构造
    monkeypatch.setattr(
        sm_mod, "JsonRpcClient", lambda stdin, stdout: mock_client
    )
    return proc, mock_client


class TestStart:
    async def test_start_already_running_is_noop(self, monkeypatch):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None)
        mgr._process = proc
        called = {"exec": False}

        async def fake_create_subprocess_exec(*args, **kwargs):
            called["exec"] = True
            return _make_mock_proc()

        monkeypatch.setattr(
            sm_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
        )
        await mgr.start()
        assert called["exec"] is False
        # _process 仍为原对象
        assert mgr._process is proc

    async def test_start_creates_subprocess_and_client(self, patched_subprocess):
        proc, mock_client = patched_subprocess
        mgr = SidecarManager()

        await mgr.start()

        assert mgr._process is proc
        assert mgr._client is mock_client
        assert mock_client.start_reading.await_count == 1
        # stderr task 被创建
        assert mgr._stderr_task is not None
        # 清理
        await mgr.stop()

    async def test_start_logs_info(self, patched_subprocess, caplog):
        mgr = SidecarManager()
        with caplog.at_level(logging.INFO):
            await mgr.start()
        assert any("Starting sidecar" in r.message for r in caplog.records)
        assert any("Sidecar started" in r.message for r in caplog.records)
        await mgr.stop()


# ---------------------------------------------------------------------------
# stop()
# ---------------------------------------------------------------------------


class TestStop:
    async def test_stop_not_running_is_noop(self, caplog):
        mgr = SidecarManager()
        # _process=None, _client=None
        with caplog.at_level(logging.DEBUG):
            await mgr.stop()
        assert any("not running" in r.message for r in caplog.records)

    async def test_stop_with_client_calls_client_stop(self):
        mgr = SidecarManager()
        mock_client = MagicMock()
        mock_client.stop = AsyncMock()
        mgr._client = mock_client
        mgr._process = None  # not running
        await mgr.stop()
        assert mock_client.stop.await_count == 1
        assert mgr._client is None

    async def test_stop_graceful_terminate(self):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None, wait_return=0)
        mgr._process = proc
        await mgr.stop()
        proc.terminate.assert_called_once()
        proc.kill.assert_not_called()
        assert mgr._process is None
        assert mgr._stderr_task is None

    async def test_stop_timeout_kills_process(self, monkeypatch):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None)

        # 第一次 wait() 抛 TimeoutError，第二次（kill 后）正常返回
        wait_calls = {"count": 0}

        async def fake_wait():
            wait_calls["count"] += 1
            if wait_calls["count"] == 1:
                raise asyncio.TimeoutError()
            return 0

        proc.wait = fake_wait
        mgr._process = proc
        await mgr.stop()
        proc.terminate.assert_called_once()
        proc.kill.assert_called_once()
        assert wait_calls["count"] == 2

    async def test_stop_process_lookup_error_swallowed(self, caplog):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None)
        proc.terminate.side_effect = ProcessLookupError("no such process")
        mgr._process = proc
        # 不应抛异常
        with caplog.at_level(logging.DEBUG):
            await mgr.stop()
        assert any("already exited" in r.message for r in caplog.records)

    async def test_stop_cancels_stderr_task(self, caplog):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None)
        mgr._process = proc

        # 创建一个真实的 stderr 任务
        async def long_stderr_forward():
            try:
                await asyncio.sleep(100)
            except asyncio.CancelledError:
                raise

        mgr._stderr_task = asyncio.create_task(long_stderr_forward())
        with caplog.at_level(logging.DEBUG):
            await mgr.stop()
        assert mgr._stderr_task is None
        assert any(
            "stderr" in r.message.lower() or "cancel" in r.message.lower()
            for r in caplog.records
        )

    async def test_stop_stderr_task_already_done_does_not_await(self):
        mgr = SidecarManager()
        proc = _make_mock_proc(returncode=None)
        mgr._process = proc

        # stderr task 已完成
        async def done_task():
            return None

        mgr._stderr_task = asyncio.create_task(done_task())
        await mgr._stderr_task  # 确保完成
        # 不应抛异常
        await mgr.stop()
        assert mgr._stderr_task is None


# ---------------------------------------------------------------------------
# restart()
# ---------------------------------------------------------------------------


class TestRestart:
    async def test_restart_calls_stop_then_start(self, monkeypatch):
        mgr = SidecarManager()
        order = []

        async def fake_stop():
            order.append("stop")

        async def fake_start():
            order.append("start")

        monkeypatch.setattr(mgr, "stop", fake_stop)
        monkeypatch.setattr(mgr, "start", fake_start)
        await mgr.restart()
        assert order == ["stop", "start"]


# ---------------------------------------------------------------------------
# _forward_stderr()
# ---------------------------------------------------------------------------


class TestForwardStderr:
    async def test_forward_stderr_logs_lines(self, caplog):
        mgr = SidecarManager()
        # 构造一个能产出若干行然后 EOF 的 stderr StreamReader
        stderr = asyncio.StreamReader()

        async def feed():
            stderr.feed_data(b"line one\n")
            stderr.feed_data(b"line two\n")
            stderr.feed_data(b"\xc3\xa9 unicode\n")
            stderr.feed_eof()

        proc = MagicMock()
        proc.stderr = stderr
        mgr._process = proc

        with caplog.at_level(logging.DEBUG):
            feeder = asyncio.create_task(feed())
            await mgr._forward_stderr()
            await feeder

        msgs = [r.message for r in caplog.records]
        assert any("line one" in m for m in msgs)
        assert any("line two" in m for m in msgs)
        assert any("unicode" in m for m in msgs)

    async def test_forward_stderr_skips_empty_lines(self, caplog):
        mgr = SidecarManager()
        stderr = asyncio.StreamReader()

        async def feed():
            stderr.feed_data(b"\n")
            stderr.feed_data(b"real line\n")
            stderr.feed_eof()

        proc = MagicMock()
        proc.stderr = stderr
        mgr._process = proc

        with caplog.at_level(logging.DEBUG):
            feeder = asyncio.create_task(feed())
            await mgr._forward_stderr()
            await feeder

        # 只有 1 条非空日志
        sidecar_msgs = [r for r in caplog.records if "[sidecar]" in r.message]
        assert len(sidecar_msgs) == 1
        assert "real line" in sidecar_msgs[0].message

    async def test_forward_stderr_swallows_exception(self, caplog):
        mgr = SidecarManager()
        proc = MagicMock()
        # stderr 在 readline 时抛异常
        stderr = MagicMock()

        async def boom():
            raise RuntimeError("readline boom")

        stderr.readline = boom
        # async for 需要 __aiter__ / __anext__
        # MagicMock 默认不是 async iterable，构造一个会抛异常的 async iterator
        class _BoomIter:
            def __aiter__(self):
                return self

            async def __anext__(self):
                raise RuntimeError("iter boom")

        proc.stderr = _BoomIter()
        mgr._process = proc

        with caplog.at_level(logging.ERROR):
            # 不应抛异常
            await mgr._forward_stderr()
        assert any("forwarding sidecar stderr" in r.message for r in caplog.records)

    async def test_forward_stderr_handles_invalid_utf8(self, caplog):
        mgr = SidecarManager()
        stderr = asyncio.StreamReader()

        async def feed():
            # 非法 UTF-8 字节，errors='replace' 应不崩
            stderr.feed_data(b"\xff\xfe bad bytes\n")
            stderr.feed_eof()

        proc = MagicMock()
        proc.stderr = stderr
        mgr._process = proc

        with caplog.at_level(logging.DEBUG):
            feeder = asyncio.create_task(feed())
            await mgr._forward_stderr()
            await feeder
        # 至少记录了一行（替换后的字符）
        assert any("[sidecar]" in r.message for r in caplog.records)
