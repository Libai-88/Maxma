# Core Module Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase coverage for 6 core modules (sessions, chat, sidecar_manager, rpc_client, session_adapter, server) from ~35% to 60%+ each, lifting the overall backend coverage from 60% to 65%+.

**Architecture:** Read each module's source → design supplementary tests for happy/error/edge paths using `fastapi.testclient.TestClient` (for routes) and direct calls with mocks (for non-route modules) → implement → verify by running pytest + ruff → commit per module. Only create new test files; do not modify production source.

**Tech Stack:** Python 3.13, FastAPI, pytest, pytest-asyncio, pytest-cov, unittest.mock.

---

## Baseline (measured 2026-07-17)

```
TOTAL  5647 stmts  2238 missing  60%   (630 passed, 7 skipped)
```

| Module | Stmts | Missing | % | Target |
|---|---|---|---|---|
| `api/routes/sessions.py` | 308 | 214 | 31% | 60%+ |
| `api/routes/chat.py` | 208 | 120 | 42% | 60%+ |
| `api/pi_bridge/sidecar_manager.py` | 114 | 67 | 41% | 60%+ |
| `api/pi_bridge/rpc_client.py` | 118 | 73 | 38% | 60%+ |
| `api/pi_bridge/session_adapter.py` | 81 | 56 | 31% | 60%+ |
| `api/server.py` | 117 | 75 | 36% | 60%+ |

### Missing-line summary per module

- **sessions.py**: 123-126 (perm-mode 422), 133-198 (get_messages sidecar path + fallback), 203-251 (_sync_const_session_after_undo), 270-292 (undo sidecar path), 300-343 (get_context_usage), 353-376 (delete sidecar cleanup), 389-435 (constify_session), 445-514 (generate_session_title), 527-528 (unconstify_session).
- **chat.py**: 35-57 (_get_messages_from_sidecar), 78 (client None raise), 90-103 (stale session check), 112-128 (past turns restore), 155-186 (event handlers + prompt call), 243-247 (_calculate_context_usage), 260-264 (_new_turn_id), 271-292 (_save_const_session), 301-374 (websocket_chat).
- **sidecar_manager.py**: 20 (sys.path), 43-53 (_resolve_bun_path), 68-71/86/91/96 (properties), 107-143 (start), 158-191 (stop branches), 197-199 (restart), 205-213 (_forward_stderr).
- **rpc_client.py**: 18-19 (JsonRpcError), 47-50 (start_reading), 70-99 (call), 132-139 (stop/is_running), 145-169 (_read_loop), 174-207 (_dispatch).
- **session_adapter.py**: 29-55 (__init__ + migration), 57-117 (CRUD), 124-145 (append_turn), 149-166 (get_recent_turns + list_all), 179-187 (count + close).
- **server.py**: 54-71 (lifespan), 75-179 (create_app incl. production static branches).

---

## Constraints

- **Only create new test files** under `tests/test_api/` or `tests/test_pi_bridge/`.
- **Do NOT modify** any production source under `api/` or `agent/` (record real bugs if found — do not fix in tests).
- **Do NOT modify** other agents' files: `pyproject.toml`, `requirements-lock.txt`, `bun-sidecar/`, `web/`, `.github/workflows/`, existing `tests/test_api/test_files.py`, `tests/test_api/test_rate_limit.py`, or any other existing test file.
- Run tests: `.venv\Scripts\python.exe -m pytest tests/ -v`
- Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
- Commit after each module's tests pass.

### Shared test helpers (patterns reused across modules)

- `_FakeSession` / `_FakeSessionManager`: mimic `SessionState` / `SessionManager` (see existing `test_sessions_routes_extra.py` pattern).
- `_FakeSidecarManager`: holds a `client` attribute and `start()` async method; `client.call` is an `AsyncMock`.
- `SessionMap` uses a tmp DB via `tmp_path` to avoid touching `~/.maxma`.
- WebSocket tests use `fastapi.testclient.TestClient.websocket_connect`.

---

## Task 1: `api/pi_bridge/session_adapter.py` (31% → 90%+)

**Why:** Pure SQLite logic, no async, easiest to fully cover. Foundation for sessions/chat tests that import `SessionMap`.

**Files:**
- Create: `tests/test_pi_bridge/test_session_adapter.py`

