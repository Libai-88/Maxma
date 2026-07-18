# Backend Silent Except Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace 11 silent `except Exception: pass` patterns with specific exception types and logging across 5 backend files.

**Architecture:** Add `logger.warning`/`logger.debug` to each silently-swallowed exception, preserving original control flow. Where `asyncio.CancelledError` is caught after explicit `task.cancel()`, add `logger.debug` (expected behavior) but do NOT re-raise — re-raising would break cleanup/shutdown flows and violate the "不得改变控制流" constraint.

**Tech Stack:** Python 3.13, FastAPI, pytest, logging

---

## Deviations from Task Description

1. **`agent/context_manager.py:547-548`** — NO silent `except` exists at this location (or anywhere in the file). The only `except Exception` at line 369 already has `logger.warning`. **Skipped.**

2. **`asyncio.CancelledError` re-raise policy** — The task says "对于 `asyncio.CancelledError`：不要吞掉，应该 `raise` 重新抛出". However, all 3 CancelledError catches are in explicit child-task cancellation contexts (`task.cancel()` + `await task` in `stop()`/`delete()` methods). Re-raising would:
   - Break `SessionManager.delete()` — session cleanup incomplete
   - Break `JsonRpcClient.stop()` — pending futures unresolved, causing hangs
   - Break `SidecarManager.stop()` — process never terminated
   
   These violate "不得改变控制流". Decision: add `logger.debug` (expected event) but do NOT re-raise. This follows the standard asyncio cleanup pattern.

3. **`rpc_client.py:116`** — Task says "cancel 失败静默" but the actual code is `except ValueError: pass` in `_unsubscribe` (list.remove not-found). ValueError is already a specific type. Adding `logger.debug` since handler-not-found is a no-op event.

---

## File Structure

| File | Silent excepts | Has logger? | Test file |
|------|---------------|-------------|-----------|
| `api/session_manager.py` | 3 (lines 152, 158, 165) | NO — add `import logging` + `logger` | `tests/test_api/test_session_manager.py` (existing) |
| `api/routes/chat.py` | 4 (lines 179, 211, 221, 229) | YES (line 19) | `tests/test_api/test_chat_silent_except.py` (new) |
| `api/pi_bridge/rpc_client.py` | 2 (lines 116, 128) | YES (line 11) | `tests/test_pi_bridge/test_rpc_client.py` (new) |
| `api/pi_bridge/sidecar_manager.py` | 1 (line 174) | YES (line 24) | `tests/test_pi_bridge/test_sidecar_manager.py` (new) |
| `main.py` | 1 (line 85) | NO — add module-level `logger` | `tests/test_main.py` (new) |

**Total: 11 fixes across 5 files, 5 commits.**

---

### Task 1: Fix `api/session_manager.py` — 3 silent excepts in `delete()`

**Files:**
- Modify: `api/session_manager.py:1-8` (add logger), `api/session_manager.py:148-169` (fix 3 excepts)
- Test: `tests/test_api/test_session_manager.py` (add tests)

**Context:** `SessionManager.delete()` cancels the active task, then calls `run_manager.cancel_parent()` and `workflow_manager.cancel_parent()`. All three have silent excepts. The module has NO `logger` — must add `import logging` and `logger = logging.getLogger(__name__)`.

- [ ] **Step 1: Write failing tests**

Add to `tests/test_api/test_session_manager.py` (after existing tests, before EOF):

