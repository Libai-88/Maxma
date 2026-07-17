"""Coverage push tests for api/middleware/request_log.py.

Targets previously uncovered lines:
- Line 32: non-http scope passthrough (WebSocket)
- Line 83: logger.error for status_code >= 500
"""

from __future__ import annotations

import logging

import pytest

from api.middleware.request_log import RequestLogMiddleware


@pytest.mark.asyncio
async def test_request_log_websocket_passthrough():
    """Line 32: a WebSocket scope is passed through without logging."""
    received = []

    class MockApp:
        async def __call__(self, scope, receive, send):
            received.append(scope["type"])

    middleware = RequestLogMiddleware(MockApp())
    # WebSocket scope — should be passed through directly (line 32)
    await middleware({"type": "websocket", "path": "/ws/test"}, None, None)
    assert received == ["websocket"]


@pytest.mark.asyncio
async def test_request_log_logs_error_on_5xx(caplog):
    """Line 83: a response with status_code >= 500 triggers logger.error."""
    class ErrorApp:
        async def __call__(self, scope, receive, send):
            # Simulate a 500 response
            await send({"type": "http.response.start", "status": 500, "headers": []})
            await send({"type": "http.response.body", "body": b"error"})

    middleware = RequestLogMiddleware(ErrorApp())

    # Provide a real send callable that consumes messages
    sent_messages = []

    async def _send(message):
        sent_messages.append(message)

    with caplog.at_level(logging.ERROR):
        await middleware(
            {"type": "http", "method": "GET", "path": "/api/broken", "headers": []},
            None,
            _send,
        )

    # Verify error was logged (line 83)
    assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert any("500" in str(r.message) for r in caplog.records)
