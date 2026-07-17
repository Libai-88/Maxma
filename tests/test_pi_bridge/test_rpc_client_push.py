"""Coverage push tests for api/pi_bridge/rpc_client.py.

Targets previously uncovered lines:
- Lines 161-162: if self._running: logger.exception(...) in _read_loop crash
"""

from __future__ import annotations

import asyncio
import logging

import pytest

from api.pi_bridge.rpc_client import JsonRpcClient


@pytest.mark.asyncio
async def test_read_loop_logs_exception_when_running(caplog):
    """Lines 161-162: when _read_loop encounters an unexpected exception
    (not EOF) while self._running is True, it logs the exception."""
    # Create a mock stdout that raises on readline (not returning empty bytes)
    class CrashStdout:
        async def readline(self):
            raise RuntimeError("stdout readline crashed")

    # Create a mock stdin (not used in this test but needed for __init__)
    class MockStdin:
        def write(self, data):
            pass

        async def drain(self):
            pass

    client = JsonRpcClient(MockStdin(), CrashStdout())
    client._running = True

    with caplog.at_level(logging.ERROR):
        # Start the read loop — it will crash immediately
        client._read_task = asyncio.create_task(client._read_loop())
        # Wait for the task to complete (it should crash and exit)
        await asyncio.sleep(0.1)

    # The exception should have been logged (lines 161-162)
    assert any("read loop crashed" in r.message or "read loop" in str(r.exc_info or "") for r in caplog.records)
    # _running should be False after the crash
    assert client._running is False
