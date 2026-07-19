# Round 2 — Blue review

## Mode selected: A — Independent hunt

After thorough analysis of the codebase and Red's patches, I am filing 3 new issues in areas Red has not explored. Red's BC-001/BC-002/BC-003 challenge fixes are verified as correct and complete; the arbiter's assessment stands. No challenges filed against Red's fixes.

---

## Methodology

1. Read summary.md, project.md, Red handoff, arbiter verification
2. Read all Red patches (BC-001..BC-003)
3. Read and analyzed source files:

   **Frontend:**
   - `web/src/composables/useChat.ts` — WebSocket lifecycle, reconnection, pong timeout
   - `web/src/stores/chat.ts` — SessionChannel interface and factory
   - `web/src/App.vue` — root component, BC-003 toast listener
   - `web/src/api/index.ts` — API client, token lifecycle, concurrent request handling
   - `web/src/main.ts` — Global error handler (R-007 / BC-003)
   - `web/src/quick-chat/main.ts` — Quick Chat entry point (no error handler)
   - `web/src/quick-chat/QuickChatApp.vue` — Quick Chat component
   - `web/src/utils/env.ts` — Tauri fetch, port loading, backend readiness
   - `web/src/composables/useChatInput.ts` — Chat input composable
   - `web/vite.config.ts` — Build and proxy config
   - `web/index.html` — CSP in dev mode
   - `web/src/components/ui/DsToast.vue` — Toast notification component

   **Backend:**
   - `api/routes/chat.py` — WebSocket handler and sidecar bridge
   - `api/server.py` — FastAPI app factory, middleware stack
   - `api/middleware/auth.py` — Auth middleware
   - `api/middleware/rate_limit.py` — Rate limiting middleware
   - `api/middleware/request_log.py` — Request logging middleware
   - `api/cors_config.py` — CORS origins config
   - `api/ws_registry.py` — WebSocket registry
   - `api/errors.py` — Error codes and formatting

   **Desktop/Tauri:**
   - `desktop/src-tauri/src/main.rs` — Sidecar lifecycle, CSP, port management
   - `desktop/src-tauri/tauri.conf.json` — Tauri CSP and window config

4. Traced the full `resetToken()` / `ensureTokenLoaded()` lifecycle for concurrent race conditions
5. Traced the WebSocket message handling flow in `chat.py` for all message types the frontend sends
6. Tested the Quick Chat entry point for error handling coverage

---

## Issues Filed

### BC-004 — resetToken() race with in-flight ensureTokenLoaded()

**Type**: New finding
**File**: `web/src/api/index.ts:83-142`
**Severity**: Medium

**Claim**: When `resetToken()` is called while `ensureTokenLoaded()` has an in-flight fetch (the async IIFE is executing), the version-counter mechanism leaves a stale resolved promise in `tokenLoadPromise`. The next caller to `ensureTokenLoaded()` finds this stale promise, awaits it (immediate resolution), but `tokenFetchedAtRuntime` remains `false` and `token` remains `''`. Only the third call actually fetches the new token.

**Root cause**: The `finally` block at line 129 only clears `tokenLoadPromise` when `tokenLoadVersion === myVersion`. Since `resetToken()` at line 140 increments `tokenLoadVersion`, a concurrent reset shifts the version mid-flight. The in-flight IIFE discards its result (version mismatch at line 97), but the `finally` block also skips clearing the promise (version mismatch at line 130). The stale resolved promise stays in `tokenLoadPromise`.

**Impact**:
- The first API call following `resetToken()` + concurrent `ensureTokenLoaded()` goes out without the `X-Maxma-Token` header, returning 401
- WebSocket reconnection after a 4001 close (which triggers `resetToken()` at `useChat.ts:362`) takes one extra retry cycle (exponential backoff delay) before the token is actually fetched
- In the worst case, the retry delay for the wasted cycle is 1-2 seconds (first exponential backoff step)

**Reproduction**: See `repro/BC-004-resetToken-race.md`

---

### BC-005 — Quick Chat entry point lacks global error handler

**Type**: New finding
**File**: `web/src/quick-chat/main.ts:14-16`
**Severity**: Low