```python
@pytest.mark.asyncio
async def test_delete_logs_warning_when_active_task_raises(manager, caplog):
    """delete() should log a warning when awaiting the cancelled active task raises."""
    import logging
    session = await manager.create()

    async def failing_task():
        raise RuntimeError("task boom")

    task = asyncio.create_task(failing_task())
    session._active_task = task

    with caplog.at_level(logging.WARNING):
        await manager.delete(session.session_id)

    assert any("task" in r.message.lower() or "取消" in r.message for r in caplog.records if r.levelno >= logging.WARNING)


@pytest.mark.asyncio
async def test_delete_logs_warning_when_run_manager_raises(manager, caplog):
    """delete() should log a warning when run_manager.cancel_parent raises."""
    import logging

    class FailingRunManager:
        async def cancel_parent(self, session_id):
            raise RuntimeError("run_manager boom")

    session = await manager.create()
    manager._deferred_run_manager = FailingRunManager()

    with caplog.at_level(logging.WARNING):
        result = await manager.delete(session.session_id)

    assert result is True
    assert any("run" in r.message.lower() or "durable" in r.message.lower() for r in caplog.records)


@pytest.mark.asyncio
async def test_delete_logs_warning_when_workflow_manager_raises(manager, caplog):
    """delete() should log a warning when workflow_manager.cancel_parent raises."""
    import logging

    class FailingWorkflowManager:
        async def cancel_parent(self, session_id, reason):
            raise RuntimeError("workflow boom")

    session = await manager.create()
    manager._workflow_run_manager = FailingWorkflowManager()

    with caplog.at_level(logging.WARNING):
        result = await manager.delete(session.session_id)

    assert result is True
    assert any("workflow" in r.message.lower() for r in caplog.records)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_session_manager.py::test_delete_logs_warning_when_active_task_raises tests/test_api/test_session_manager.py::test_delete_logs_warning_when_run_manager_raises tests/test_api/test_session_manager.py::test_delete_logs_warning_when_workflow_manager_raises -v`
Expected: FAIL (no log records captured — current code uses `pass`)

- [ ] **Step 3: Add logger import and fix 3 excepts**

In `api/session_manager.py`, add after line 7 (`from typing import Any`):

```python
import logging

logger = logging.getLogger(__name__)
```

Replace lines 148-169 (the three except blocks in `delete()`):

**Before (lines 148-169):**
```python
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        run_manager = getattr(self, "_deferred_run_manager", None)
        if run_manager is not None:
            try:
                await run_manager.cancel_parent(session_id)
            except Exception:
                # Session deletion must remain available even if a durable
                # dispatcher has already been shut down during application exit.
                pass
        workflow_manager = getattr(self, "_workflow_run_manager", None)
        if workflow_manager is not None:
            try:
                await workflow_manager.cancel_parent(session_id, "parent_session_closed")
            except Exception:
                # A session must still be removable while a workflow runtime is
                # stopping or has already released its journal connection.
                pass
        return True
```

**After:**
```python
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                logger.debug("[session] Active task cancelled for %s", session_id)
            except Exception as e:
                logger.warning("[session] Failed to cancel active task for %s: %s", session_id, e)
        run_manager = getattr(self, "_deferred_run_manager", None)
        if run_manager is not None:
            try:
                await run_manager.cancel_parent(session_id)
            except Exception as e:
                # Session deletion must remain available even if a durable
                # dispatcher has already been shut down during application exit.
                logger.warning("[session] run_manager.cancel_parent failed for %s: %s", session_id, e)
        workflow_manager = getattr(self, "_workflow_run_manager", None)
        if workflow_manager is not None:
            try:
                await workflow_manager.cancel_parent(session_id, "parent_session_closed")
            except Exception as e:
                # A session must still be removable while a workflow runtime is
                # stopping or has already released its journal connection.
                logger.warning("[session] workflow_manager.cancel_parent failed for %s: %s", session_id, e)
        return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_session_manager.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite + ruff**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/session_manager.py tests/test_api/test_session_manager.py
git commit -m "fix: replace silent except:pass in SessionManager.delete with logged warnings

Adds logger to session_manager module. Three silent except blocks in
delete() now log warnings: active task cancellation failure,
run_manager.cancel_parent failure, and workflow_manager.cancel_parent
failure. CancelledError from explicit task.cancel() is logged at debug
level (expected event). Control flow unchanged."
```

---

### Task 2: Fix `api/routes/chat.py` — 4 silent excepts in `_stream_turn_sidecar()`