**Tests:**
- `test_init_creates_db_and_dir` — tmp path, `SessionMap(db_path)`, verify file exists + parent created
- `test_migration_add_columns_idempotent` — open same db twice, no OperationalError
- `test_context_manager_closes_connection` — `with SessionMap() as sm: ...` then `sm._conn` closed
- `test_set_and_get_sidecar_id` / `test_get_sidecar_id_missing_returns_none`
- `test_get_maxma_id_reverse_lookup` / `_missing_returns_none`
- `test_set_mapping_updates_existing_keeps_created_at`
- `test_remove_existing_returns_true` / `_missing_returns_false`
- `test_set_const_true_false` / `test_get_const_missing_returns_false`
- `test_append_turn_creates_row_when_missing` — append on non-existent maxma_id
- `test_append_turn_truncates_user_to_500_and_assistant_to_1000`
- `test_append_turn_caps_at_max_turns_20` — append 25 turns, verify only last 20 stored
- `test_get_recent_turns_returns_last_n` / `_empty_returns_empty`
- `test_list_all_orders_by_updated_at_desc`
- `test_count_property`
- `test_close_closes_connection`

- [ ] **Step 1:** Write the test file with all tests above (use `tmp_path` fixture, real `SessionMap`).
- [ ] **Step 2:** Run `pytest tests/test_pi_bridge/test_session_adapter.py -v` → all PASS.
- [ ] **Step 3:** Run ruff on the new file → no E9/F63/F7/F821.
- [ ] **Step 4:** Commit `test: cover session_adapter SessionMap CRUD and turn persistence`.

---

## Task 2: `api/pi_bridge/rpc_client.py` (38% → 85%+)

**Why:** Pure async logic over stdio streams — easy to test with `asyncio.StreamReader/StreamWriter` pipe pairs or mocks. Foundation for sidecar_manager tests.

**Files:**
- Create: `tests/test_pi_bridge/test_rpc_client_extra.py`

**Tests (use real `asyncio.StreamReader`/`StreamWriter` via `os.pipe()` or `asyncio.Stream` pairs):**
- `test_json_rpc_error_init_stores_data` — `JsonRpcError("m", data={"x":1})` → `.data`
- `test_start_reading_idempotent` — calling twice does not start a second task
- `test_call_not_running_raises_runtime_error`
- `test_call_happy_path_returns_result` — write a response line `{"jsonrpc":"2.0","id":1,"result":{"ok":true}}` into stdout, `await client.call("foo")` returns `{"ok":true}`
- `test_call_with_params_sends_params`
- `test_call_error_response_raises_json_rpc_error` — response `{"id":1,"error":{"message":"boom","data":{"k":1}}}`
- `test_call_timeout_raises_timeout_error_and_cleans_pending` — use small `timeout=0.01`, no response
- `test_call_writes_json_line_to_stdin`
- `test_on_registers_handler_and_unsubscribe_removes` — sync handler
- `test_on_async_handler_awaited`
- `test_stop_cancels_pending_futures_with_runtime_error` — pending call gets RuntimeError
- `test_stop_cancels_read_task`
- `test_is_running_property`
- `test_read_loop_dispatches_event_notification` — push `{"method":"event","params":{"session_id":"s1","event":{"type":"token","payload":{"token":"x"}}}}`, verify handler called with `("s1", event)`
- `test_read_loop_dispatches_rpc_response`
- `test_read_loop_invalid_json_logs_warning` — push non-JSON line, no crash
- `test_read_loop_eof_clears_running` — close stdout pipe, `_running` becomes False
- `test_dispatch_event_handler_exception_logged` — handler raises, no crash
- `test_unsubscribe_missing_handler_logs_debug` (already covered, keep)

- [ ] **Step 1:** Write the test file using `asyncio.StreamReader` + a custom writer that captures bytes, OR `os.pipe()` wrapped into streams. Use `pytest.mark.asyncio`.
- [ ] **Step 2:** Run `pytest tests/test_pi_bridge/test_rpc_client_extra.py -v` → all PASS.
- [ ] **Step 3:** Run ruff → no errors.
- [ ] **Step 4:** Commit `test: cover rpc_client call/dispatch/event/stop paths`.

---

## Task 3: `api/pi_bridge/sidecar_manager.py` (41% → 75%+)

