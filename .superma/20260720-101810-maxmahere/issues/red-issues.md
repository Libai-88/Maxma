# Red Team Issues — Round 1

Append-only log of issues found and fixed by the Red Team.

---

## R-001 — MaxmaBlocker filename mismatch causes silent security bypass

- **Priority**: HIGH
- **Status**: Fixed
- **Files**:
  - `api/routes/maxma_blocker.py:19` (root cause — `BLOCKER_FILENAME = "MaxmaBlocker"`)
  - `api/pi_bridge/security_adapter.py:151` (enforcement side — looks for `.maxma_blocker`)
  - `tests/test_api/test_stub_routes_extra.py` (tests asserted the buggy `MaxmaBlocker` name)
- **Symptom**: REST API `POST /api/maxma-blocker` creates a marker file named `MaxmaBlocker`, but `security_adapter._find_blocker_path()` only detects `.maxma_blocker`. Result: every blocker created through the UI/API is silently ignored by the security layer — tools can still read/write inside "protected" directories. The feature is a no-op.
- **Root cause**: Two modules independently defined the marker filename without a shared source of truth. Test suites were also split between the two conventions, masking the bug.
- **Fix**:
  - `api/routes/maxma_blocker.py`: `BLOCKER_FILENAME = ".maxma_blocker"` (canonical, matches security_adapter); added `_LEGACY_BLOCKER_FILENAMES = ("MaxmaBlocker",)` and updated `_remove_marker` to clean up both new and legacy files for backward compatibility.
  - `tests/test_api/test_stub_routes_extra.py`: updated all `MaxmaBlocker` assertions to `.maxma_blocker`; added `test_remove_marker_cleans_legacy_maxmablocker` (backward compat) and `test_api_created_marker_is_detected_by_security_adapter` (cross-module regression test).
- **Score claim**: +3 (HIGH).

---

## R-002 — Shared httpx.AsyncClient in balance.py never closed on shutdown

- **Priority**: MEDIUM
- **Status**: Fixed
- **Files**:
  - `api/server.py` (lifespan shutdown — only stopped `sidecar_manager`, did not close balance client)
  - `api/routes/balance.py:13-35` (module-level `_shared_async_client` singleton + `close_async_client()` never invoked)
- **Symptom**: `balance.py` maintains a module-level `httpx.AsyncClient` with a 20-connection pool. `close_async_client()` exists but is dead code — never called from `server.py` lifespan shutdown. On every FastAPI shutdown (including desktop restarts via `POST /api/restart`), the connection pool leaks: sockets/FDs not closed cleanly, uvicorn may emit "Event loop is closed" warnings on next start. Over many dev restart cycles this can exhaust file descriptors.
- **Root cause**: Lifecycle wiring was never added when the shared client was introduced. The `close_async_client()` function was authored but never called.
- **Fix**:
  - `api/server.py`: added a `try/except` block in lifespan shutdown (after `sidecar_manager.stop()`) that imports and awaits `close_async_client()` from `api/routes/balance.py`. Local import avoids forcing httpx load at module import time. Failures are logged but do not block shutdown (best-effort cleanup).
- **Score claim**: +2 (MEDIUM).

---

**Round 1 total**: 2 issues fixed (1 HIGH + 1 MEDIUM) = **5 points**.