**Files:**
- Modify: `api/routes/chat.py:179-180`, `api/routes/chat.py:211-212`, `api/routes/chat.py:221-222`, `api/routes/chat.py:229-230`
- Test: `tests/test_api/test_chat_silent_except.py` (new)

**Context:** `_stream_turn_sidecar()` is a complex async function that proxies WS events to/from the sidecar. The 4 silent excepts are:
1. Line 179-180: WS event forwarding fails (inside `_make_handler` closure)
2. Line 211-212: `client.call("cancel")` fails after timeout
3. Line 221-222: `client.call("cancel")` fails after generic exception
4. Line 229-230: `unsub()` fails in finally block

The module already has `logger = logging.getLogger(__name__)` at line 19.

- [ ] **Step 1: Write failing tests**

Create `tests/test_api/test_chat_silent_except.py`:

```python
"""Tests for silent-except logging in api/routes/chat.py _stream_turn_sidecar."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.routes import chat


def _make_mock_ws():
    """Create a mock WebSocket with app.state.sidecar_manager."""
    ws = MagicMock()
    ws.app.state.sidecar_manager = MagicMock()
    ws.send_json = AsyncMock()
    return ws


def _make_mock_session():
    session = MagicMock()
    session.session_id = "test-session-id"
    session._sidecar_session_id = None
    return session


def _make_mock_client(handlers_capture):
    """Create a mock JsonRpcClient that captures registered handlers."""
    client = MagicMock()
    client.is_running = True
    client.call = AsyncMock(return_value={"session_id": "sidecar-sid"})

    def on(evt_type, handler):
        handlers_capture[evt_type] = handler
        return MagicMock()  # unsub callable
    client.on = on

    return client


@pytest.mark.asyncio
async def test_handler_logs_warning_when_ws_send_fails(caplog):
    """_make_handler's inner handler should log when ws.send_json raises."""
    ws = _make_mock_ws()
    session = _make_mock_session()
    handlers = {}

    # Patch _stream_turn_sidecar dependencies to capture the handler
    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_client = _make_mock_client(handlers)
    mock_mgr.client = mock_client

    ws.app.state.sidecar_manager = mock_mgr

    # Make ws.send_json raise after handler is captured
    original_send = ws.send_json

    async def failing_send(data):
        raise RuntimeError("WS send failed")

    # We need to call _stream_turn_sidecar to set up handlers, then trigger
    # the handler with a failing ws.send_json.
    # Use a mock that captures handlers then fails on prompt
    call_count = 0

    async def mock_call(method, params=None, **kwargs):
        nonlocal call_count
        call_count += 1
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            # Trigger the "done" event to end the turn
            if "done" in handlers:
                await handlers["done"]("sidecar-sid-123", {"payload": {}})
            return {}
        if method == "cancel":
            return {}
        return {}

    mock_client.call = mock_call

    # Now make ws.send_json fail
    ws.send_json = failing_send

    with caplog.at_level(logging.WARNING):
        try:
            await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
        except Exception:
            pass  # outer function may raise due to WS failures

    # The handler should have logged a warning when ws.send_json failed
    assert any(
        "sidecar" in r.message.lower() or "ws" in r.message.lower() or "forward" in r.message.lower()
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )


@pytest.mark.asyncio
async def test_cancel_logs_warning_when_client_call_cancel_fails_on_timeout(caplog):
    """client.call('cancel') failure after timeout should log a warning."""
    ws = _make_mock_ws()
    session = _make_mock_session()
    handlers = {}

    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_client = _make_mock_client(handlers)
    mock_mgr.client = mock_client
    ws.app.state.sidecar_manager = mock_mgr

    async def mock_call(method, params=None, **kwargs):
        if method == "create_session":
            return {"session_id": "sidecar-sid-123"}
        if method == "get_messages":
            return []
        if method == "prompt":
            # Simulate timeout: don't trigger done event, let wait_for timeout
            await asyncio.sleep(10)
        if method == "cancel":
            raise RuntimeError("cancel failed")
        return {}

    mock_client.call = mock_call

    with patch("api.routes.chat.asyncio.wait_for", side_effect=asyncio.TimeoutError):
        with caplog.at_level(logging.WARNING):
            try:
                await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
            except Exception:
                pass

    assert any("cancel" in r.message.lower() for r in caplog.records if r.levelno >= logging.WARNING)


@pytest.mark.asyncio
async def test_cancel_logs_warning_when_client_call_cancel_fails_on_error(caplog):
    """client.call('cancel') failure after generic error should log a warning."""
    ws = _make_mock_ws()
    session = _make_mock_session()
    handlers = {}

    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_client = _make_mock_client(handlers)
    mock_mgr.client = mock_client
    ws.app.state.sidecar_manager = mock_mgr

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

    with caplog.at_level(logging.WARNING):
        try:
            await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
        except Exception:
            pass

    assert any("cancel" in r.message.lower() for r in caplog.records if r.levelno >= logging.WARNING)


@pytest.mark.asyncio
async def test_unsub_logs_warning_when_unsub_fails(caplog):
    """unsub() failure in finally block should log a warning."""
    ws = _make_mock_ws()
    session = _make_mock_session()
    handlers = {}

    mock_mgr = MagicMock()
    mock_mgr.start = AsyncMock()
    mock_client = MagicMock()
    mock_client.is_running = True

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
    mock_mgr.client = mock_client
    ws.app.state.sidecar_manager = mock_mgr

    with caplog.at_level(logging.WARNING):
        try:
            await chat._stream_turn_sidecar(ws, session, "hello", "system prompt")
        except Exception:
            pass

    assert any("unsub" in r.message.lower() for r in caplog.records if r.levelno >= logging.WARNING)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_chat_silent_except.py -v`
