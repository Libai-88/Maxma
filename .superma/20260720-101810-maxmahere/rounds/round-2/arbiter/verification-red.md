# Arbiter Verification — Round 2 Red

## Verification approach
- Re-read `rounds/round-2/red/review.md` and `handoff.md`
- For each B-NNN fix, spot-checked the cited file edits via `git diff` and `Grep`
- Ran full pytest suite: **1834 passed, 7 skipped in 22.22s** (no regressions)
- Confirmed `api/data/providers.yaml` now contains `encv1:...` encrypted keys (B-009 startup migration ran successfully)

## Per-issue audit

### B-001 + B-002 (coupled HIGH) — ✅ VERIFIED
- **B-001 Evidence**: `api/pi_bridge/sidecar_manager.py:128-132` adds `sidecar_env["MAXMA_PROJECT_ROOT"] = str(PROJECT_ROOT)` with graceful fallback. All 5 bun-sidecar config tools now use a `projectRoot()` helper that reads `process.env.MAXMA_PROJECT_ROOT ?? process.cwd()`.
- **B-002 Evidence**: `api/routes/chat.py:177` now sends `"cwd": str(PROJECT_ROOT)` (was `"."`). Import added at line 21.
- **Coordination**: Both sides now agree on project root. Agent will run with cwd = user's project root, not `bun-sidecar/`.
- **Verdict**: ✅ Award **+3** (high) for B-001 + **+3** (high) for B-002 = **+6**.

### B-003 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/session-bridge.ts:601` adds `if (method === "compact")` handler. Truncates `state.messages` to last `keepLast` entries (default 20), preserves leading system message, calls `agent.replaceMessages(remaining)` only when something was removed. Returns `{"compressed": bool, "removed_count": int, "detail": "..."}` matching `session_compress.py` contract.
- **Verdict**: ✅ Award **+2** (medium).

### B-004 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/tools/config/manage_macros.ts:21` adds `MACRO_NAME_RE = /^[A-Za-z0-9_\-]+$/`. `validateName()` and `assertWithinMacrosDir()` helpers added. All `get`/`create`/`update`/`delete` actions call both validators before any path operation. Mirrors `api/routes/macros.py:25-31` pattern.
- **Verdict**: ✅ Award **+2** (medium).

### B-005 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `api/routes/balance.py:28-50` adds `_client_lock` + `_client_lock_loop` (handles test environments with fresh event loops). `_get_async_client()` converted to `async def` and wrapped in `async with lock`. `close_async_client()` also wrapped in same lock. Test callsites updated.
- **Verdict**: ✅ Award **+2** (medium).

### B-006 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `api/routes/memory.py` rewritten. Both GET and DELETE return `JSONResponse(status_code=501, content={"detail": _NOT_IMPLEMENTED_DETAIL})`. Frontend `web/src/stores/memory.ts` already handles non-OK gracefully.
- **Verdict**: ✅ Award **+2** (medium). Simpler 501 path chosen per spec — acceptable.

### B-007 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/session-bridge.ts:555-597` undo handler rewritten. No longer uses `steps * 2` arithmetic. Walks backwards counting `user` messages as turn boundaries, cuts at the Nth-to-last user message index. Returns `turns_removed` field for UI feedback.
- **Verdict**: ✅ Award **+2** (medium).

### B-008 (MEDIUM) — ✅ VERIFIED
- **Evidence**: `api/routes/mcp_test.py:32-67` adds `_ALLOWED_COMMANDS` frozenset (npx, node, npm, uvx, uv, python, python3, py, bun, deno, docker). `_resolve_command(raw)` extracts basename, validates against `_COMMAND_NAME_RE = /^[A-Za-z0-9_.\-]+$/`, checks whitelist. `_validate_args(args)` rejects control characters and shell metacharacters. Endpoint at line 126 calls both validators.
- **Verdict**: ✅ Award **+2** (medium).

### B-009 (LOW) — ✅ VERIFIED
- **Evidence**: `api/server.py:70-79` lifespan startup calls `migrate_plaintext_keys_to_encrypted()` from `api/routes/providers.py`. Function extracted from existing `POST /providers/encrypt-keys` endpoint (no behavior change). Wrapped in `try/except Exception` (non-fatal). `api/data/providers.yaml` confirmed to now contain `encv1:eyJ...` encrypted values (was plaintext `sk-...` before).
- **Verdict**: ✅ Award **+1** (low).

### B-010 (LOW) — ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/tools/config/manage_mcp.ts` `parseYaml` rewritten with proper indent-aware stack of `{indent, node}` pairs. Dedent loop now `while (stack.length > 1 && stack[stack.length - 1].indent >= indent) { stack.pop(); }` — uses `>=` (not `<=`) and derives `currentIndent` implicitly from new top of stack. Added `coerceScalar` helper. Preserved zero-dep constraint.
- **Verdict**: ✅ Award **+1** (low).

## Scoring
- Red Round 2 fixes: 2 HIGH + 6 MEDIUM + 2 LOW = 2×3 + 6×2 + 2×1 = **+20 points**
- **Red running total**: 5 + 20 = **25**
- **Blue running total**: 20 (unchanged — Blue hasn't played Round 2 yet)

## Round 2 status (after Red only)
- Red fixed 10 of 10 open Blue issues
- Red filed 0 new R-NNN issues
- New medium/high issues this round (so far): 0 from Red
- `consecutive_empty_rounds`: TBD — depends on Blue Round 2

## Notes for Blue Team (Round 2)
- All 10 Blue findings from Round 1 have been fixed. Verify the fixes hold up.
- Areas where Blue might challenge:
  1. **B-005 lock-loop tracker**: Red added `_client_lock_loop` to handle test environments with fresh event loops. Is this sound in production? Could it leak locks if the running loop changes mid-request?
  2. **B-007 undo logic**: The new backwards-walk cuts at the Nth-to-last `user` message. What if `state.messages` starts with a `system` message followed by `assistant` (no preceding `user`)? Edge case worth probing.
  3. **B-008 whitelist**: Conservative. Are there legitimate MCP server runtimes missing? Is the metacharacter filter complete (e.g., does it catch `\x1b` escape sequences, Unicode control chars)?
  4. **B-009 startup migration**: Non-fatal `try/except Exception` swallows errors. Is that the right policy? What if migration partially completes?
  5. **B-001 + B-002 coordination**: Both must agree on project root. What if `app_paths.PROJECT_ROOT` is None or stale? The fallback `process.cwd()` in bun-sidecar would silently revert to the bug.
  6. **B-006 501 path**: Frontend `memory.ts` swallows delete errors — does it actually surface the 501 to the user, or fail silently?
  7. **B-010 parseYaml rewrite**: Does the new implementation handle all the cases the old one did (e.g., inline arrays `[]`, quoted strings, multi-line scalars)?
