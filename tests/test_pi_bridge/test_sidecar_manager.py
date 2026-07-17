"""Tests for silent-except logging in api/pi_bridge/sidecar_manager.py."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.pi_bridge.sidecar_manager import SidecarManager


@pytest.mark.asyncio
async def test_stop_logs_debug_when_stderr_task_cancelled(caplog):
    """stop() should log debug when the stderr forwarding task is cancelled."""
    mgr = SidecarManager.__new__(SidecarManager)
    mgr._lock = asyncio.Lock()
    mgr._client = None
    mgr._process = None
    mgr._stderr_task = None

    # Set up a real stderr task that will be cancelled
    async def mock_stderr_forward():
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            raise

    mgr._stderr_task = asyncio.create_task(mock_stderr_forward())

    # Mock process for termination phase — returncode=None so is_running is True
    mock_proc = MagicMock()
    mock_proc.pid = 12345
    mock_proc.returncode = None
    mock_proc.terminate = MagicMock()
    mock_proc.wait = AsyncMock(return_value=0)
    mock_proc.kill = MagicMock()
    mgr._process = mock_proc

    with caplog.at_level(logging.DEBUG):
        await mgr.stop()

    assert any(
        "stderr" in r.message.lower() or "cancel" in r.message.lower()
        for r in caplog.records
    )
    assert mgr._stderr_task is None
