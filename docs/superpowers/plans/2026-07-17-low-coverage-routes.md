# Low Coverage Routes Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for 7 low-coverage modules (ws_event_mapper 21%, mcp 39%, mcp_test 44%, workflows 53%, deferred_runs 60%, auth 67%, files 75%) to 70%+ each, by adding new test files only (no source changes).

**Architecture:** Read each module → identify uncovered lines from `--cov-report=term-missing` → design happy/error-path tests using TestClient + tmp_path + monkeypatch → implement each test file → verify pass + coverage → commit per module. All tests are new files under `tests/test_api/` and `tests/test_pi_bridge/`; no existing source or test files are modified.

**Tech Stack:** Python 3.13, FastAPI, pytest, pytest-asyncio (auto mode), pytest-cov, starlette TestClient.

## Baseline (measured 2026-07-17)

| Module | Stmts | Missing | Coverage | Missing lines |
|--------|-------|---------|----------|---------------|
| api/pi_bridge/ws_event_mapper.py | 38 | 30 | 21% | 37-54, 69-77, 84-87, 96-99, 104 |
| api/routes/mcp.py | 149 | 91 | 39% | 72-78, 83-84, 89-128, 138, 153-154, 163-168, 179-184, 190-204, 218-237, 243-252, 258, 270 |
| api/routes/mcp_test.py | 39 | 22 | 44% | 44-97 |
| api/routes/workflows.py | 95 | 45 | 53% | 37, 41-46, 50-52, 56-61, 106-107, 114-127, 134-137, 142-143, 148-152, 157-163 |
| api/routes/deferred_runs.py | 70 | 28 | 60% | 23-29, 42-48, 92-95, 101, 107-112, 120-125 |
| api/middleware/auth.py | 45 | 15 | 67% | 33, 51-60, 83-88, 95 |
| api/routes/files.py | 48 | 12 | 75% | 45-49, 58-59, 63, 82-87 |
| **TOTAL api** | 4894 | 1018 | 79% | |

## File Structure (new test files only)

- Create: `tests/test_pi_bridge/test_ws_event_mapper.py` — pure-function tests for validate/enrich/make_* helpers.
- Create: `tests/test_api/test_mcp_routes.py` — MCP server CRUD via TestClient + tmp YAML path.
- Create: `tests/test_api/test_mcp_test_routes.py` — test-connection endpoint with mocked subprocess.
- Create: `tests/test_api/test_workflows_routes_enabled.py` — enabled-path routes with fake manager/store/registry/session_manager.
- Create: `tests/test_api/test_deferred_runs_routes_enabled.py` — enabled-path routes + audit ImportError fallback.
- Create: `tests/test_api/test_files_extra.py` — folder dialog, ImportError, generic exception, DPI paths.
- Create: `tests/test_api/test_auth_middleware_extra.py` — OPTIONS preflight, WS subprotocol injection, WS token via subprotocol, WS reject.

## Shared Conventions

- Use `from fastapi import FastAPI` + `TestClient` for route tests; mount only the target `router`.
- For YAML-backed modules, monkeypatch `MCP_YAML_PATH` to a `tmp_path` file so tests are isolated.
- For feature-flagged modules, monkeypatch the `_<feature>_enabled` function to return `True` and inject fake managers onto `app.state`.
- `pytest-asyncio` is in `auto` mode (`asyncio_mode = "auto"` in pyproject.toml) — async test functions need no decorator, but keep `@pytest.mark.asyncio` only where existing tests use it.
- Run tests: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/test_api/test_<file>.py -v`
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`

---

## Task 1: ws_event_mapper.py → 100%

**Files:**
- Create: `tests/test_pi_bridge/test_ws_event_mapper.py`