**Why:** Async lifecycle wrapping `asyncio.create_subprocess_exec` + `JsonRpcClient`. Mock the subprocess + client.

**Files:**
- Create: `tests/test_pi_bridge/test_sidecar_manager_extra.py`

**Tests:**
- `test_resolve_bun_path_meipass_bundle` — `monkeypatch sys._MEIPASS` + create `bun-sidecar/bun.exe`, returns bundled path
- `test_resolve_bun_path_settings_value` — `config.settings.get_settings` returns `sidecar_bun_path="X"`, returns "X"
- `test_resolve_bun_path_settings_empty_returns_default` — `sidecar_bun_path=""`, returns `_DEFAULT_BUN_PATH`
- `test_resolve_bun_path_settings_raises_returns_default` — `get_settings()` raises, returns default
- `test_is_running_false_when_no_process` / `_true_when_started`
- `test_stdin_stdout_client_none_when_not_started`
- `test_start_when_already_running_is_noop` — set `_process` with `returncode=None`, call `start()`, assert no new subprocess
- `test_start_creates_subprocess_and_client` — mock `asyncio.create_subprocess_exec` returns proc with stdin/stdout, mock `JsonRpcClient.start_reading`, verify `_process`/`_client` set + stderr task created
- `test_stop_not_running_is_noop` — `_process=None`, `stop()` returns without error
- `test_stop_graceful_terminate` — proc with `returncode=None`, `terminate()` + `wait()` returns 0, verify `_client.stop` called, `_process` cleared
- `test_stop_timeout_kills_process` — `wait()` raises `asyncio.TimeoutError`, verify `kill()` called + `wait()` after kill
- `test_stop_process_lookup_error_swallowed` — `terminate()` raises `ProcessLookupError`
- `test_stop_cancels_stderr_task` — set `_stderr_task` to a sleeping task, verify cancelled + cleared
- `test_restart_calls_stop_then_start` — mock both, verify order
- `test_forward_stderr_logs_lines` — set up a proc with a stderr `StreamReader` fed with lines, run `_forward_stderr`, verify `logger.debug` called
- `test_forward_stderr_swallows_exception` — stderr raises on readline, no crash

- [ ] **Step 1:** Write the test file. Use `unittest.mock.AsyncMock`/`MagicMock` + `monkeypatch` on `asyncio.create_subprocess_exec` and `api.pi_bridge.sidecar_manager.JsonRpcClient`.
- [ ] **Step 2:** Run `pytest tests/test_pi_bridge/test_sidecar_manager_extra.py -v` → all PASS.
- [ ] **Step 3:** Run ruff → no errors.
- [ ] **Step 4:** Commit `test: cover sidecar_manager lifecycle and bun path resolution`.

---

## Task 4: `api/routes/sessions.py` (31% → 65%+)

**Why:** Core REST routes. Extend the existing `_FakeSession`/`_FakeSessionManager` pattern with a `_FakeSidecarManager` and patch `SessionMap` to cover the sidecar-dependent paths.

**Files:**
- Create: `tests/test_api/test_sessions_routes_sidecar.py`

