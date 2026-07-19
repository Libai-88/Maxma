# Round 1 — Blue review

## Mode selected: B — Challenge Red

After thorough analysis of the codebase and Red's patches, I am filing challenges against 3 of Red's 7 verified fixes. Each challenge demonstrates that the fix is incomplete — the underlying issue persists under specific conditions.

---

## Methodology

1. Read summary.md, project.md, Red handoff, and arbiter verification
2. Read all 7 Red patches (R-001 through R-007)
3. Read and analyzed the following source files:
   - `web/src/composables/useChat.ts` — WebSocket lifecycle, reconnection, message send
   - `web/src/stores/activity.ts` — SSE activity stream
   - `web/src/stores/session.ts` — Session init
   - `web/src/stores/chat.ts` — SessionChannel store
   - `web/src/api/index.ts` — API client, token lifecycle
   - `web/src/utils/env.ts` — waitForBackend, tauriFetch
   - `web/src/main.ts` — Global error handler
   - `web/vite.config.ts` — Vite proxy
   - `web/index.html` — CSP
   - `api/routes/chat.py` — WebSocket handler
   - `api/middleware/auth.py` — Auth middleware
   - `api/middleware/rate_limit.py` — Rate limiting
   - `api/ws_registry.py` — WS registry
   - `api/cors_config.py` — CORS config
   - `desktop/src-tauri/src/main.rs` — Tauri sidecar lifecycle
   - `desktop/src-tauri/src/port_manager.rs` — Port allocation

4. Traced every async call site of `connectSession()` to verify R-002 completeness
5. Traced the heartbeat ping/pong round-trip to verify R-005 completeness
6. Grep-searched for `maxma:error` event listeners to verify R-007 completeness

---

## Challenges Filed

### B-001 (challenges R-002): Missed `.catch()` call site — unhandled rejection still possible

**Type**: Challenge (R-002 fix incomplete)
**File**: `web/src/composables/useChat.ts:271`
**Severity**: medium (matches original R-002 priority)

**Claim**: Red's fix for R-002 added `.catch()` handlers at 3 call sites but missed a 4th at line 271.

**Evidence**:
- Line 248: `connectSession(sid).catch(...)` — backend-not-ready retry (FIXED)
- Line 365: `connectSession(sid).catch(...)` — onclose reconnection timer (FIXED)
- Line 416: `connectSession(sid).catch(...)` — ensureConnected() (FIXED)
- **Line 271**: `ch.reconnectTimer = setTimeout(() => connectSession(sid), delay)` — **NO .catch() (MISSED)**

This call site is in the "token not available" branch (line 261: `if (!token)`). When `getToken()` returns empty, the code schedules a retry. On the next execution, `connectSession()` calls `ensureTokenLoaded()` which can throw after exhausting its 3 retries. The resulting promise rejection is unhandled.

**Reproduction**:
1. Set up a scenario where `/auth/token` consistently returns 500
2. The `if (!token)` branch is entered at line 261
3. The retry at line 271 calls `connectSession(sid)` without `.catch()`
4. When `ensureTokenLoaded()` throws, the rejection is unhandled

---

### B-002 (challenges R-005): Missing pong timeout — heartbeat cannot detect all stale connections

**Type**: Challenge (R-005 fix incomplete)
**File**: `web/src/composables/useChat.ts:299-311` (ping interval), `682-683` (pong handler)
**Severity**: medium (matches original R-005 priority)

**Claim**: The heartbeat fix sends pings every 30s but does not monitor for missing pong responses. Under network conditions that silently drop packets in one direction, the connection appears "online" indefinitely.

**Evidence**:
1. The ping `setInterval` (line 299) sends `{ type: "ping" }` every 30s
2. The backend replies with `{ type: "pong" }` (chat.py:318)
3. The frontend pong handler (line 682-683) is a no-op: `case 'pong': break`
4. There is **no variable tracking the last pong timestamp**
5. There is **no proactive connection close when a pong is overdue**

Without pong timeout monitoring:
- Network half-open scenarios (packets dropped in one direction) go undetected
- A dead backend that doesn't close the TCP connection cleanly goes undetected
- The `readyState` remains `OPEN`, and the UI shows "online"
- Messages sent via `send()` silently fail (the exact scenario from R-001)

The fix's own comment claims: "应用层心跳确保 in-flight 连接在 30s + RTT 内被检测到失效并发起重连". But without monitoring pong responses, this claim is false. A broken connection is only detected if the TCP stack eventually times out (potentially 30+ minutes with default OS settings).