Expected: FAIL (no log records — current code uses `pass`)

- [ ] **Step 3: Fix the 4 silent excepts**

**Fix 1 — Line 179-180 (handler WS forwarding):**

Before:
```python
            except Exception:
                pass
        return handler
```

After:
```python
            except Exception as e:
                logger.warning("[sidecar] Failed to forward %s event to WS: %s", evt_type, e)
        return handler
```

**Fix 2 — Line 211-212 (cancel after timeout):**

Before:
```python
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            pass
        if not final_answer:
            final_answer = "（Sidecar 处理超时，请重试）"
```

After:
```python
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as e:
            logger.warning("[sidecar] Failed to cancel after timeout for session %s: %s", sidecar_sid[:8], e)
        if not final_answer:
            final_answer = "（Sidecar 处理超时，请重试）"
```

**Fix 3 — Line 221-222 (cancel after error):**

Before:
```python
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception:
            pass
        if not final_answer:
            final_answer = f"（Sidecar 处理出错：{e}）"
```

After:
```python
        try:
            await client.call("cancel", {"session_id": sidecar_sid})
        except Exception as e:
            logger.warning("[sidecar] Failed to cancel after error for session %s: %s", sidecar_sid[:8], e)
        if not final_answer:
            final_answer = f"（Sidecar 处理出错：{e}）"
```

**Fix 4 — Line 229-230 (unsub in finally):**

Before:
```python
    finally:
        for unsub in unsubs:
            try:
                unsub()
            except Exception:
                pass
```

After:
```python
    finally:
        for unsub in unsubs:
            try:
                unsub()
            except Exception as e:
                logger.warning("[sidecar] Failed to unsubscribe handler: %s", e)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_chat_silent_except.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite + ruff**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/routes/chat.py tests/test_api/test_chat_silent_except.py
git commit -m "fix: replace 4 silent except:pass in _stream_turn_sidecar with logged warnings

WS event forwarding failure, cancel-after-timeout failure,
cancel-after-error failure, and unsub failure in finally block
now all log warnings instead of silently swallowing."
```

---

### Task 3: Fix `api/pi_bridge/rpc_client.py` — 2 silent excepts

