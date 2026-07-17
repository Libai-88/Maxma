"""Tests for silent-except logging in api/routes/chat.py _stream_turn_sidecar."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.routes import chat


def _setup_mocks(handlers, ws_send_func=None):
    """Set up mock ws, session, sidecar manager, and client for _stream_turn_sidecar.

    Args:
        handlers: dict to capture registered event handlers by event type.
        ws_send_func: optional async function to use as ws.send_json.
                      If None, a no-op AsyncMock is used.

    Returns:
        (ws, session) tuple ready to pass to _stream_turn_sidecar.
    """
    ws = MagicMock()
    ws.send_json = ws_send_func or AsyncMock()

    mock_client = MagicMock()
    mock_client.is_running = True

    def on(evt_type, handler):
        handlers[evt_type] = handler
        return MagicMock()  # unsub callable

    mock_client.on = on
    mock_client.call = AsyncMock()

    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_mgr.client = mock_client

    ws.app.state.sidecar_manager = mock_mgr

    session = MagicMock()
    session.session_id = "test-session-id"
    session._sidecar_session_id = None

    return ws, session, mock_client


def _patch_session_map():
    """Patch SessionMap so get_sidecar_id returns None (forces create_session path)."""
    mock_instance = MagicMock()
    mock_instance.__enter__ = MagicMock(return_value=mock_instance)
    mock_instance.__exit__ = MagicMock(return_value=False)
    mock_instance.get_sidecar_id.return_value = None
    mock_instance.get_recent_turns.return_value = []
    mock_instance.remove = MagicMock()
    mock_instance.set_mapping = MagicMock()
    return patch("api.routes.chat.SessionMap", return_value=mock_instance)


@pytest.mark.asyncio
async def test_handler_logs_warning_when_ws_send_fails(caplog):
    """_make_handler's inner handler should log when ws.send_json raises."""
    handlers = {}

    async def failing_send(data):
        raise RuntimeError("WS send failed")

    ws, session, mock_client = _setup_mocks(handlers, ws_send_func=failing_send)

    async def mock_call(method, params=None, **kwargs):
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            # Trigger the token handler — ws.send_json will fail
            if "token" in handlers:
                await handlers["token"]("sidecar-sid-123", {"payload": {"token": "t"}})
            # Trigger done to complete the turn
            if "done" in handlers:
                await handlers["done"]("sidecar-sid-123", {"payload": {}})
            return {}
        if method == "cancel":
            return {}
        return {}

    mock_client.call = mock_call

    with _patch_session_map():
        with caplog.at_level(logging.WARNING):
            try:
                await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
            except Exception:
                pass

    assert any(
        "sidecar" in r.message.lower() or "forward" in r.message.lower()
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )


@pytest.mark.asyncio
async def test_cancel_logs_warning_when_client_call_cancel_fails_on_timeout(caplog):
    """client.call('cancel') failure after timeout should log a warning."""
    handlers = {}
    ws, session, mock_client = _setup_mocks(handlers)

    async def mock_call(method, params=None, **kwargs):
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            # Don't trigger done — let wait_for time out
            return {}
        if method == "cancel":
            raise RuntimeError("cancel failed")
        return {}

    mock_client.call = mock_call

    async def immediate_timeout(coro, timeout=None, **kwargs):
        if hasattr(coro, "close"):
            coro.close()
        raise asyncio.TimeoutError()

    with _patch_session_map():
        with patch("api.routes.chat.asyncio.wait_for", new=immediate_timeout):
            with caplog.at_level(logging.WARNING):
                try:
                    await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
                except Exception:
                    pass

    assert any(
        "cancel" in r.message.lower()
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )


@pytest.mark.asyncio
async def test_cancel_logs_warning_when_client_call_cancel_fails_on_error(caplog):
    """client.call('cancel') failure after generic error should log a warning."""
    handlers = {}
    ws, session, mock_client = _setup_mocks(handlers)

    async def mock_call(method, params=None, **kwargs):
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            raise RuntimeError("prompt failed")
        if method == "cancel":
            raise RuntimeError("cancel also failed")
        return {}

    mock_client.call = mock_call

    with _patch_session_map():
        with caplog.at_level(logging.WARNING):
            try:
                await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
            except Exception:
                pass

    assert any(
        "cancel" in r.message.lower()
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )


@pytest.mark.asyncio
async def test_unsub_logs_warning_when_unsub_fails(caplog):
    """unsub() failure in finally block should log a warning."""
    handlers = {}
    ws, session, mock_client = _setup_mocks(handlers)

    # Make client.on return a failing unsub function
    def on(evt_type, handler):
        handlers[evt_type] = handler

        def failing_unsub():
            raise RuntimeError("unsub failed")

        return failing_unsub

    mock_client.on = on

    async def mock_call(method, params=None, **kwargs):
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            if "done" in handlers:
                await handlers["done"]("sidecar-sid-123", {"payload": {}})
            return {}
        return {}

    mock_client.call = mock_call

    with _patch_session_map():
        with caplog.at_level(logging.WARNING):
            try:
                await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
            except Exception:
                pass

    assert any(
        "unsub" in r.message.lower()
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )
