"""JSON-RPC 2.0 client for communicating with the Bun sidecar over stdio."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


class JsonRpcError(Exception):
    """Raised when the sidecar returns a JSON-RPC error response."""

    def __init__(self, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.data = data


class JsonRpcClient:
    """JSON-RPC 2.0 client over stdio.

    Reads/writes JSON lines from/to a subprocess's stdin/stdout.
    Supports:
    - Request/response with call()
    - Server-pushed event notifications with on()
    - Automatic cleanup on stop()
    """

    def __init__(
        self, stdin: asyncio.StreamWriter, stdout: asyncio.StreamReader
    ) -> None:
        self._stdin = stdin
        self._stdout = stdout
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future[dict]] = {}
        self._handlers: dict[str, list[Callable]] = {}
        self._running = False
        self._read_task: asyncio.Task[None] | None = None

    # -- Public API ---------------------------------------------------------

    async def start_reading(self) -> None:
        """Start the background task that reads stdout and dispatches messages."""
        if self._running:
            return
        self._running = True
        self._read_task = asyncio.create_task(self._read_loop())

    async def call(
        self, method: str, params: dict | None = None, *, timeout: float = 120
    ) -> dict:
        """Send a JSON-RPC request and wait for the response.

        Args:
            method: The RPC method name.
            params: Optional parameters dict.
            timeout: Maximum seconds to wait for a response (default 120).

        Returns:
            The result dict from the response.

        Raises:
            JsonRpcError: if the sidecar returns an error response.
            TimeoutError: if no response within *timeout* seconds.
            RuntimeError: if the client is not running.
        """
        if not self._running:
            raise RuntimeError("JsonRpcClient is not running")

        self._msg_id += 1
        msg_id = self._msg_id

        req: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
            "id": msg_id,
        }
        if params is not None:
            req["params"] = params

        future: asyncio.Future[dict] = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future

        try:
            line = json.dumps(req, ensure_ascii=False) + "\n"
            self._stdin.write(line.encode("utf-8"))
            await self._stdin.drain()
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise TimeoutError(
                f"RPC call '{method}' timed out after {timeout}s"
            )
        except Exception:
            self._pending.pop(msg_id, None)
            raise

    def on(self, event_type: str, handler: Callable) -> Callable[[], None]:
        """Register an event handler.

        The handler receives ``(session_id: str, event: dict)``.

        Returns a callable that unsubscribes the handler when invoked.
        """
        if event_type not in self._handlers:
            self._handlers[event_type] = []
        self._handlers[event_type].append(handler)

        def _unsubscribe() -> None:
            try:
                self._handlers[event_type].remove(handler)
            except ValueError:
                logger.debug("[rpc] Handler not found for unsubscribe (event_type=%s)", event_type)

        return _unsubscribe

    async def stop(self) -> None:
        """Stop the read loop and cancel pending futures."""
        self._running = False
        if self._read_task is not None and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                logger.debug("[rpc] Read task cancelled during stop()")
            self._read_task = None
        # Cancel remaining pending futures
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Client stopped"))
        self._pending.clear()

    @property
    def is_running(self) -> bool:
        """True if the read loop is active."""
        return self._running

    # -- Internal -----------------------------------------------------------

    async def _read_loop(self) -> None:
        """Continuously read JSON lines from stdout and dispatch them."""
        try:
            while self._running:
                line = await self._stdout.readline()
                if not line:
                    break  # EOF: process died
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue
                try:
                    msg = json.loads(line_str)
                    await self._dispatch(msg)
                except json.JSONDecodeError:
                    logger.warning(
                        "[rpc] invalid JSON from sidecar: %s", line_str[:200]
                    )
        except Exception:
            if self._running:
                logger.exception("[rpc] read loop crashed")
        finally:
            self._running = False
            # Cancel all pending futures
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(RuntimeError("Sidecar disconnected"))
            self._pending.clear()

    async def _dispatch(self, msg: dict) -> None:
        """Dispatch an incoming message: event notification or RPC response."""
        # Event notification (server-pushed, no id)
        if msg.get("method") == "event":
            params = msg.get("params", {})
            event = params.get("event", {})
            event_type: str = ""
            if isinstance(event, dict):
                event_type = event.get("type", "")
            handlers = self._handlers.get(event_type, [])
            session_id = params.get("session_id", "")
            for handler in handlers:
                try:
                    if asyncio.iscoroutinefunction(handler):
                        await handler(session_id, event)
                    else:
                        handler(session_id, event)
                except Exception:
                    logger.exception(
                        "[rpc] event handler error: type=%s", event_type
                    )
            return

        # RPC response (has id)
        msg_id = msg.get("id")
        if msg_id is not None and msg_id in self._pending:
            fut = self._pending.pop(msg_id)
            if "error" in msg:
                error = msg["error"]
                fut.set_exception(
                    JsonRpcError(
                        error.get("message", "RPC error"),
                        error.get("data"),
                    )
                )
            else:
                fut.set_result(msg.get("result", {}))