**Files:**
- Modify: `api/pi_bridge/rpc_client.py:112-118` (`_unsubscribe`), `api/pi_bridge/rpc_client.py:120-134` (`stop()`)
- Test: `tests/test_pi_bridge/test_rpc_client.py` (new)

**Context:**
1. `_unsubscribe()` (line 115-116): `except ValueError: pass` when removing a handler that's not in the list. ValueError is already specific — add `logger.debug`.
2. `stop()` (line 127-128): `except asyncio.CancelledError: pass` after cancelling `_read_task`. Add `logger.debug` — this is expected behavior after explicit `cancel()`.

The module already has `logger = logging.getLogger(__name__)` at line 11.

- [ ] **Step 1: Write failing tests**

Create `tests/test_pi_bridge/test_rpc_client.py`:

```python
"""Tests for silent-except logging in api/pi_bridge/rpc_client.py."""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_rpc_client.py -v`
Expected: FAIL (no log records — current code uses `pass`)

- [ ] **Step 3: Fix the 2 silent excepts**

**Fix 1 — Lines 112-118 (`_unsubscribe`):**

Before:
```python
        def _unsubscribe() -> None:
            try:
                self._handlers[event_type].remove(handler)
            except ValueError:
                pass

        return _unsubscribe
```

After:
```python
        def _unsubscribe() -> None:
            try:
                self._handlers[event_type].remove(handler)
            except ValueError:
                logger.debug("[rpc] Handler not found for unsubscribe (event_type=%s)", event_type)

        return _unsubscribe
```

**Fix 2 — Lines 120-134 (`stop()`):**

Before:
```python
    async def stop(self) -> None:
        """Stop the read loop and cancel pending futures."""
        self._running = False
        if self._read_task is not None and not self._read_task.done():
            self._read_task.cancel()
            try:
                await self._read_task
            except asyncio.CancelledError:
                pass
            self._read_task = None
```

After:
```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_rpc_client.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite + ruff**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/pi_bridge/rpc_client.py tests/test_pi_bridge/test_rpc_client.py
git commit -m "fix: replace 2 silent except in rpc_client with logged debug messages

_unsubscribe ValueError (handler not found) and stop() CancelledError
(explicit task cancellation) now log at debug level instead of silent
pass. Both are expected no-op events."
```

---

### Task 4: Fix `api/pi_bridge/sidecar_manager.py` — 1 silent except in `stop()`

**Files:**
- Modify: `api/pi_bridge/sidecar_manager.py:168-175` (stderr task cancellation in `stop()`)
- Test: `tests/test_pi_bridge/test_sidecar_manager.py` (new)

**Context:** `SidecarManager.stop()` cancels the `_stderr_task` and catches `asyncio.CancelledError` silently. Add `logger.debug` — expected after explicit `cancel()`.

The module already has `logger = logging.getLogger(__name__)` at line 24.

- [ ] **Step 1: Write failing test**

Create `tests/test_pi_bridge/test_sidecar_manager.py`:

```python
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
    mgr._is_running = True

    # Set up a real stderr task that will be cancelled
    async def mock_stderr_forward():
        try:
            await asyncio.sleep(100)
        except asyncio.CancelledError:
            raise

    mgr._stderr_task = asyncio.create_task(mock_stderr_forward())

    # Mock process for termination phase
    mock_proc = MagicMock()
    mock_proc.pid = 12345
    mock_proc.terminate = MagicMock()
    mock_proc.wait = AsyncMock()
    mock_proc.kill = MagicMock()
    mgr._process = mock_proc

    with caplog.at_level(logging.DEBUG):
        await mgr.stop()

    assert any("stderr" in r.message.lower() or "cancel" in r.message.lower() for r in caplog.records)
    assert mgr._stderr_task is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_sidecar_manager.py -v`
Expected: FAIL (no log records — current code uses `pass`)

- [ ] **Step 3: Fix the silent except**