**Claim**: The Quick Chat window (`quick-chat/main.ts`) creates the Vue app without assigning `app.config.errorHandler`, unlike the main entry point (`main.ts:11-26`) which has a complete error handler that dispatches `maxma:error` events and shows user-visible toasts (R-007 + BC-003).

**Evidence**:
- Main entry point (`web/src/main.ts:11-26`): `app.config.errorHandler = (err, _instance, info) => { ... dispatchEvent(new CustomEvent('maxma:error', ...)) }`
- Quick Chat entry point (`web/src/quick-chat/main.ts:14-16`): `const app = createApp(QuickChatApp); app.use(createPinia()); app.mount('#app')`
- No error handler assignment, no `maxma:error` dispatch, no toast
- Errors in Quick Chat silently fail with only console output (which is stripped in production builds — see `vite.config.ts:44` `drop: ['console']`)

**Impact**: Users interacting with the Quick Chat window receive no visual feedback for unhandled Vue errors (render failures, missing state, etc.). The "Ctrl+Shift+Space" quick-chat feature, designed for interruption-free work, can silently malfunction without the user noticing.

**Reproduction**: See `repro/BC-005-quickchat-no-error-handler.md`

---

### BC-006 — Backend WS handler silently drops all non-chat messages

**Type**: New finding
**File**: `api/routes/chat.py:321`
**Severity**: Medium

**Claim**: The WebSocket message loop in `websocket_chat()` at line 321 has a catch-all filter that drops every message type except `ping` and `chat`. The frontend sends at least 5 other message types (`cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve`) which are all silently discarded.

**Simultaneously**, the sidecar event-publisher registration in `_stream_turn_sidecar()` (lines 193-197) only forwards 6 event types: `token`, `tool_start`, `tool_end`, `tool_error`, `error`, `answer`, `done`. Events that the sidecar may emit during turn processing — `ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed` — are NOT forwarded to the frontend.

**Evidence**:
- Line 321: `if msg.get("type") != "chat": continue` — drops `cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve`
- Lines 194-197: Only 6 event types registered for forwarding; `ask_user` and all `plan_*` event types are absent
- Frontend (`useChat.ts:1137-1181`) implements `cancel()`, `sendUserResponse()`, `sendPlanResponse()`, `sendArtifactAction()`, `setAutoApprove()` — all of which send WebSocket messages that the backend ignores
- Frontend (`useChat.ts:710-758` and `771-854`) handles `ask_user`, `plan_proposed`, `plan_step_*`, `plan_completed` events — but backend never forwards them

**Impact**:
- The cancel button (ChatInput / Quick Chat) has no effect — the backend never reads the `cancel` message because it's blocked processing the current turn's `_stream_turn_sidecar()` await, and even if read, it would be dropped by the filter
- Tool approval flows (`ask_user` → `user_response`) are completely non-functional
- Plan review/approval/rejection (`plan_proposed` → `plan_response`) is completely non-functional
- Artifact actions are silently dropped
- Auto-approve toggles during a session are silently discarded

**Note**: This is not a race condition or edge case — it is a static code path. Every non-chat message is unconditionally dropped every time.

**Reproduction**: See `repro/BC-006-ws-message-drop.md`

---

## Summary

| ID | Type | Severity | Title |
|----|------|----------|-------|
| BC-004 | New finding | Medium | resetToken() race with in-flight ensureTokenLoaded() |
| BC-005 | New finding | Low | Quick Chat entry point lacks global error handler |
| BC-006 | New finding | Medium | Backend WS handler silently drops all non-chat messages |

Estimated points: 2 (medium) + 1 (low) + 2 (medium) = 5

### Areas of concern for future rounds
- The rate-limit skip-prefix list includes highly active GET endpoints — this is good design, but the list should be audited for missing read-only endpoints that could cause premature 429s under bursty concurrent frontend loads
- `threading.RLock()` in `WebSocketRegistry` under asyncio context (noted by Red R1) — works but is semantically incorrect and may mask bugs if the registry is ever accessed from a background thread
- Production `esbuild.drop: ['console']` strips all diagnostics from the bundle — while intentional, it makes production debugging significantly harder and should be paired with a structured logging alternative
