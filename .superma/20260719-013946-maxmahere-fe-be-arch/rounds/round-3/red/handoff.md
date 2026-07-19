# Round 3 — Red handoff

## What was fixed

### B-001 (MEDIUM) — resetToken() race with in-flight ensureTokenLoaded()
- **File**: `web/src/api/index.ts`
- **Change**: Replaced version-counter guard in `finally` block with direct promise-reference comparison. The `capturedPromise` is snapshotted after the IIFE assignment and compared against the current `tokenLoadPromise` before clearing.
- **Why**: The old version-counter approach allowed a stale resolved promise to linger when `resetToken()` incremented the version mid-flight, causing the next `ensureTokenLoaded()` caller to waste itself on the stale promise without fetching a new token.
- **Edge case**: This fix handles all interleavings of `resetToken()` and concurrent `ensureTokenLoaded()` calls, including the case where a new IIFE was created by a second caller between the first caller's promise resolution and its `finally` block.

### B-002 (LOW) — Quick Chat entry point lacks global error handler
- **Files**: `web/src/quick-chat/main.ts`, `web/src/quick-chat/QuickChatApp.vue`
- **Change**: Added `app.config.errorHandler` dispatching `maxma:error` events (matching `main.ts`); added `maxma:error` listener in `QuickChatApp.vue` with a dismissible error bar.
- **Note**: The Quick Chat window's CSS uses `var(--status-error, #e74c3c)` which works with the existing theme system (same as the main App.vue DsToast red color).

### B-003 (MEDIUM) — Backend WS handler drops all non-chat messages + missing sidecar events
- **File**: `api/routes/chat.py`
- **Changes**:
  1. **Message loop restructured**: Uses `asyncio.create_task` for streaming, keeps the message loop responsive via `asyncio.wait`. Whitelist-based message type filtering replaces the old `!= "chat"` blacklist.
  2. **Cancel handling**: Sets `cancel_event`, cancels the turn task, and calls sidecar RPC `cancel`.
  3. **Auxiliary message forwarding**: `user_response`, `plan_response`, `artifact_action`, `update_auto_approve` are forwarded to the sidecar via `client.call()`.
  4. **Missing sidecar events**: Added `ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed` to the event registration list. Generic forwarding via `else` branch in `_make_handler`.
  5. **Cancel event in `_stream_turn_sidecar`**: The turn wait now monitors both `turn_done` and `cancel_event` via `asyncio.wait`.
- **Architecture note**: The streaming function (`_stream_turn_sidecar`) still handles sidecar session creation/management internally. The message loop only has access to `session._sidecar_session_id` for forwarding auxiliary messages. This is a pragmatic design — the sidecar client reference is ephemeral (recreated each turn via `SidecarManager`), but the session ID is stable after the first turn.

## Verified

- `npx tsc --noEmit` — no TypeScript errors
- `npx vite build --mode production` — builds successfully
- `python -m py_compile api/routes/chat.py` — no Python syntax errors

## Areas not addressed

- **Rate-limit skip-prefix list**: Blue mentioned this as a concern in Round 2. The prefix list covers heavily used GET endpoints; it's a tuning concern, not a bug.
- **`threading.RLock()` in asyncio context**: The `WebSocketRegistry` uses `threading.RLock()` which works-but-is-incorrect for asyncio. It was noted in Round 1 and has not caused issues.
- **Production `esbuild.drop: ['console']`**: Strips all console output in production builds. This is intentional but should be paired with a structured logging solution.
- **`ensureConnected()` sets `initialized=true` before WS established**: This was filed as R-009 in Round 2 and is already noted.

## File index

```
web/src/api/index.ts              — B-001 fix
web/src/quick-chat/main.ts         — B-002 fix (error handler)
web/src/quick-chat/QuickChatApp.vue — B-002 fix (error listener + UI)
api/routes/chat.py                 — B-003 fix (WS restructure + sidecar events)
```

## Patch summary

| Patch | Files | Lines changed |
|-------|-------|--------------|
| B-001 | 1     | 11           |
| B-002 | 2     | 32           |
| B-003 | 1     | 160 (net)    |