**Tests:**
- `test_set_permission_mode_value_error_returns_422` — monkeypatch `_permission_modes_enabled` True + `session.set_permission_mode` raises ValueError
- `test_get_messages_const_session_reads_yaml` — `session.is_const=True`, monkeypatch `load_const_session_by_id` returns dict with messages list, verify normalized output
- `test_get_messages_const_session_no_data_falls_back` — `is_const=True`, `load_const_session_by_id` returns None, sidecar_mgr=None, verify empty fallback
- `test_get_messages_sidecar_path_returns_normalized` — sidecar_mgr with client.call returning `{"messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"yo"}]}`, verify role mapping to human/ai + total
- `test_get_messages_sidecar_no_sidecar_id_falls_back` — SessionMap.get_sidecar_id None + session._sidecar_session_id None
- `test_get_messages_sidecar_exception_falls_back` — client.call raises, verify fallback to SessionMap recent turns
- `test_get_messages_fallback_from_session_map_turns`
- `test_undo_with_sidecar_success` — client.call("undo") returns `{"removed":2}`, verify `deleted_count=2` + message_count decremented + `_sync_const_session_after_undo` called (mock save_const_session)
- `test_undo_sidecar_exception_returns_503` — client.call raises
- `test_get_context_usage_with_sidecar_messages` — verify estimated_tokens = (sum content + system_prompt) / 2, percentage capped at 100
- `test_get_context_usage_no_sidecar_uses_empty`
- `test_delete_session_with_const_cleans_yaml` — `is_const=True`, monkeypatch `delete_const_session`
- `test_delete_session_with_sidecar_destroys_sidecar_session` — sidecar_mgr.client.call("destroy_session"), SessionMap.remove
- `test_delete_session_sidecar_exception_swallowed` — destroy_session raises, still deletes locally
- `test_constify_session_404` — session missing
- `test_constify_session_409_when_agent_running` — `_active_task` not done
- `test_constify_session_success_serializes_messages` — sidecar returns messages, monkeypatch `save_const_session`, verify session.is_const=True + response
- `test_constify_session_sidecar_exception_still_saves_empty` — client.call raises, serialized=[]
- `test_generate_title_404` / `_400_when_no_messages` / `_500_when_llm_raises`
- `test_generate_title_success` — mock llm.ainvoke returns object with `.content="  \"Hello\"  "`, verify title stripped + truncated to 50 chars
- `test_generate_title_empty_response_uses_default`
- `test_unconstify_session_idempotent` — session None still returns ok

- [ ] **Step 1:** Write the test file reusing the `_FakeSession`/`_FakeSessionManager` pattern + a new `_FakeSidecarManager` (with `client` AsyncMock). Patch `SessionMap` constructor to use a tmp DB or MagicMock.
- [ ] **Step 2:** Run `pytest tests/test_api/test_sessions_routes_sidecar.py -v` → all PASS.
- [ ] **Step 3:** Run ruff → no errors.
- [ ] **Step 4:** Commit `test: cover sessions sidecar/const/title/delete paths`.

---

## Task 5: `api/routes/chat.py` (42% → 65%+)

**Why:** WebSocket endpoint + helper functions. Cover the pure helpers directly + WS happy path via `TestClient.websocket_connect`.

**Files:**
- Create: `tests/test_api/test_chat_routes_extra.py`

**Tests (helper functions called directly):**
- `test_get_messages_from_sidecar_no_mgr_returns_empty`
- `test_get_messages_from_sidecar_no_client_returns_empty`
- `test_get_messages_from_sidecar_no_sidecar_id_returns_empty`
- `test_get_messages_from_sidecar_success` — mock client.call returns `{"messages":[...]}`
- `test_get_messages_from_sidecar_exception_returns_empty`
- `test_calculate_context_usage_basic` — messages with known content lengths + system_prompt, verify math
- `test_calculate_context_usage_caps_percentage_at_100` — huge content
- `test_calculate_context_usage_zero_messages`
- `test_new_turn_id_valid_string_kept` — `"abc123"` returned
- `test_new_turn_id_strips_whitespace` — `"  x  "` → `"x"`
- `test_new_turn_id_too_long_replaced` — `>128` chars → uuid4 hex
- `test_new_turn_id_non_string_replaced` — None / int → uuid4 hex
- `test_new_turn_id_empty_string_replaced`
- `test_save_const_session_skips_when_no_messages` — `_get_messages_from_sidecar` returns []
- `test_save_const_session_serializes_and_saves` — messages present, mock `save_const_session`, verify last assistant message replaced with final_answer
- `test_save_const_session_exception_logged` — `save_const_session` raises, no propagation

**Tests (websocket_chat via TestClient):**
- `test_ws_chat_ping_pong` — send `{"type":"ping"}`, expect `{"type":"pong"}`
- `test_ws_chat_invalid_json_skipped` — send `not-json`, expect no response (then send ping to verify still alive)
- `test_ws_chat_non_dict_skipped` — send `"[1,2]"` (valid JSON list), then ping
- `test_ws_chat_non_chat_type_skipped` — send `{"type":"other"}`, then ping
- `test_ws_chat_empty_message_skipped` — `{"type":"chat","payload":{"message":""}}`, then ping
- `test_ws_chat_non_dict_payload_skipped`
- `test_ws_chat_happy_path_returns_answer_and_done` — patch `_stream_turn_sidecar` AsyncMock returning "hello back", patch `build_system_prompt`, verify answer + done messages, verify `SessionMap.append_turn` called
- `test_ws_chat_const_session_triggers_save` — session.is_const=True + final_answer, patch `_save_const_session`

