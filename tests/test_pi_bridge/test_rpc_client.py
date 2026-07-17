"""Tests for silent-except logging in api/pi_bridge/rpc_client.py."""

import asyncio
import logging
from unittest.mock import MagicMock

import pytest

from api.pi_bridge.rpc_client import JsonRpcClient


def _make_client():
    """Create a JsonRpcClient with mock stdin/stdout."""
    stdin = MagicMock()
    stdout = MagicMock()
    client = JsonRpcClient(stdin, stdout)
    return client


def test_unsubscribe_logs_debug_when_handler_not_found(caplog):
    """_unsubscribe should log debug when handler is not in the list (ValueError)."""
    client = _make_client()

    def handler(sid, event):
        pass

    # Register then manually remove to make _unsubscribe find nothing
    unsub = client.on("test_event", handler)
    client._handlers["test_event"].remove(handler)

    with caplog.at_level(logging.DEBUG):
        unsub()

    assert any("unsubscribe" in r.message.lower() for r in caplog.records)


@pytest.mark.asyncio
async def test_stop_logs_debug_when_read_task_cancelled(caplog):
    """stop() should log debug when the read task is cancelled."""
    client = _make_client()

    async def mock_read_loop():
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            raise

    client._running = True
    client._read_task = asyncio.create_task(mock_read_loop())

    with caplog.at_level(logging.DEBUG):
        await client.stop()

    assert any("cancel" in r.message.lower() for r in caplog.records)
    assert client._read_task is None