Uncovered: `validate_event` (37-54), `enrich_event` (69-77), `make_done_event` turn_id branch (84-87), `make_error_event` trace_id branch (96-99), `make_context_usage_event` (104).

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/pi_bridge/ws_event_mapper.py — event validation/enrichment helpers."""

from collections.abc import Mapping

from api.pi_bridge.ws_event_mapper import (
    EVENT_TYPES,
    enrich_event,
    make_context_usage_event,
    make_done_event,
    make_error_event,
    validate_event,
)


class TestValidateEvent:
    def test_non_mapping_returns_false(self):
        assert validate_event(["not", "a", "dict"]) is False  # type: ignore[arg-type]

    def test_missing_type_returns_false(self):
        assert validate_event({"payload": {}}) is False

    def test_non_string_type_returns_false(self):
        assert validate_event({"type": 123, "payload": {}}) is False

    def test_unknown_type_returns_false(self):
        assert validate_event({"type": "nope", "payload": {}}) is False

    def test_missing_payload_returns_false(self):
        assert validate_event({"type": "token"}) is False

    def test_non_dict_payload_returns_false(self):
        assert validate_event({"type": "token", "payload": "str"}) is False

    def test_valid_event_returns_true(self):
        assert validate_event({"type": "token", "payload": {"v": 1}}) is True

    def test_all_known_types_valid(self):
        for t in EVENT_TYPES:
            assert validate_event({"type": t, "payload": {}}) is True


class TestEnrichEvent:
    def test_done_event_attaches_turn_id(self):
        ev = {"type": "done", "payload": {}}
        result = enrich_event(ev, turn_id="turn-1")
        assert result["payload"]["turn_id"] == "turn-1"
        assert result is ev  # modified in place

    def test_done_event_creates_payload_if_missing(self):
        ev = {"type": "done"}
        result = enrich_event(ev, turn_id="turn-2")
        assert result["payload"] == {"turn_id": "turn-2"}

    def test_done_event_no_turn_id_unchanged(self):
        ev = {"type": "done", "payload": {"x": 1}}
        result = enrich_event(ev, turn_id=None)
        assert result == {"type": "done", "payload": {"x": 1}}

    def test_non_done_event_unchanged(self):
        ev = {"type": "token", "payload": {}}
        result = enrich_event(ev, turn_id="turn-3")
        assert result == {"type": "token", "payload": {}}

    def test_done_event_non_dict_payload_skipped(self):
        ev = {"type": "done", "payload": "str"}
        result = enrich_event(ev, turn_id="turn-4")
        assert result == {"type": "done", "payload": "str"}


class TestMakeDoneEvent:
    def test_without_turn_id(self):
        assert make_done_event() == {"type": "done", "payload": {}}

    def test_with_turn_id(self):
        assert make_done_event("turn-x") == {"type": "done", "payload": {"turn_id": "turn-x"}}


class TestMakeErrorEvent:
    def test_minimal(self):
        ev = make_error_event("boom")
        assert ev["type"] == "error"
        assert ev["payload"] == {"code": "AGENT_ERROR", "message": "boom"}

    def test_custom_code(self):
        ev = make_error_event("boom", code="TIMEOUT")
        assert ev["payload"]["code"] == "TIMEOUT"

    def test_with_trace_id(self):
        ev = make_error_event("boom", trace_id="trace-1")
        assert ev["payload"]["trace_id"] == "trace-1"


class TestMakeContextUsageEvent:
    def test_basic(self):
        usage = {"used": 100, "total": 1000}
        assert make_context_usage_event(usage) == {"type": "context_usage", "payload": usage}


def test_event_types_is_frozenset():
    assert isinstance(EVENT_TYPES, frozenset)
    assert "done" in EVENT_TYPES
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_ws_event_mapper.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_ws_event_mapper.py --cov=api.pi_bridge.ws_event_mapper --cov-report=term-missing`
Expected: ws_event_mapper.py → 100%.

- [ ] **Step 4: Commit**

```bash
git add tests/test_pi_bridge/test_ws_event_mapper.py
git commit -m "test(pi_bridge): cover ws_event_mapper validate/enrich/make_* helpers (21%→100%)"
```

---

## Task 2: mcp.py → 85%+

**Files:**
- Create: `tests/test_api/test_mcp_routes.py`

Uncovered: `_load_raw`/`_save_raw` (72-84), `_build_server_dict` (89-128), `_do_reload` (138), all endpoints (153-270). Strategy: monkeypatch `MCP_YAML_PATH` to tmp_path file; use TestClient with the router; provide `app.state.mcp_tools`.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/routes/mcp.py — MCP server config CRUD + reload endpoints."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import mcp as mcp_mod
from api.routes.mcp import router


@pytest.fixture
def app_client(monkeypatch, tmp_path):
    yaml_path = tmp_path / "mcp_servers.yaml"
    monkeypatch.setattr(mcp_mod, "MCP_YAML_PATH", yaml_path)
    app = FastAPI()
    app.state.mcp_tools = []
    app.include_router(router)
    return TestClient(app)


class TestListAndGetServers:
    def test_list_empty(self, app_client):
        resp = app_client.get("/mcp/servers")
        assert resp.status_code == 200
        assert resp.json() == {"servers": [], "tool_count": 0}

    def test_list_counts_mcp_tools(self, app_client):
        app_client.app.state.mcp_tools = ["t1", "t2"]
        resp = app_client.get("/mcp/servers")
        assert resp.json()["tool_count"] == 2

    def test_get_server_not_found(self, app_client):
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404

    def test_get_server_found(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        resp = app_client.get("/mcp/servers/s1")
        assert resp.status_code == 200
        assert resp.json()["server_id"] == "s1"


class TestListServerTools:
    def test_server_not_found(self, app_client):
        resp = app_client.get("/mcp/servers/ghost/tools")
        assert resp.status_code == 404

    def test_returns_empty_tools(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        resp = app_client.get("/mcp/servers/s1/tools")
        assert resp.status_code == 200
        assert resp.json() == {"server_id": "s1", "tools": []}


class TestCreateServer:
    def test_create_stdio_success(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
            "args": ["hi"], "env": {"K": "V"}, "cwd": "/tmp",
            "allowed_tools": ["t1"], "blocked_tools": ["t2"],
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "created"
        assert body["server"] == {
            "server_id": "s1", "transport": "stdio", "enabled": True,
            "description": "", "allowed_tools": ["t1"], "blocked_tools": ["t2"],
            "command": "echo", "args": ["hi"], "env": {"K": "V"}, "cwd": "/tmp",
        }
        assert body["tool_count"] == 0

    def test_create_stdio_missing_command_400(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio",
        })
        assert resp.status_code == 400
        assert "command" in resp.json()["detail"]

    def test_create_sse_success(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s2", "transport": "sse", "url": "http://x",
            "headers": {"h": "v"}, "timeout": 10.0, "sse_read_timeout": 5.0,
        })
        assert resp.status_code == 200
        srv = resp.json()["server"]
        assert srv["url"] == "http://x"
        assert srv["tls_verify"] is True
        assert srv["headers"] == {"h": "v"}
        assert srv["timeout"] == 10.0
        assert srv["sse_read_timeout"] == 5.0

    def test_create_streamable_http_success(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s3", "transport": "streamable_http", "url": "http://x",
        })
        assert resp.status_code == 200
        assert resp.json()["server"]["tls_verify"] is True

    def test_create_websocket_missing_url_400(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s4", "transport": "websocket",
        })
        assert resp.status_code == 400

    def test_create_unsupported_transport_400(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s5", "transport": "ftp",
        })
        assert resp.status_code == 400
        assert "ftp" in resp.json()["detail"]

    def test_create_duplicate_409(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        assert resp.status_code == 409

    def test_create_tls_verify_false(self, app_client):
        resp = app_client.post("/mcp/servers", json={
            "server_id": "s6", "transport": "sse", "url": "http://x", "tls_verify": False,
        })
        assert resp.status_code == 200
        assert resp.json()["server"]["tls_verify"] is False


class TestUpdateServer:
    def test_update_not_found(self, app_client):
        resp = app_client.put("/mcp/servers/ghost", json={"enabled": False})
        assert resp.status_code == 404

    def test_update_partial_fields(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        resp = app_client.put("/mcp/servers/s1", json={
            "enabled": False, "description": "updated", "command": "cat",
        })
        assert resp.status_code == 200
        srv = resp.json()["server"]
        assert srv["enabled"] is False
        assert srv["description"] == "updated"
        assert srv["command"] == "cat"
        assert srv["transport"] == "stdio"  # unchanged

    def test_update_unset_fields_ignored(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        # Only enabled provided; other fields keep their values
        resp = app_client.put("/mcp/servers/s1", json={"enabled": False})
        srv = resp.json()["server"]
        assert srv["command"] == "echo"


class TestDeleteServer:
    def test_delete_not_found(self, app_client):
        resp = app_client.delete("/mcp/servers/ghost")
        assert resp.status_code == 404

    def test_delete_success(self, app_client):
        app_client.post("/mcp/servers", json={
            "server_id": "s1", "transport": "stdio", "command": "echo",
        })
        resp = app_client.delete("/mcp/servers/s1")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"
        assert resp.json()["removed"] == "s1"
        # confirm gone
        assert app_client.get("/mcp/servers/s1").status_code == 404


class TestDiscoveredAndReload:
    def test_discovered_returns_list(self, app_client):
        resp = app_client.get("/mcp/discovered")
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.json()]
        assert "amap" in ids
        assert "filesystem" in ids

    def test_reload_returns_ok(self, app_client):
        resp = app_client.post("/mcp/reload")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["tool_count"] == 0


class TestLoadRawCorrupted:
    def test_load_raw_non_dict_yaml_returns_empty(self, app_client, tmp_path):
        # write a YAML that is a list (non-dict) -> _load_raw returns []
        (tmp_path / "mcp_servers.yaml").write_text("- item\n", encoding="utf-8")
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404  # no servers loaded

    def test_load_raw_missing_file_returns_empty(self, app_client, tmp_path):
        # delete the yaml file
        (tmp_path / "mcp_servers.yaml").unlink(missing_ok=True)
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_routes.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_routes.py --cov=api.routes.mcp --cov-report=term-missing`
Expected: mcp.py → 85%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_mcp_routes.py
git commit -m "test(routes): cover mcp CRUD/reload/discovered endpoints (39%→85%+)"
```

---

## Task 3: mcp_test.py → 85%+

**Files:**
- Create: `tests/test_api/test_mcp_test_routes.py`

Uncovered: `test_connection` body (44-97). Strategy: mock `asyncio.create_subprocess_exec` to cover FileNotFoundError, success (rc=0), non-zero rc, and timeout paths.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/routes/mcp_test.py — test-connection endpoint with mocked subprocess."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.mcp_test import router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _mock_proc(returncode=None, stderr_data=b"", wait_side_effect=None):
    proc = MagicMock()
    proc.returncode = returncode
    proc.wait = MagicMock(side_effect=wait_side_effect)
    stderr = MagicMock()
    stderr.read = AsyncMock(return_value=stderr_data)
    proc.stderr = stderr
    return proc


class TestTestConnection:
    def test_command_not_found(self, client):
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   side_effect=FileNotFoundError("no such file")):
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "ghost-cmd"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "命令不存在" in body["error"]
        assert body["resolved_command"] == "ghost-cmd"

    def test_startup_failure(self, client):
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   side_effect=OSError("boom")):
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "x"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "启动失败" in body["error"]

    def test_success_zero_exit_code(self, client):
        proc = _mock_proc(returncode=0)
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   return_value=proc) as mock_exec:
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "echo", "args": ["hi"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["error"] is None
        assert body["resolved_command"] == "echo"
        mock_exec.assert_called_once()

    def test_non_zero_exit_code(self, client):
        proc = _mock_proc(returncode=2, stderr_data=b"some error")
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   return_value=proc):
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "failer"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "进程退出码 2" in body["error"]
        assert "some error" in body["error"]

    def test_timeout_means_success(self, client):
        # First wait_for (5s) raises TimeoutError -> process running -> success
        proc = _mock_proc(wait_side_effect=asyncio.TimeoutError)
        proc.terminate = MagicMock()
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   return_value=proc), \
             patch("api.routes.mcp_test.asyncio.wait_for",
                   side_effect=[asyncio.TimeoutError(), None]):
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "long-running"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        proc.terminate.assert_called_once()

    def test_timeout_then_kill(self, client):
        # First wait_for raises TimeoutError; second wait_for (after terminate) also times out -> kill
        proc = _mock_proc(wait_side_effect=asyncio.TimeoutError)
        proc.terminate = MagicMock()
        proc.kill = MagicMock()
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   return_value=proc), \
             patch("api.routes.mcp_test.asyncio.wait_for",
                   side_effect=[asyncio.TimeoutError(), asyncio.TimeoutError()]):
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "stubborn"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        proc.terminate.assert_called_once()
        proc.kill.assert_called_once()

    def test_env_merged_with_os_environ(self, client):
        proc = _mock_proc(returncode=0)
        with patch("api.routes.mcp_test.asyncio.create_subprocess_exec",
                   return_value=proc) as mock_exec:
            resp = client.post("/api/mcp/test-connection",
                               json={"command": "echo", "env": {"CUSTOM": "1"}})
        assert resp.status_code == 200
        _, kwargs = mock_exec.call_args
        assert kwargs["env"]["CUSTOM"] == "1"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_test_routes.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_mcp_test_routes.py --cov=api.routes.mcp_test --cov-report=term-missing`
Expected: mcp_test.py → 85%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_mcp_test_routes.py
git commit -m "test(routes): cover mcp test-connection subprocess paths (44%→85%+)"
```

---

## Task 4: workflows.py → 80%+

**Files:**
- Create: `tests/test_api/test_workflows_routes_enabled.py`

Uncovered: `_WorkflowDisabled` (37), `_require_runtime` (41-46), `_require_parent_session` (50-52), `_get_parent_run` (56-61), and enabled-path endpoints (106-163). Strategy: monkeypatch `_workflow_enabled`→True; provide fake `workflow_run_manager`, `session_manager`, fake store/registry.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/routes/workflows.py — enabled-path routes with fake runtime."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import workflows as wf_mod
from api.routes.workflows import (
    _WorkflowDisabled,
    _get_parent_run,
    _public_cancel_reason,
    _public_run,
    _public_step,
    _require_parent_session,
    _require_runtime,
    router,
)


class _FakeStep:
    def __init__(self, step_id="s1", position=0, status="succeeded",
                 attempts=1, checkpoint={"data": "ok"}):
        self.step_id = step_id
        self.position = position
        self.status = status
        self.attempts = attempts
        self.checkpoint = checkpoint


class _FakeRun:
    def __init__(self, run_id="r1", parent_turn_id="t1", workflow_id="wf-1",
                 workflow_version=1, status="succeeded", current_step_id="s1",
                 failure_code=None, cancel_reason=None, created_at="c",
                 updated_at="u", parent_session_id="sess1"):
        self.run_id = run_id
        self.parent_turn_id = parent_turn_id
        self.workflow_id = workflow_id
        self.workflow_version = workflow_version
        self.status = status
        self.current_step_id = current_step_id
        self.failure_code = failure_code
        self.cancel_reason = cancel_reason
        self.created_at = created_at
        self.updated_at = updated_at
        self.parent_session_id = parent_session_id


class _FakeStore:
    def __init__(self, runs, steps):
        self._runs = runs
        self._steps = steps

    def get(self, run_id):
        return self._runs.get(run_id)

    def list_parent_runs(self, session_id, limit=50):
        return [r for r in self._runs.values() if r.parent_session_id == session_id][:limit]

    def list_steps(self, run_id):
        return self._steps.get(run_id, [])

    def submit(self, parent_session_id, parent_turn_id, definition):
        run = _FakeRun(parent_session_id=parent_session_id,
                       parent_turn_id=parent_turn_id, status="queued")
        self._runs[run.run_id] = run
        self._steps[run.run_id] = []
        return run


class _FakeDefinition:
    workflow_id = "my-wf"


class _FakeRegistry:
    def list_ids(self):
        return ["my-wf"]

    def require(self, workflow_id):
        if workflow_id != "my-wf":
            raise KeyError(workflow_id)
        return _FakeDefinition()


class _FakeManager:
    def __init__(self, store):
        self.store = store
        self.registry = _FakeRegistry()
        self.cancelled = []
        self.resumed = []
        self.submitted = []

    def submit(self, run):
        self.submitted.append(run)

    async def cancel(self, run_id):
        self.cancelled.append(run_id)
        run = self.store.get(run_id)
        if run is not None:
            run.status = "cancelled"
            run.cancel_reason = "cancelled_by_user"

    def resume(self, run_id):
        self.resumed.append(run_id)
        run = self.store.get(run_id)
        if run is not None:
            run.status = "running"
        return True


class _FakeSessionManager:
    def __init__(self, valid_sessions):
        self._valid = valid_sessions

    async def get(self, session_id):
        return self._valid.get(session_id)


@pytest.fixture
def enabled_app(monkeypatch):
    monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
    run = _FakeRun(status="queued")
    store = _FakeStore({"r1": run}, {"r1": [_FakeStep()]})
    manager = _FakeManager(store)
    app = FastAPI()
    app.state.workflow_run_manager = manager
    app.state.session_manager = _FakeSessionManager({"sess1": object()})
    app.include_router(router)
    return TestClient(app), manager, store


class TestRequireRuntimeHelpers:
    def test_workflow_disabled_default_detail(self):
        exc = _WorkflowDisabled()
        assert exc.status_code == 404
        assert exc.detail == "Workflows are unavailable"

    def test_require_runtime_disabled_raises(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: False)
        from starlette.requests import Request
        scope = {"type": "http", "app": FastAPI()}
        req = Request(scope)
        with pytest.raises(_WorkflowDisabled):
            _require_runtime(req)

    def test_require_runtime_no_manager_raises_503(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        from starlette.requests import Request
        app = FastAPI()
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            _require_runtime(req)
        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_require_parent_session_not_found(self, monkeypatch):
        app = FastAPI()
        app.state.session_manager = _FakeSessionManager({})
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _require_parent_session(req, "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_require_parent_session_no_manager(self, monkeypatch):
        app = FastAPI()
        app.state.session_manager = None
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _require_parent_session(req, "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_parent_run_not_found(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        app = FastAPI()
        run = _FakeRun()
        store = _FakeStore({}, {})
        manager = _FakeManager(store)
        app.state.workflow_run_manager = manager
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(req, "sess1", "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_parent_run_wrong_session(self, monkeypatch):
        monkeypatch.setattr(wf_mod, "_workflow_enabled", lambda: True)
        app = FastAPI()
        run = _FakeRun(parent_session_id="other")
        store = _FakeStore({"r1": run}, {})
        manager = _FakeManager(store)
        app.state.workflow_run_manager = manager
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(req, "sess1", "r1")
        assert exc_info.value.status_code == 404


class TestEnabledRoutes:
    def test_list_definitions(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/workflows/definitions")
        assert resp.status_code == 200
        assert resp.json() == {"workflow_ids": ["my-wf"]}

    def test_start_workflow_success(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post("/sessions/sess1/workflows",
                           json={"workflow_id": "my-wf", "parent_turn_id": "t1"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "queued"
        assert body["workflow_id"] == "my-wf"
        assert len(manager.submitted) == 1

    def test_start_workflow_unknown_id_422(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.post("/sessions/sess1/workflows",
                           json={"workflow_id": "nope"})
        assert resp.status_code == 422
        assert resp.json()["detail"] == "Unsupported workflow"

    def test_start_workflow_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.post("/sessions/ghost/workflows",
                           json={"workflow_id": "my-wf"})
        assert resp.status_code == 404

    def test_list_workflows(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows")
        assert resp.status_code == 200
        runs = resp.json()["runs"]
        assert len(runs) == 1
        assert runs[0]["run_id"] == "r1"

    def test_get_workflow(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows/r1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"] == "r1"
        assert "steps" in body

    def test_get_workflow_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/workflows/ghost")
        assert resp.status_code == 404

    def test_cancel_queued_workflow(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post("/sessions/sess1/workflows/r1/cancel")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason"] == "cancelled_by_user"
        assert manager.cancelled == ["r1"]

    def test_cancel_already_finished_workflow(self, enabled_app, store=None):
        client, manager, store = enabled_app
        # mark run as already finished -> cancel is a no-op
        store._runs["r1"].status = "succeeded"
        resp = client.post("/sessions/sess1/workflows/r1/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "succeeded"
        assert manager.cancelled == []

    def test_resume_failed_workflow(self, enabled_app):
        client, manager, store = enabled_app
        store._runs["r1"].status = "failed"
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 200
        assert resp.json()["status"] == "running"
        assert manager.resumed == ["r1"]

    def test_resume_non_failed_409(self, enabled_app):
        client, _, _ = enabled_app
        # run is "queued", not "failed" -> 409
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 409

    def test_resume_when_manager_returns_false_409(self, enabled_app, monkeypatch):
        client, manager, store = enabled_app
        store._runs["r1"].status = "failed"
        monkeypatch.setattr(manager, "resume", lambda run_id: False)
        resp = client.post("/sessions/sess1/workflows/r1/resume")
        assert resp.status_code == 409


class TestPublicHelpersExtra:
    def test_public_step_running(self):
        s = _FakeStep(status="running")
        assert _public_step(s)["checkpoint"] is None

    def test_public_cancel_reason_non_cancelled(self):
        assert _public_cancel_reason(_FakeRun(status="running")) is None
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_workflows_routes_enabled.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_workflows_routes_enabled.py --cov=api.routes.workflows --cov-report=term-missing`
Expected: workflows.py → 80%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_workflows_routes_enabled.py
git commit -m "test(routes): cover workflows enabled-path + helpers (53%→80%+)"
```

---

## Task 5: deferred_runs.py → 85%+

**Files:**
- Create: `tests/test_api/test_deferred_runs_routes_enabled.py`

Uncovered: `_require_runtime` (23-29), `_get_parent_run` (42-48), enabled `list_deferred_runs` (92-95), `get_deferred_run` (101), `cancel_deferred_run` (107-112), `get_deferred_run_audit` (120-125). Strategy: monkeypatch `_async_subagent_enabled`→True; fake manager/store/session_manager; test audit with ImportError fallback.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/routes/deferred_runs.py — enabled-path routes + audit fallback."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import deferred_runs as dr_mod
from api.routes.deferred_runs import (
    _async_subagent_enabled,
    _get_parent_run,
    _public_cancel_reason,
    _public_run,
    _require_parent_session,
    _require_runtime,
    router,
)


class _FakeRun:
    def __init__(self, run_id="r1", parent_turn_id="t1", status="succeeded",
                 result_ref=None, result=None, cancel_reason=None,
                 deadline_at=None, attempts=1, created_at="c", updated_at="u"):
        self.run_id = run_id
        self.parent_turn_id = parent_turn_id
        self.status = status
        self.result_ref = result_ref
        self.result = result
        self.cancel_reason = cancel_reason
        self.deadline_at = deadline_at
        self.attempts = attempts
        self.created_at = created_at
        self.updated_at = updated_at


class _FakeStore:
    def __init__(self, runs):
        self._runs = runs  # dict run_id -> run

    def get(self, run_id, parent_session_id=None):
        run = self._runs.get(run_id)
        return run

    def list_parent_runs(self, session_id, limit=50):
        return list(self._runs.values())[:limit]


class _FakeManager:
    def __init__(self, store):
        self.store = store
        self.cancelled = []

    async def cancel(self, run_id, reason):
        self.cancelled.append((run_id, reason))
        run = self.store.get(run_id)
        if run is not None:
            run.status = "cancelled"
            run.cancel_reason = reason


class _FakeSessionManager:
    def __init__(self, valid_sessions):
        self._valid = valid_sessions

    async def get(self, session_id):
        return self._valid.get(session_id)


@pytest.fixture
def enabled_app(monkeypatch):
    monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
    run = _FakeRun(status="queued")
    store = _FakeStore({"r1": run})
    manager = _FakeManager(store)
    app = FastAPI()
    app.state.deferred_subagent_run_manager = manager
    app.state.session_manager = _FakeSessionManager({"sess1": object()})
    app.include_router(router)
    return TestClient(app), manager, store


class TestRequireRuntimeHelpers:
    def test_require_runtime_disabled_raises_404(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: False)
        from starlette.requests import Request
        app = FastAPI()
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            _require_runtime(req)
        assert exc_info.value.status_code == 404

    def test_require_runtime_no_manager_503(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
        from starlette.requests import Request
        app = FastAPI()
        app.state.deferred_subagent_run_manager = None
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            _require_runtime(req)
        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_require_parent_session_not_found(self):
        app = FastAPI()
        app.state.session_manager = _FakeSessionManager({})
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _require_parent_session(req, "ghost")
        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_get_parent_run_not_found(self, monkeypatch):
        monkeypatch.setattr(dr_mod, "_async_subagent_enabled", lambda: True)
        app = FastAPI()
        store = _FakeStore({})
        app.state.deferred_subagent_run_manager = _FakeManager(store)
        app.state.session_manager = _FakeSessionManager({"sess1": object()})
        from starlette.requests import Request
        scope = {"type": "http", "app": app}
        req = Request(scope)
        with pytest.raises(Exception) as exc_info:
            await _get_parent_run(req, "sess1", "ghost")
        assert exc_info.value.status_code == 404


class TestEnabledRoutes:
    def test_list_runs(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs")
        assert resp.status_code == 200
        runs = resp.json()["runs"]
        assert len(runs) == 1
        assert runs[0]["run_id"] == "r1"

    def test_list_runs_session_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/ghost/deferred-runs")
        assert resp.status_code == 404

    def test_list_runs_limit_clamped(self, enabled_app):
        client, _, _ = enabled_app
        # limit above 100 clamped to 100; below 1 clamped to 1
        resp = client.get("/sessions/sess1/deferred-runs?limit=9999")
        assert resp.status_code == 200

    def test_get_run(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/r1")
        assert resp.status_code == 200
        assert resp.json()["run_id"] == "r1"

    def test_get_run_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/ghost")
        assert resp.status_code == 404

    def test_cancel_queued_run(self, enabled_app):
        client, manager, _ = enabled_app
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason"] == "cancelled_by_user"
        assert manager.cancelled == [("r1", "cancelled_by_user")]

    def test_cancel_already_finished_run(self, enabled_app):
        client, manager, store = enabled_app
        store._runs["r1"].status = "succeeded"
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 200
        assert resp.json()["status"] == "succeeded"
        assert manager.cancelled == []

    def test_cancel_run_disappears_mid_request(self, enabled_app):
        client, manager, store = enabled_app
        # Simulate cancel causing the run to vanish from store
        async def cancel_and_remove(run_id, reason):
            manager.cancelled.append((run_id, reason))
            del store._runs[run_id]
        manager.cancel = cancel_and_remove
        resp = client.post("/sessions/sess1/deferred-runs/r1/cancel")
        assert resp.status_code == 404

    def test_get_audit(self, enabled_app, monkeypatch):
        client, _, _ = enabled_app
        # Provide a fake read_subagent_run_events via the agent.audit_log module
        import sys
        fake_mod = type(sys)("agent.audit_log")
        fake_mod.read_subagent_run_events = lambda run_id: [{"e": "created"}]
        monkeypatch.setitem(sys.modules, "agent.audit_log", fake_mod)
        resp = client.get("/sessions/sess1/deferred-runs/r1/audit")
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"] == "r1"
        assert body["events"] == [{"e": "created"}]

    def test_get_audit_import_error_returns_empty(self, enabled_app, monkeypatch):
        client, _, _ = enabled_app
        # Force ImportError by removing the module
        import sys
        monkeypatch.setitem(sys.modules, "agent.audit_log", None)
        resp = client.get("/sessions/sess1/deferred-runs/r1/audit")
        assert resp.status_code == 200
        assert resp.json()["events"] == []

    def test_get_audit_run_not_found(self, enabled_app):
        client, _, _ = enabled_app
        resp = client.get("/sessions/sess1/deferred-runs/ghost/audit")
        assert resp.status_code == 404


class TestPublicHelpersExtra:
    def test_public_run_failed(self):
        run = _FakeRun(status="failed")
        assert _public_run(run)["error_code"] == "deferred_run_failed"

    def test_public_run_succeeded_hides_error_code(self):
        run = _FakeRun(status="succeeded")
        assert "error_code" not in _public_run(run)

    def test_public_cancel_reason_parent_closed(self):
        run = _FakeRun(status="cancelled", cancel_reason="parent_session_closed")
        assert _public_cancel_reason(run) == "parent_session_closed"

    def test_async_subagent_enabled_default(self):
        # Without monkeypatch, real settings path; just ensure it returns a bool
        assert isinstance(_async_subagent_enabled(), bool)
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_deferred_runs_routes_enabled.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_deferred_runs_routes_enabled.py --cov=api.routes.deferred_runs --cov-report=term-missing`
Expected: deferred_runs.py → 85%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_deferred_runs_routes_enabled.py
git commit -m "test(routes): cover deferred_runs enabled-path + audit fallback (60%→85%+)"
```

---

## Task 6: files.py → 90%+

**Files:**
- Create: `tests/test_api/test_files_extra.py`

Uncovered: DPI awareness (45-49), DPI scaling (58-59), folder dialog (63), ImportError (82-85), generic exception (86-87). Strategy: patch tkinter; test folder type; force ImportError; force generic Exception.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/routes/files.py — folder dialog, ImportError, exception paths."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from api.routes.files import select_file


@pytest.mark.asyncio
async def test_select_folder_success(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    try:
        import tkinter  # noqa: F401
    except ImportError:
        pytest.skip("tkinter not available")

    with patch("tkinter.Tk", return_value=MagicMock()), patch(
        "tkinter.filedialog.askdirectory", return_value="/tmp/myfolder"
    ):
        result = await select_file(type="folder")
    assert result == {"path": "/tmp/myfolder"}


@pytest.mark.asyncio
async def test_select_file_returns_none_path(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    try:
        import tkinter  # noqa: F401
    except ImportError:
        pytest.skip("tkinter not available")

    # askopenfilename returns "" -> path None
    with patch("tkinter.Tk", return_value=MagicMock()), patch(
        "tkinter.filedialog.askopenfilename", return_value=""
    ):
        result = await select_file()
    assert result == {"path": None}


@pytest.mark.asyncio
async def test_select_file_import_error(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    # Force tkinter import to fail inside select_file by raising ImportError on import
    import builtins
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "tkinter":
            raise ImportError("no tkinter")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(HTTPException) as exc_info:
        await select_file()
    assert exc_info.value.status_code == 500
    assert "tkinter 不可用" in exc_info.value.detail


@pytest.mark.asyncio
async def test_select_file_generic_exception(monkeypatch):
    monkeypatch.setenv("MAXMA_ENV", "development")
    try:
        import tkinter  # noqa: F401
    except ImportError:
        pytest.skip("tkinter not available")

    # Tk() raises a generic exception
    with patch("tkinter.Tk", side_effect=RuntimeError("boom")):
        with pytest.raises(HTTPException) as exc_info:
            await select_file()
    assert exc_info.value.status_code == 500
    assert "打开文件对话框失败" in exc_info.value.detail
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_files_extra.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_files_extra.py --cov=api.routes.files --cov-report=term-missing`
Expected: files.py → 90%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_files_extra.py
git commit -m "test(routes): cover files folder/import-error/exception paths (75%→90%+)"
```

---

## Task 7: auth.py → 90%+

**Files:**
- Create: `tests/test_api/test_auth_middleware_extra.py`

Uncovered: OPTIONS passthrough (33), WS subprotocol injection (51-60), WS token via subprotocol (83-88), WS close reject (95). Strategy: use the `client` fixture from conftest (AuthMiddleware on minimal_app); test OPTIONS; use raw ASGI scope for websocket subprotocol paths.

- [ ] **Step 1: Write the test file**

```python
"""Tests for api/middleware/auth.py — OPTIONS preflight, WS subprotocol injection, WS token."""

from unittest.mock import MagicMock

from starlette.testclient import TestClient

from api.middleware.auth import AuthMiddleware


class TestOptionsPreflight:
    def test_options_passthrough_no_token(self, client):
        """CORS preflight OPTIONS bypasses auth (line 33)."""
        resp = client.options("/api/test")
        # TestClient returns 405 because GET-only route, but NOT 401 -> auth bypassed
        assert resp.status_code != 401


class TestWsSubprotocolInjection:
    """Cover lines 51-60: WS accept message gets subprotocol injected."""

    def test_ws_accept_with_subprotocol(self, client, auth_token):
        """Authenticated WS handshake with subprotocol -> accept message enriched."""
        captured = {}

        async def app(scope, receive, send):
            # Record the (possibly wrapped) send
            captured["send"] = send
            await send({"type": "websocket.accept"})

        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": ["my-token-123"],
            "app": client.app,
        }

        import asyncio
        middleware = AuthMiddleware(app)
        asyncio.run(middleware(scope, MagicMock(), MagicMock()))

        # The app received a wrapped send; verify by inspecting behavior would require
        # capturing the outgoing message. Re-run with a capturing send.
        sent = []

        async def capturing_app(scope, receive, send):
            captured["send"] = send
            await send({"type": "websocket.accept"})

        middleware2 = AuthMiddleware(capturing_app)

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware2(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0]["type"] == "websocket.accept"
        assert sent[0]["subprotocol"] == "my-token-123"

    def test_ws_accept_with_existing_subprotocol_not_overwritten(self, client, auth_token):
        """If handler already set a subprotocol, middleware does not overwrite (line 56)."""
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept", "subprotocol": "existing"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": ["my-token-123"],
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0]["subprotocol"] == "existing"

    def test_ws_no_subprotocols_no_wrapping(self, client, auth_token):
        """WS handshake without subprotocols -> no wrapping, header token used."""
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [(b"x-maxma-token", auth_token.encode())],
            "subprotocols": [],
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        # No subprotocol injected because subprotocols list is empty
        assert sent[0] == {"type": "websocket.accept"}


class TestWsTokenViaSubprotocol:
    """Cover lines 83-88: token extracted from WS subprotocols."""

    def test_ws_token_from_subprotocol_authenticates(self, client, auth_token):
        """Valid token in subprotocol -> authenticated (no 401)."""
        import asyncio

        reached_app = False

        async def app(scope, receive, send):
            nonlocal reached_app
            reached_app = True
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": [auth_token],
            "app": client.app,
        }

        async def final_send(message):
            pass

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert reached_app is True

    def test_ws_short_subprotocol_token_rejected(self, client):
        """Subprotocol token shorter than 8 chars -> rejected (line 87 length check)."""
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": ["short"],  # < 8 chars
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0] == {"type": "websocket.close", "code": 4001}

    def test_ws_subprotocol_token_starting_with_dash_rejected(self, client):
        """Subprotocol token starting with '-' -> rejected (line 87 dash check)."""
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": ["-inject-flag"],
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0] == {"type": "websocket.close", "code": 4001}


class TestWsReject:
    """Cover line 95: WS reject sends close code 4001."""

    def test_ws_no_token_rejected_with_4001(self, client):
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [],
            "subprotocols": [],
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0] == {"type": "websocket.close", "code": 4001}

    def test_ws_wrong_header_token_rejected(self, client):
        import asyncio

        sent = []

        async def app(scope, receive, send):
            await send({"type": "websocket.accept"})

        middleware = AuthMiddleware(app)
        scope = {
            "type": "websocket",
            "path": "/ws/test",
            "headers": [(b"x-maxma-token", b"wrong-token-value")],
            "subprotocols": [],
            "app": client.app,
        }

        async def final_send(message):
            sent.append(message)

        async def run():
            await middleware(scope, MagicMock(), final_send)

        asyncio.run(run())
        assert sent[0] == {"type": "websocket.close", "code": 4001}


class TestStickersWhitelist:
    def test_stickers_path_whitelisted(self, client):
        """/api/stickers prefix is whitelisted (line 36)."""
        # No route registered, but auth should pass -> 404 not 401
        resp = client.get("/api/stickers/anything.png")
        assert resp.status_code != 401

    def test_auth_token_path_whitelisted(self, client):
        """/api/auth/token is whitelisted (line 36)."""
        resp = client.get("/api/auth/token")
        assert resp.status_code != 401
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_auth_middleware_extra.py -v`
Expected: PASS (all tests).

- [ ] **Step 3: Verify coverage boost**

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_auth_middleware_extra.py --cov=api.middleware.auth --cov-report=term-missing`
Expected: auth.py → 90%+.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api/test_auth_middleware_extra.py
git commit -m "test(middleware): cover auth OPTIONS/WS subprotocol/reject paths (67%→90%+)"
```

---

## Task 8: Final verification + ruff

- [ ] **Step 1: Run full test suite with coverage**

Run:
```
cd d:\Maxma\MaxmaHere
.venv\Scripts\python.exe -m pytest tests/ --cov=api --cov-report=term -q
```
Expected: all tests pass; each target module ≥ 70%; api TOTAL ≥ 75% (already 79%, should rise).

- [ ] **Step 2: Run ruff on new test files**

Run:
```
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
```
Expected: no errors.

- [ ] **Step 3: Final commit (if any cleanup)**

If ruff required fixes, commit them:
```bash
git add tests/
git commit -m "test: ruff cleanup for new coverage tests"
```

## Self-Review Notes

- All 7 modules have a dedicated Task with happy + error paths mapped to the exact missing line ranges.
- No source files are modified; only new test files are created under `tests/test_api/` and `tests/test_pi_bridge/`.
- No existing test files are touched (constraint respected).
- Test isolation via `tmp_path` (mcp YAML) and `monkeypatch` (feature flags, MCP_YAML_PATH) prevents cross-test leakage.
- The conftest `_reset_global_state` autouse fixture keeps global singletons clean.