**Expected behavior**: The heartbeat should track `lastPongAt` and close the WebSocket proactively if no pong is received within a configurable timeout (e.g., `PING_INTERVAL + PONG_TIMEOUT`).

**Reproduction**:
1. Establish a WebSocket connection (UI shows "online")
2. Use a network tool to simulate unidirectional packet loss (inbound to the client blocked)
3. Observe: pings are sent every 30s (outbound works), but pongs never arrive
4. No detection mechanism exists — the UI stays "online"
5. Attempting to send a message silently fails

---

### B-003 (challenges R-007): No event listener for `maxma:error` — fix is entirely cosmetic

**Type**: Challenge (R-007 fix incomplete)
**File**: `web/src/main.ts:16-25` (dispatch), entire `web/src/` (no listener)
**Severity**: low (matches original R-007 priority)

**Claim**: Red's fix dispatches a `CustomEvent('maxma:error')` from the global error handler, but **no component in the entire codebase listens for this event**. The error notification is effectively invisible to the user — the fix changes nothing in observable behavior.

**Evidence**:
A comprehensive grep search across all source files (`web/src/`) for `maxma:error`, `CustomEvent`, and `addEventListener` found:

- `web/src/main.ts:16` — `window.dispatchEvent(new CustomEvent('maxma:error', ...))` — the dispatch (added by Red)
- **Zero** listeners for `'maxma:error'` anywhere in the codebase

The event is dispatched into the void. No toast, no notification, no user-visible feedback is produced. The global error handler behavior is functionally identical to before the fix: errors are logged to `console.error` and nothing else.

The fix's comment says: "不直接操作 DOM 或 store，避免错误处理本身引发二次错误" — this is a valid concern, but dispatching a CustomEvent without subscribing to it means the fix does nothing.

**What a real fix would require**:
- Adding a listener in a parent component (e.g., `App.vue`) that subscribes to `'maxma:error'` and shows a toast notification
- Or using a different mechanism that doesn't risk secondary errors

**Reproduction**:
1. Trigger an unhandled Vue error (e.g., `throw new Error('test')` in a render function)
2. Observe: `console.error` logs the error (same as before the fix)
3. Observe: `window.dispatchEvent(new CustomEvent('maxma:error', ...))` fires — but nothing receives it
4. No toast, notification, or user-visible feedback appears
5. User experience is identical to the pre-fix behavior

---

## Additional observations (not filed as challenges)

### R-004: Token still exposed in SSE URL

Red's fix for R-004 is a `console.warn` and a comment. The auth token remains in the SSE URL query parameter, visible in server logs and browser dev tools. The arbiter acknowledged this ("full fix requires backend changes"). We agree this is an acknowledged limitation of the `EventSource` API, not an incomplete fix per se. No challenge filed.

### R-001: TOCTOU race fix appears correct

Red's fix tightens the guard from a separate `connected` ref to a direct `readyState` check on the WebSocket object, and propagates the boolean return value through the call chain. In JavaScript's single-threaded execution model, there is no opportunity for `readyState` to change between the check and the `send()` call in the same synchronous block. The fix appears complete.

### R-003/R-006: Backend readiness checks appear correct

Red's R-003 fix properly checks `waitForBackend()` return value. R-006 increases timeout to match documented upper bound. Both appear complete.

---

## Summary

| Item | Type | Severity | Claim |
|------|------|----------|-------|
| B-001 | Challenge R-002 | Medium | Line 271 missed `.catch()` — unhandled rejection possible |
| B-002 | Challenge R-005 | Medium | No pong timeout — heartbeat cannot detect half-open connections |
| B-003 | Challenge R-007 | Low | No listener for `maxma:error` — fix is cosmetic |

Estimated challenge points: 2 (medium) + 2 (medium) + 1 (low) = 5

### Repro scripts
See `repro/` directory:
- `R-002-missed-callsite.md` — Code analysis and reproduction steps
- `R-005-missing-pong-timeout.md` — Pong timeout gap analysis and reproduction
- `R-007-no-listener.md` — Code search evidence and reproduction

### Areas of concern for future rounds
- `api/index.ts:request()` has no timeout — a hanging backend can leave the UI loading indefinitely
- The `threading.RLock()` in `ws_registry.py` is used in an asyncio context (minor, noted by Red)
- WebSocket rate limiting defaults (capacity=6, refill=0.1/s = 6 per 60s) may be too restrictive for chat applications
