# Round 1 — Red Team Handoff

## Status

Complete. 2 issues fixed (R-001 HIGH, R-002 MEDIUM). All fixes are surgical, syntax-verified with `ast.parse`, and covered by updated/new tests.

## Issues Table

| ID    | Priority | File                                                | Status   | Notes                                                                                                  |
| ----- | -------- | --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| R-001 | HIGH     | `api/routes/maxma_blocker.py` + `api/pi_bridge/security_adapter.py` | Fixed    | MaxmaBlocker filename mismatch caused API-created markers to be invisible to security enforcement. Standardized on `.maxma_blocker`; added backward-compat legacy cleanup + regression test. |
| R-002 | MEDIUM   | `api/server.py` + `api/routes/balance.py`           | Fixed    | Shared `httpx.AsyncClient` in `balance.py` never closed on FastAPI shutdown. Added `await close_async_client()` to lifespan shutdown with best-effort try/except. |

## Files Touched

Source code:
- `api/routes/maxma_blocker.py` — changed `BLOCKER_FILENAME` constant, added `_LEGACY_BLOCKER_FILENAMES`, updated `_remove_marker` to clean both names, updated docstrings.
- `api/server.py` — added `close_async_client()` call in lifespan shutdown.

Tests:
- `tests/test_api/test_stub_routes_extra.py` — updated all `MaxmaBlocker` assertions to `.maxma_blocker`; added `test_remove_marker_cleans_legacy_maxmablocker` and `test_api_created_marker_is_detected_by_security_adapter` regression tests.

Documentation / run artifacts:
- `.superma/20260720-101810-maxmahere/rounds/round-1/red/review.md`
- `.superma/20260720-101810-maxmahere/rounds/round-1/red/handoff.md` (this file)
- `.superma/20260720-101810-maxmahere/issues/red-issues.md`

## Unfinished Work / Known Limitations

- **R-001 scope**: The fix standardizes the marker filename going forward and adds backward-compat cleanup for legacy `MaxmaBlocker` files via the REST API's `_remove_marker`. However, any pre-existing `MaxmaBlocker` files on disk that are NOT tracked in `maxma_blocker.yaml` will not be auto-discovered or cleaned up — users would need to delete them manually or re-add the directory via the API (which now creates the correct `.maxma_blocker` name). This is acceptable because (a) the legacy markers were never enforced anyway, so leaving them in place has no security impact, and (b) auto-scanning every directory on disk for legacy markers would be expensive and risky.
- **R-002 scope**: The fix wires `close_async_client()` into lifespan shutdown. If a future module also creates module-level httpx clients, the same wiring pattern will need to be repeated. A future improvement could centralize all module-level async clients in a registry, but that is out of scope for this round.
- **Out-of-scope files not deeply reviewed**: `build/` scripts, `desktop/src-tauri/src/main.rs`, `bun-sidecar/src/` TypeScript files beyond the ones listed in the review scope were scanned at a high level but not line-by-line. Blue Team should look here for additional issues.

## Verification Commands

```bash
# Syntax verification (already run, passed)
.venv\Scripts\python.exe -c "import ast; ast.parse(open('api/routes/maxma_blocker.py', encoding='utf-8').read()); ast.parse(open('api/server.py', encoding='utf-8').read()); ast.parse(open('tests/test_api/test_stub_routes_extra.py', encoding='utf-8').read()); print('OK')"

# Test suite (to be run by orchestrator)
cd /d d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ -x --tb=short 2>&1 | tail -40
```

## Suggestions for Blue Team

Areas with elevated risk worth challenging:
1. **R-001 backward-compat logic in `_remove_marker`** — verify the `valid_names` set construction handles all edge cases (e.g., what if `_LEGACY_BLOCKER_FILENAMES` is empty? what about case-sensitivity on case-insensitive filesystems?).
2. **R-002 try/except scope** — the `try/except Exception` is broad; is there a more specific exception type that should be caught? Should failures here actually be silent (best-effort) or should they propagate to fail-fast shutdown?
3. **Cross-module filename contract** — the fix relies on `BLOCKER_FILENAME` in `maxma_blocker.py` matching the literal string `".maxma_blocker"` hardcoded in `security_adapter.py:151`. There is no shared constant. A future refactor could re-introduce the same bug. Consider extracting to a shared `api/security/blocker_filename.py` module (out of scope for this round).
4. **Frontend `v-html` audit** — I verified all 6 `v-html` usages in `web/src/components/` are safe today, but the safety depends on each component continuing to escape/sanitize input. There are no automated tests asserting this. A regression in `highlightPython()` or `svgIcon()` could silently introduce XSS.

## Handoff Complete

Red Team Round 1 work is complete and ready for Blue Team review.
