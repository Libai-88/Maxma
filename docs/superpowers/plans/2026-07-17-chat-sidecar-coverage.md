# Chat & Sidecar Manager Coverage Final Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Increase coverage for `api/routes/chat.py` (85%) to 92%+ and `api/pi_bridge/sidecar_manager.py` (89%) to 95%+.

**Architecture:** Read each module → identify uncovered lines → design tests for error/edge paths → implement → verify.

**Tech Stack:** Python 3.13, FastAPI, pytest, WebSocket testing (pytest-asyncio `auto` mode)

## Baseline (measured 2026-07-17)

```
api/pi_bridge/sidecar_manager.py   114   12   89%   20, 222-239, 243
api/routes/chat.py                 208   32   85%   78, 90-103, 112-128, 155, 162-176, 185-186, 348-349
TOTAL                              322   44   86%
```

## Constraints

- **Only create new test files.** Never modify production source.
- Do NOT touch existing test files (incl. `tests/test_api/test_chat_routes_extra.py`,
  `tests/test_api/test_chat_silent_except.py`, `tests/test_pi_bridge/test_sidecar_manager*.py`).
- Do NOT touch other agents' file ranges.
- Run tests via: `.venv\Scripts\python.exe -m pytest tests/ -v`
- Ruff gate: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`

## Uncovered line analysis

### `api/pi_bridge/sidecar_manager.py`

| Lines | What | Why uncovered | Strategy |
|------|------|--------------|----------|
| 20 | `sys.path.insert(0, str(_project_root))` | project root already on `sys.path` during tests | Re-exec module source after removing root from `sys.path` |
| 222-239 | `_test()` self-test body (10 executable stmts) | only runs under `__main__` | Call `_test()` directly with mocked `SidecarManager` / subprocess / sleep |
| 243 | `asyncio.run(_test())` under `if __name__ == "__main__":` | only runs when file is `__main__` | Re-exec source with `__name__ == "__main__"` and `asyncio.run` mocked |

Target after: 1 missing (line 243 optional) → 99.1%+ ; guaranteed ≥ 95%.

### `api/routes/chat.py`

| Lines | What | Why uncovered | Strategy |
|------|------|--------------|----------|
| 78 | `raise RuntimeError("Sidecar client not available after start()")` | requires `mgr.client is None` after `start()` | Direct call `_stream_turn_sidecar` with mocked mgr whose `client` is `None` |
| 90-103 | Stale session validation try/except | existing tests use `get_sidecar_id=None` | Two tests: success path (sid valid) + except path (stale sid cleared) |
| 112-128 | Past turns restoration block + its except | existing tests return `[]` for `get_recent_turns` | Two tests: non-empty turns (build history) + turns-raises (except branch) |
| 155 | `return` when `sid != sidecar_sid` in `_make_handler` | handlers always invoked with matching sid in existing tests | Invoke captured handler with mismatched sid |
| 162-176 | `tool_start` / `tool_end` / `tool_error` / `error` handler branches | existing tests only exercise `token` | Invoke captured handlers for each event type with matching sid |
| 185-186 | `_on_answer` handler body | never invoked in existing tests | Invoke captured `answer` handler with matching sid + payload |
| 348-349 | `append_turn` exception handler in `websocket_chat` | existing happy-path mock doesn't raise | WebSocket test where `SessionMap.append_turn` raises |

Target after: 0-2 missing → 99%+ ; guaranteed ≥ 92%.

## Tasks

### Task 1 — sidecar_manager.py coverage push

Create `tests/test_pi_bridge/test_sidecar_mgr_push.py` with:

1. `test_test_function_runs_with_mocked_subprocess` — covers lines 222-239.
   - Monkeypatch `asyncio.create_subprocess_exec` to return a mock proc
     (returncode=None, stdin/stdout/stderr = MagicMock, terminate/kill/wait mocked).
   - Monkeypatch `asyncio.sleep` to no-op.
   - Monkeypatch `JsonRpcClient.start_reading` and `stop` to AsyncMock.
   - Make `proc.stderr` an async iterable that immediately EOFs so `_forward_stderr`
     exits.
   - Call `await sm_mod._test()` directly (auto asyncio mode).
   - Assert no exception raised.
2. `test_module_path_insertion_when_root_missing` — covers line 20.
   - Remove `str(_project_root)` from `sys.path` (save/restore).
   - Re-exec the module source via `exec(compile(src, path, "exec"), g)` with
     `__name__ = "test_reexec"`.
   - Assert `_project_root` was re-inserted into `sys.path`.
3. `test_main_block_invokes_asyncio_run_with_test` — covers line 243.
   - Use a `dict` subclass that blocks re-definition of `_test` so our no-op
     async fake survives source re-exec.
   - Monkeypatch the real `asyncio.run` to capture + close the coroutine.
   - Exec module source with `__name__ == "__main__"` and the protected globals.
   - Assert `asyncio.run` was called.

Run: `.venv\Scripts\python.exe -m pytest tests/test_pi_bridge/test_sidecar_mgr_push.py -v`
Commit: `test: cover sidecar_manager _test body, sys.path insert, __main__ block`

### Task 2 — chat.py coverage push

Create `tests/test_api/test_chat_routes_push.py` with:

1. `TestStreamTurnSidecarClientNone` — line 78.
   - Mock `ws.app.state.sidecar_manager` whose `start()` is AsyncMock but
     `client` attribute is `None`.
   - `pytest.raises(RuntimeError)`.
2. `TestStaleSessionValidation`:
   - `test_existing_valid_session_skips_create` — lines 90-95 (try success).
     SessionMap returns a sidecar_id; `client.call("get_messages", ...)` returns
     `{}`. Then `client.call("prompt", ...)` triggers `done` handler.
     Assert `create_session` NOT called.
   - `test_stale_session_cleared_and_recreated` — lines 96-103 (except).
     First `get_messages` raises; `remove()` should be called; then
     `create_session` returns a new sid.
3. `TestPastTurnsRestore`:
   - `test_past_turns_appended_to_system_prompt` — lines 112-126.
     `get_recent_turns` returns 2 turns; assert `create_session` params include
     "[历史对话上下文（共 2 轮）]".
   - `test_past_turns_failure_logged_and_skipped` — lines 127-128.
     `get_recent_turns` raises; assert `create_session` still called with
     original `system_prompt` (no history prefix).
4. `TestEventHandlerBranches` — lines 155, 162-176, 185-186.
   - Capture handlers via `client.on` mock.
   - `test_handler_returns_early_on_sid_mismatch` — call token handler with
     wrong sid; assert `ws.send_json` not called.
   - `test_tool_start_handler_sends_payload` — invoke `tool_start` handler.
   - `test_tool_end_handler_sends_payload` — invoke `tool_end` handler.
   - `test_tool_error_handler_sends_payload` — invoke `tool_error` handler.
   - `test_error_handler_logs_and_sends` — invoke `error` handler.
   - `test_on_answer_handler_sets_final_answer` — invoke `answer` handler;
     assert returned `final_answer` matches payload content.
5. `TestAppendTurnException` — lines 348-349.
   - WebSocket happy-path test where `SessionMap.append_turn` raises.
   - Assert WebSocket still returns `answer` + `done` (debug log swallowed).

Run: `.venv\Scripts\python.exe -m pytest tests/test_api/test_chat_routes_push.py -v`
Commit: `test: cover chat.py stale session, past turns, handlers, append_turn exc`

### Task 3 — Final verification

1. Run full coverage:
   ```
   .venv\Scripts\python.exe -m pytest tests/ --cov=api.routes.chat --cov=api.pi_bridge.sidecar_manager --cov-report=term-missing -q
   ```
2. Run ruff gate:
   ```
   .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
   ```
3. Record before/after numbers in the final report.

## Risks / Notes

- `_stream_turn_sidecar` references `ws.app.state.sidecar_manager` directly; tests
  must set up a MagicMock `ws.app.state` chain.
- WebSocket tests in Task 2.5 need a minimal FastAPI app with `chat.router` —
  copy the `ws_app` fixture pattern from `test_chat_routes_extra.py` but vary the
  `SessionMap` mock so `append_turn` raises.
- Re-executing module source (Task 1.2, 1.3) is safe — module-level code is just
  imports and constant assignments.
- All async tests rely on `asyncio_mode = "auto"` from `pyproject.toml`.