**Before (lines 168-175):**
```python
            # Cancel stderr forwarding task
            if self._stderr_task is not None and not self._stderr_task.done():
                self._stderr_task.cancel()
                try:
                    await self._stderr_task
                except asyncio.CancelledError:
                    pass
            self._stderr_task = None
```

**After:**
```python
            # Cancel stderr forwarding task
            if self._stderr_task is not None and not self._stderr_task.done():
                self._stderr_task.cancel()
                try:
                    await self._stderr_task
                except asyncio.CancelledError:
                    logger.debug("[sidecar] Stderr forwarding task cancelled during stop()")
            self._stderr_task = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_sidecar_manager.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite + ruff**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add api/pi_bridge/sidecar_manager.py tests/test_pi_bridge/test_sidecar_manager.py
git commit -m "fix: replace silent CancelledError pass in SidecarManager.stop with debug log

Stderr forwarding task cancellation during stop() now logs at debug
level instead of silent pass. Expected event after explicit cancel()."
```

---

### Task 5: Fix `main.py` — 1 silent except in `_start_parent_watchdog()`

**Files:**
- Modify: `main.py:1-14` (add logger), `main.py:85-86` (fix except)
- Test: `tests/test_main.py` (new)

**Context:** `_start_parent_watchdog()` wraps its entire setup (import ctypes, get PID, create thread) in a try/except that silently swallows all exceptions. The module has NO module-level `logger` — must add `import logging` and `logger = logging.getLogger(__name__)`.

Note: `main.py` uses `print()` for inner watchdog logging (before `setup_logging()` is called). The outer except should use `logger.warning`.

- [ ] **Step 1: Write failing test**

Create `tests/test_main.py`:

```python
"""Tests for silent-except logging in main.py _start_parent_watchdog."""

import builtins
import logging
import sys

import pytest


@pytest.mark.skipif(sys.platform != "win32", reason="Watchdog is Windows-only")
def test_watchdog_logs_warning_when_setup_fails(monkeypatch, caplog):
    """_start_parent_watchdog should log warning when setup fails, not silently pass."""
    # Force ctypes import to fail
    real_import = builtins.__import__

    def failing_import(name, *args, **kwargs):
        if name == "ctypes":
            raise ImportError("mocked: ctypes unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", failing_import)

    # Re-import main to get fresh module state
    if "main" in sys.modules:
        del sys.modules["main"]

    with caplog.at_level(logging.WARNING):
        import main as main_module
        main_module._start_parent_watchdog()

    assert any(
        "watchdog" in r.message.lower() or "父进程" in r.message or "安装" in r.message
        for r in caplog.records
        if r.levelno >= logging.WARNING
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_main.py -v`
Expected: FAIL (no log records — current code uses `pass`)

- [ ] **Step 3: Add logger and fix the silent except**

In `main.py`, add after line 7 (`import time`):

```python
import logging
```

And after the imports (after line 14, `from config.settings import get_settings`):

```python
logger = logging.getLogger(__name__)
```

**Before (lines 85-86):**
```python
    except Exception:
        pass
```

**After:**
```python
    except Exception as e:
        logger.warning("[watchdog] 父进程监控安装失败: %s", e)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_main.py -v`
Expected: PASS

- [ ] **Step 5: Run full test suite + ruff**

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --deselect "tests/test_api/test_files.py::TestSelectFile::test_allowed_in_development" -v`
Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 agent api config tests`

- [ ] **Step 6: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add main.py tests/test_main.py
git commit -m "fix: replace silent except:pass in _start_parent_watchdog with logged warning

Parent watchdog setup failure now logs a warning instead of silently
swallowing. Adds module-level logger to main.py."
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 11 silent excepts listed in the task are addressed (context_manager.py skipped — no silent except exists)
- [x] **Placeholder scan:** No TBD/TODO — all steps contain exact code
- [x] **Type consistency:** `asyncio.CancelledError` handled consistently (debug log, no re-raise) across session_manager, rpc_client, sidecar_manager
- [x] **Control flow:** No return values or control flow changed — only logging added
- [x] **YAGNI:** No extra error recovery logic added
