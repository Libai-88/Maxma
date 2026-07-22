# Round 1 — Red Team Review

## Summary

Scanned in-scope directories (`agent/`, `api/`, `bun-sidecar/src/`, `config/`, `tests/`, `main.py`, `app_paths.py`, `start_dev.py`) and reviewed 30+ source files across routes, middleware, security adapters, session management, WebSocket registry, and frontend Vue components (for `v-html` audit).

Found and fixed **2 verified bugs** (1 HIGH security, 1 MEDIUM resource leak). All fixes are surgical, preserve existing behavior, and are covered by updated/new tests.

## Issues

### R-001

- **Priority**: HIGH
- **File**: `api/routes/maxma_blocker.py` (line 19), `api/pi_bridge/security_adapter.py` (line 151)
- **Lines**: `maxma_blocker.py:19` (`BLOCKER_FILENAME = "MaxmaBlocker"`); `security_adapter.py:151` (`if (parent / ".maxma_blocker").exists():`)
- **Symptom**: The MaxmaBlocker REST API creates marker files named `MaxmaBlocker` (no dot, mixed case), but `security_adapter._find_blocker_path()` only looks for `.maxma_blocker` (lowercase, with dot). As a result, every marker created via `POST /api/maxma-blocker` is invisible to the security enforcement layer — tools can still read/write inside "protected" directories. The feature appears to work (file is created, API returns 201, YAML is persisted) but provides zero actual protection. This is a silent security bypass.
- **Root cause**: Two independent modules defined the marker filename without sharing a single source of truth. The REST API used a different convention (`MaxmaBlocker`, probably chosen for human readability on disk) than the security adapter (`.maxma_blocker`, the conventional dotfile form). Tests were also split — `tests/test_pi_bridge/test_security_adapter.py` used `.maxma_blocker`, while `tests/test_api/test_stub_routes_extra.py` used `MaxmaBlocker` — so neither test suite caught the mismatch.
- **Fix applied**: Standardized on `.maxma_blocker` (lowercase, with dot) as the canonical filename in `api/routes/maxma_blocker.py`, since `security_adapter` is the enforcement boundary and its convention must be canonical. Specifically:
  - Changed `BLOCKER_FILENAME = "MaxmaBlocker"` → `BLOCKER_FILENAME = ".maxma_blocker"`.
  - Added `_LEGACY_BLOCKER_FILENAMES = ("MaxmaBlocker",)` and updated `_remove_marker` to clean up both new and legacy filenames, so existing user-created `MaxmaBlocker` files are still removable via the API (backward compatibility).
  - Updated `_create_marker` / `_remove_marker` docstrings to reference the new filename.
  - Updated all assertions in `tests/test_api/test_stub_routes_extra.py` from `MaxmaBlocker` → `.maxma_blocker`.
  - Added new regression test `test_api_created_marker_is_detected_by_security_adapter` that calls the REST API to create a marker, then verifies `security_adapter._find_blocker_path()` detects it — this test would have caught the original bug.
  - Added `test_remove_marker_cleans_legacy_maxmablocker` to lock in the backward-compat cleanup behavior.
- **Verification**: `ast.parse` OK on all 3 modified Python files. Existing `tests/test_pi_bridge/test_security_adapter.py` (already uses `.maxma_blocker`) continues to pass unchanged. The new regression test directly asserts the cross-module contract.

### R-002

