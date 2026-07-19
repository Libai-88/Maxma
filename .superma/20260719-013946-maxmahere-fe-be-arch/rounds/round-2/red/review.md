# Round 2 — Red review

## Mode: Fix challenges from Blue

Blue filed 3 successful challenges (BC-001, BC-002, BC-003) against Red's Round 1 fixes. All three have been addressed in this round.

---

## Methodology

1. Read Blue's review and repro scripts for detailed context on each challenge.
2. Traced the `connectSession()` call sites to verify all async paths have error handling.
3. Traced the heartbeat ping/pong round-trip to verify pong timeout monitoring is complete.
4. Grep-searched for `maxma:error` to confirm no existing listener existed, then added one.
5. Also searched for NEW issues in the frontend-backend communication layer.
6. Verified all fixes compile with `npm run build`.

---

## Challenges Addressed

### BC-001 — Missed .catch() at useChat.ts:271 (challenges R-002)

**Patch**: `patches/BC-001.patch`

**Fix**: The `setTimeout` callback at line 271 (in the "token not available" branch) now wraps `connectSession(sid)` with a `.catch()` handler that logs the error and sets `ch.error` on the channel. This is consistent with the 3 other `.catch()` sites already added in R-002.

**Verification**: All 4 call sites of `connectSession()` now have error handling:
- Line 248: `connectSession(sid).catch(...)` — backend-not-ready retry
- Line 271: `connectSession(sid).catch(...)` — token-not-available retry (FIXED)
- Line 365: `connectSession(sid).catch(...)` — onclose reconnection timer
- Line 416: `connectSession(sid).catch(...)` — ensureConnected()

---

### BC-002 — No pong timeout monitoring (challenges R-005)

**Patch**: `patches/BC-002.patch`

**Fix**: Added full pong timeout monitoring:
1. `_lastPongAt` field added to `SessionChannel` interface (both `useChat.ts` and `chat.ts`)
2. Initialized to `Date.now()` on `ws.onopen`
3. Updated in the `case 'pong'` handler
4. In the ping interval, checks if `Date.now() - _lastPongAt > 35000` (30s interval + 5s grace). If overdue, proactively closes the WebSocket to trigger reconnection.

The heartbeat now correctly implements:
- Sends `{ type: 'ping' }` every 30s
- Tracks `_lastPongAt` timestamp from pong responses
- Proactively closes WS when pong is overdue (35s threshold)
- Falls back to existing reconnection logic on close

---

### BC-003 — No listener for maxma:error event (challenges R-007)

**Patch**: `patches/BC-003.patch`

**Fix**: Added a listener in App.vue that subscribes to `window`'s `'maxma:error'` CustomEvent and displays a DsToast (type=error, 6s dismissible) with the error message. This provides user-visible feedback when unhandled Vue errors occur, completing the fix that R-007 started.

**Design decision**: The `errorHandler` in `main.ts` still uses the fire-and-forget CustomEvent pattern (no direct DOM manipulation in the error handler). The consumer in App.vue uses `reactive()` state to drive the DsToast component. This avoids the risk of secondary errors in the error handler while ensuring errors are surfaced to the user.

**Verification**: `grep -rn "maxma:error" web/src/` now shows:
- `web/src/main.ts:16` — dispatch (R-007)
- `web/src/App.vue:176` — listener (BC-003, NEW)

---

## New Issues Identified

### N-001 — `request()` in `api/index.ts` has no timeout

**File**: `web/src/api/index.ts:144-170`
**Symbol**: `request`

**Severity**: Medium

**Description**: The `request()` function used for all HTTP API calls (`createSession`, `listSessions`, `getMessages`, `health`, etc.) uses `tauriFetch()` / native `fetch()` without an `AbortController` or timeout. If the backend hangs (e.g., due to a deadlock, infinite loop, or unresponsive sidecar), the promise never resolves or rejects. The UI remains in a loading state indefinitely with no way for the user to recover except by refreshing the page.

**Evidence**:
- `web/src/api/index.ts:144-170` — `request()` calls `tauriFetch()` but never passes a signal or timeout.
- `web/src/utils/env.ts:147-156` — `tauriFetch()` does not add timeouts either; it simply wraps `fetch()` or `@tauri-apps/plugin-http` fetch.

**Impact**:
- Backend-sidecar deadlock → all API calls hang forever
- Network partition where TCP connection is half-open → fetch hangs until OS timeout (potentially 30+ minutes)
- No way for the user to cancel or retry a hung request

**Suggested fix**: Add a configurable timeout via `AbortController` with a reasonable default (e.g., 30s for most requests, 120s for long-running operations like `getMessages`). The timeout should reject the promise with a clear error message.

---

### N-002 — `ensureConnected()` marks channel initialized before WebSocket is established

**File**: `web/src/composables/useChat.ts:414`
**Symbol**: `ensureConnected`

**Severity**: Low-Medium

**Description**: `ensureConnected()` sets `ch.initialized = true` at line 414 *before* calling `connectSession()`. If `connectSession()` fails (e.g., token fetch exhausts retries), `ch.initialized` remains `true` but `ch.ws` is `null`. The channel is stuck in a broken state — subsequent `ensureConnected()` calls are no-ops (line 409: `if (ch.initialized) return`), and no `onclose` handler can fire because no WebSocket was ever opened. Recovery requires a page refresh or navigating away (component unmount cleans up the channel).

**Impact**: Upon initialization failure, the channel is permanently broken from `ensureConnected()`'s perspective. While the reconnection path through `onclose` would work if a WS had been established, in this case no WS ever existed.

**Suggested fix**: Either:
1. Move `ch.initialized = true` to after `connectSession()` successfully establishes a WS (in `ws.onopen`), and reset `ch.initialized = false` if the initial connection attempt fails.
2. Or reset `ch.initialized = false` in the `.catch()` handler of `ensureConnected()`.

---

## Summary

| Item | Type | Severity | Status |
|------|------|----------|--------|
| BC-001 | Challenge fix (R-002) | Medium | Addressed |
| BC-002 | Challenge fix (R-005) | Medium | Addressed |
| BC-003 | Challenge fix (R-007) | Low | Addressed |
| N-001 | New finding | Medium | `api/index.ts:request()` no timeout |
| N-002 | New finding | Low-Med | `ensureConnected()` premature `initialized=true` |

## Files Changed
- `web/src/composables/useChat.ts` — BC-001 + BC-002 fixes
- `web/src/stores/chat.ts` — BC-002 (interface + factory)
- `web/src/App.vue` — BC-003 (toast listener)
