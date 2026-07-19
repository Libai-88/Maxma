# Round 3 — Red review

## Mode: Independent hunt (fixing Blue's B-001..B-003 issues)

### Summary

Round 3 tasked Red with fixing the 3 open issues Blue discovered in Round 2:
- **B-001** (MEDIUM, +2): resetToken() race with in-flight ensureTokenLoaded()
- **B-002** (LOW, +1): Quick Chat entry point lacks global error handler
- **B-003** (MEDIUM, +2): Backend WS handler drops all non-chat messages; sidecar missing event types

All 3 fixes are implemented and verified with `npm run build` and Python syntax check. No new issues were filed this round (all high-value areas were covered in previous rounds).

---

## B-001 fix: resetToken() race with in-flight ensureTokenLoaded()

**File**: `web/src/api/index.ts:83-142`

**Root cause**: The `finally` block at the old line 129 used a version counter (`tokenLoadVersion === myVersion`) to guard `tokenLoadPromise = null`. When `resetToken()` incremented `tokenLoadVersion` while the async IIFE was in-flight, the version check failed, *and the finally block skipped clearing the promise*. Meanwhile `resetToken()` had already set `tokenLoadPromise = null`, but the stale resolved promise object survived (the IIFE had returned early due to version mismatch). The next caller to `ensureTokenLoaded()` found `tokenLoadPromise` holding this stale resolved promise, awaited it (immediate resolution), but `tokenFetchedAtRuntime` was still `false` and `token` was still `''`. Only the third call actually fetched a new token.

**Fix**: Replaced the version-counter comparison with a direct promise-reference comparison (`tokenLoadPromise === capturedPromise`). The `capturedPromise` is snapshotted *after* the IIFE assignment (or reuse of an existing promise) and *before* the `await`. The `finally` block now clears `tokenLoadPromise` only if it has not been replaced by a concurrent `resetToken()` or another `ensureTokenLoaded()` call. This is simpler and eliminates the version-counter race entirely.

**Verification**: `npx tsc --noEmit` passes; `npx vite build --mode production` succeeds.

---

## B-002 fix: Quick Chat entry point lacks global error handler

**Files**: `web/src/quick-chat/main.ts`, `web/src/quick-chat/QuickChatApp.vue`

**Root cause**: The Quick Chat window's entry point (`quick-chat/main.ts`) created the Vue app without assigning `app.config.errorHandler`. The main entry point (`main.ts:11-26`) has a complete error handler that dispatches `maxma:error` events to trigger user-visible toasts. Unhandled Vue errors in the Quick Chat window were silently discarded (and production builds strip `console` output).

**Fix**:
1. Added `app.config.errorHandler` to `quick-chat/main.ts`, matching the pattern in `main.ts`: dispatches a `maxma:error` CustomEvent with `message`, `info`, and `timestamp` in the detail.
2. Added a reactive `globalError` state and a `maxma:error` event listener in `QuickChatApp.vue`, showing a dismissible error bar at the top of the Quick Chat window (styled with `.qc-error-bar`).

**Verification**: `npx tsc --noEmit` passes; `npx vite build --mode production` succeeds.

---

## B-003 fix: Backend WS handler silently drops all non-chat messages

**File**: `api/routes/chat.py`

**Root cause** (two sub-issues):

1. **Message filter (line 321)**: The `websocket_chat` message loop used `if msg.get("type") != "chat": continue`, which dropped *every* message type except `ping` and `chat`. The frontend sends at least 5 other types: `cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve`. All were silently discarded.

2. **Missing sidecar events (lines 193-197)**: The sidecar event-publisher registration in `_stream_turn_sidecar` only forwarded 6 event types (`token`, `tool_start`, `tool_end`, `tool_error`, `error`, `answer`, `done`). Events that the sidecar emits during turn processing — `ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed` — were not forwarded. The frontend has full handlers for all of these.

**Fix**:

### 1. Message handling restructured
The `websocket_chat` function was restructured to:
- Use a **whitelist approach** (`KNOWN_TYPES` set) that accepts `chat`, `cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve`. Unknown types are dropped.
- **Run streaming in a background task** (`asyncio.create_task`) so the message loop remains responsive during turn processing.
- Use `asyncio.wait` to interleave waiting for new WebSocket messages and the in-flight turn task — allowing `cancel` to interrupt an active stream.
- **Handle `cancel`**: sets a `cancel_event`, cancels the turn task, and calls `client.call("cancel", ...)` on the sidecar.
- **Forward auxiliary messages**: `user_response`, `plan_response`, `artifact_action`, `update_auto_approve` are forwarded to the sidecar via `client.call(msg_type, ...)`.
- A new `_handle_turn_result` helper processes completed turn tasks (sends `answer` and `done` events), mirroring the original logic.

### 2. `_stream_turn_sidecar` extended
- Added `cancel_event` parameter (optional `asyncio.Event`).
- Added **generic forwarding** in `_make_handler` for event types that don't need special payload transformation (the `else` branch forwards `{"type": evt_type, "payload": payload}`).
- Registered `ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed` event types for sidecar forwarding.
- The `turn_done.wait()` call was replaced with `asyncio.wait` over both `turn_done` and `cancel_event` (when a cancel_event is provided), with a 600s timeout.

**Verification**: `python -m py_compile api/routes/chat.py` passes (no syntax errors).

---

## New issues

No new issues were filed this round. The remaining untapped areas (rate-limit prefix list, threading.RLock in asyncio context, production console stripping) were noted as concerns by Blue in Round 2 but do not represent clear, actionable bugs. The codebase has been thoroughly explored across 3 rounds; the high-value issues have been discovered.

---

## Build verification

- `npx tsc --noEmit` (TypeScript): no errors
- `npx vite build --mode production` (Vite): builds successfully (no TS errors, no warnings beyond the pre-existing chunk size advisory)
- `python -m py_compile api/routes/chat.py` (Python syntax): passes

---

## Patches

Patches are in `./patches/`:
- `B-001.patch` — resetToken race fix (api/index.ts)
- `B-002.patch` — Quick Chat error handler (main.ts + QuickChatApp.vue)
- `B-003.patch` — WS message handling + sidecar events (chat.py)
- `all-fixes.patch` — combined patch of all 3 fixes