- [ ] **Step 1:** Write the test file. For WS tests, build a minimal FastAPI app with `chat.router`, a `_FakeSessionManager` returning `_FakeSession` with `get_or_create`, a `_FakeWSRegistry`, and patch `_stream_turn_sidecar` / `build_system_prompt` / `SessionMap`.
- [ ] **Step 2:** Run `pytest tests/test_api/test_chat_routes_extra.py -v` → all PASS.
- [ ] **Step 3:** Run ruff → no errors.
- [ ] **Step 4:** Commit `test: cover chat helpers and websocket chat happy path`.

---

## Task 6: `api/server.py` (36% → 70%+)

**Why:** App factory + lifespan. Cover `create_app` route registration + lifespan startup/shutdown + production static-file branches.

**Files:**
- Create: `tests/test_api/test_server_extra.py`

**Tests:**
- `test_create_app_returns_fastapi_with_title_and_version`
- `test_create_app_registers_all_routers` — assert at least one path from each major router is present in `app.routes` (e.g. `/api/sessions`, `/api/persona`, `/api/skills`, `/api/health`, `/api/auth/token`, `/ws/chat/{session_id}`)
- `test_health_endpoint_returns_ok` — `TestClient(app).get("/api/health")` → 200 `{"status":"ok"}`
- `test_auth_token_endpoint_returns_token` — with lifespan started, `GET /api/auth/token` → 200 `{"token": ...}`
- `test_lifespan_starts_session_manager_and_sidecar_manager` — use `async with LifespanManager(app)` (or `TestClient` context manager), verify `app.state.session_manager` / `ws_registry` / `sidecar_manager` set, then on exit `sidecar_manager.stop` called
- `test_lifespan_skips_stop_when_no_sidecar_manager` — set `app.state.sidecar_manager=None` before shutdown
- `test_production_mode_mounts_static_when_dist_exists` — `MAXMA_ENV=production` + monkeypatch `WEB_DIST_DIR` to a tmp dir with `index.html` + `assets/` + `fonts/` + `images/`, verify `/` returns index.html (via `TestClient` with lifespan), and `/assets/...` mounted
- `test_production_mode_warns_when_dist_missing` — `MAXMA_ENV=production` + monkeypatch `WEB_DIST_DIR` to non-existent, verify app still created + warning logged (caplog)
- `test_spa_fallback_returns_index_when_exists`
- `test_spa_fallback_returns_404_when_no_index`
- `test_root_fallback_returns_index_when_exists`
- `test_dev_mode_no_static_mount` — no `MAXMA_ENV=production`, verify `/` is 404 (no static handler)

- [ ] **Step 1:** Write the test file. Use `from api.server import create_app, lifespan`; for lifespan use `httpx.ASGITransport` + `AsyncClient` OR `TestClient(app)` context manager which triggers lifespan. Monkeypatch `app_paths.WEB_DIST_DIR` for production tests. Monkeypatch `SidecarManager` to a fake to avoid real subprocess.
- [ ] **Step 2:** Run `pytest tests/test_api/test_server_extra.py -v` → all PASS.
- [ ] **Step 3:** Run ruff → no errors.
- [ ] **Step 4:** Commit `test: cover server create_app, lifespan, and production static mounts`.

---

## Task 7: Remeasure and verify

- [ ] **Step 1:** Run full coverage:
  ```
  .venv\Scripts\python.exe -m pytest tests/ --cov=api --cov=agent --cov-report=term-missing -q
  ```
- [ ] **Step 2:** Confirm each of the 6 core modules ≥ 60% and TOTAL ≥ 65%.
- [ ] **Step 3:** Run ruff on all new test files:
  ```
  .venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests
  ```
- [ ] **Step 4:** If any test is flaky or a real bug was found, document in the final report (do not fix production code).

---

## Expected outcome

| Module | Before | After (target) |
|---|---|---|
| sessions.py | 31% | 65%+ |
| chat.py | 42% | 65%+ |
| sidecar_manager.py | 41% | 75%+ |
| rpc_client.py | 38% | 85%+ |
| session_adapter.py | 31% | 90%+ |
| server.py | 36% | 70%+ |
| **TOTAL** | **60%** | **65%+** |