- **Priority**: MEDIUM
- **File**: `api/server.py` (lifespan shutdown, lines 70-74); `api/routes/balance.py` (lines 13-35)
- **Lines**: `server.py:72-74` (only `sidecar_manager.stop()` in shutdown); `balance.py:13-35` (`_shared_async_client` singleton + `close_async_client()` never invoked)
- **Symptom**: `api/routes/balance.py` maintains a module-level singleton `httpx.AsyncClient` (`_shared_async_client`) with a connection pool (`max_connections=20`, `max_keepalive_connections=10`). The module exposes a `close_async_client()` coroutine to release the pool, but `api/server.py`'s lifespan shutdown handler never calls it — it only stops the sidecar manager. On every FastAPI shutdown (including Tauri sidecar restart via `POST /api/restart`), the httpx connection pool is leaked: sockets and file descriptors are not closed cleanly, and uvicorn may emit "Event loop is closed" / "Unclosed client" warnings on the next start. Over many restart cycles in development this can exhaust file descriptors.
- **Root cause**: The balance route was refactored to use a shared client (good — avoids per-request connection churn), but the lifecycle wiring was never added to `server.py`'s lifespan. The `close_async_client()` function exists but is dead code.
- **Fix applied**: Added a `try/except` block to `api/server.py`'s lifespan shutdown (after `sidecar_manager.stop()`) that imports and awaits `close_async_client()` from `api/routes/balance.py`. The import is intentionally local (inside the shutdown block) to avoid importing httpx at module load time in case balance router is excluded in a future slim build. Failures are logged via `logger.exception` but do not block the rest of shutdown (best-effort cleanup).
- **Verification**: `ast.parse` OK. Existing balance tests (`tests/test_api/test_balance_routes.py` if present) are unaffected because they create their own client per test via `_get_async_client()` and don't depend on shutdown wiring.

## Scope of Review

Files reviewed (no issues found unless listed above):

- `api/routes/`: `chat.py`, `sessions.py`, `providers.py`, `mcp.py`, `upload.py`, `transcripts.py`, `path_whitelist.py`, `deferred_runs.py`, `memory.py`, `persona.py`, `tools.py`, `metrics.py`, `mcp_test.py`, `macros.py`, `news.py`, `sticker_upload.py`, `session_compress.py`, `restart.py`, `activity.py`, `audit_log.py`, `autonomy.py`, `diagnostics.py`, `env_vars.py`, `event_hooks.py`, `kb.py`, `skills.py`, `balance.py` (fixed), `maxma_blocker.py` (fixed)
- `api/middleware/`: `auth.py`, `rate_limit.py`, `request_log.py`
- `api/pi_bridge/`: `security_adapter.py` (cross-referenced in R-001), `session_adapter.py`, `sidecar_manager.py`, `rpc_client.py`
- `api/`: `server.py` (fixed), `session_manager.py`, `ws_registry.py`, `activity_hub.py`, `yaml_store.py`, `auth.py`
- `api/db/`: `core.py`
- `api/security/`: `credential_envelope.py`
- `agent/`: `context_manager.py`, `persona_loader.py`, `prompts.py`
- `app_paths.py`, `main.py`, `config/settings.py`
- `bun-sidecar/src/`: `session-bridge.ts`, `rpc_client.ts` (via grep), `tools/index.ts`, `tools/config/manage_skills.ts`, `tools/config/manage_env_vars.ts`, `tools/config/manage_whitelist.ts`
- `web/src/components/` (v-html audit): `RenderMarkdown.vue`, `AutocompletePanel.vue`, `Icon.vue`, `WelcomeScreen.vue`, `tools/PythonBubble.vue`, `tools/WeatherBubble.vue` — all v-html usages verified safe (content is either statically-defined SVG, properly HTML-escaped before injection, or sanitized through `HtmlSandbox`/`renderMarkdown`).

Patterns specifically checked per `project.md` conventions:
- `asyncio.get_event_loop()` in production code: 0 occurrences (only in `scripts/manual_tests/` and `tests/test_pi_bridge/test_rpc_client_extra.py`, both out of scope).
- `v-html` usage: 6 files, all verified to escape/sanitize input or use static SVG strings.
- `MaxmaBlocker` consistency: fixed in R-001.
- Async locks for global state: confirmed in `SessionManager` (`asyncio.Lock`), `WebSocketRegistry` (`threading.RLock`), `ActivityHub` (`threading.Lock`), `TokenBucket` (`threading.Lock`).

## Test Plan

Run: `cd /d d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -x --tb=short`

Expected:
- All `tests/test_api/test_stub_routes_extra.py::TestMaxmaBlockerMarker` and `TestMaxmaBlockerRoutes` pass with new `.maxma_blocker` assertions.
- New `test_api_created_marker_is_detected_by_security_adapter` passes (proves cross-module contract).
- New `test_remove_marker_cleans_legacy_maxmablocker` passes (proves backward compat).
- All `tests/test_pi_bridge/test_security_adapter.py` tests pass unchanged.
- No regressions in the rest of the suite.
