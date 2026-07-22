# Arbiter Verification — Round 1 Red

## Verification approach
- Re-read `rounds/round-1/red/review.md` and `handoff.md`
- Inspected `git diff api/routes/maxma_blocker.py api/server.py` to confirm edits are surgical and applied as described
- Confirmed `api/pi_bridge/security_adapter.py:151` uses literal `".maxma_blocker"` — this is the enforcement boundary; Red's claim of mismatch is TRUE
- Ran targeted tests: `tests/test_api/test_stub_routes_extra.py` + `tests/test_pi_bridge/test_security_adapter.py`
  - Result: **50 passed, 1 skipped** (no regressions)

## Per-issue audit

### R-001 — MaxmaBlocker filename mismatch (HIGH)
- **Claim**: API created `MaxmaBlocker`, security_adapter enforced `.maxma_blocker` → silent bypass
- **Evidence**: `git diff` shows `BLOCKER_FILENAME = "MaxmaBlocker"` → `".maxma_blocker"` in `api/routes/maxma_blocker.py:19`. `security_adapter.py:151` confirms literal `.maxma_blocker`. Mismatch was real.
- **Fix quality**: ✅ Surgical. Adds `_LEGACY_BLOCKER_FILENAMES = ("MaxmaBlocker",)` for backward-compat cleanup; `_remove_marker` now handles both names. Test assertions updated. Two new regression tests added (`test_api_created_marker_is_detected_by_security_adapter`, `test_remove_marker_cleans_legacy_maxmablocker`).
- **Risk**: The fix relies on `BLOCKER_FILENAME` in `maxma_blocker.py` matching the literal string in `security_adapter.py:151`. No shared constant. Possible future regression — but acceptable for this round.
- **Verdict**: ✅ **VERIFIED**. Award **+3** (high) to Red.

### R-002 — httpx.AsyncClient leak on shutdown (MEDIUM)
- **Claim**: `api/routes/balance.py` has module-level `_shared_async_client` singleton; `close_async_client()` exists but never called from `server.py` lifespan shutdown.
- **Evidence**: `git diff api/server.py` shows added block: `from api.routes.balance import close_async_client; await close_async_client()` wrapped in try/except, after `sidecar_manager.stop()`.
- **Fix quality**: ✅ Best-effort cleanup with `logger.exception` on failure. Local import avoids eager httpx load. Non-blocking.
- **Risk**: Broad `except Exception` — could swallow real issues. Acceptable for cleanup path.
- **Verdict**: ✅ **VERIFIED**. Award **+2** (medium) to Red.

## Scoring
- Red Round 1 issues: 1 HIGH + 1 MEDIUM = 1×3 + 1×2 = **+5 points**
- **Red running total**: 5
- Blue running total: 0

## Issues appended to summary
- R-001 (HIGH) — MaxmaBlocker filename mismatch — fixed & verified
- R-002 (MEDIUM) — httpx.AsyncClient leak on shutdown — fixed & verified

## Notes for Blue Team
- Red's review was thorough on breadth (50+ files scanned) but only 2 issues filed. Blue should hunt broadly — many areas had only high-level review.
- Specifically flagged by Red as incomplete: `build/` scripts, `desktop/src-tauri/src/main.rs`, deeper `bun-sidecar/src/` TypeScript.
- Red's v-html audit declared all 6 usages "safe today" — Blue may challenge this if it finds an actual sink.
- Red's R-001 fix has a known weakness: no shared constant between `maxma_blocker.py` and `security_adapter.py`. Blue could challenge whether legacy markers `MaxmaBlocker.foo` (any extension) get unlinked — confirmed they do, by design.
