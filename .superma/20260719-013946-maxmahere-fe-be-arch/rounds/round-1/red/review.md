# Round 1 — Red review

## Scope

- `web/src/composables/useChat.ts` — WebSocket lifecycle, reconnection, event routing
- `web/src/stores/activity.ts` — SSE activity stream, connection state, polling fallback
- `web/src/stores/chat.ts` — SessionChannel store
- `web/src/stores/session.ts` — Session lifecycle
- `web/src/api/index.ts` — API client, auth token lifecycle
- `web/src/utils/env.ts` — Backend detection, port loading, waitForBackend
- `web/src/main.ts` — Global error handler
- `web/src/components/ChatInput.vue` — Send flow, error display
- `web/src/views/ChatView.vue` — Wiring between useChat, useChatInput, and ChatInput
- `web/vite.config.ts` — Vite proxy config
- `web/index.html` — CSP
- `api/routes/chat.py` — WebSocket handler
- `api/middleware/auth.py` — Auth middleware
- `api/ws_registry.py` — WS connection registry
- `api/middleware/rate_limit.py` — Rate limiting
- `api/pi_bridge/` — Sidecar bridge
- `api/session_manager.py` — Session state management

## Methodology

1. Read summary.md and project.md for context on the competition theme and scope.
2. Surveyed frontend files first (useChat.ts, ChatInput.vue, ChatView.vue, activity.ts, session.ts, chat.ts, api/index.ts, env.ts, main.ts, vite.config.ts, index.html).
3. Surveyed backend files (chat.py, auth.py, ws_registry.py, rate_limit.py, sidecar_manager.py, rpc_client.py, session_manager.py).
4. Traced the message send path from ChatInput.vue handleSend() -> useChatInput.send() -> ChatView.vue onSend() -> useChat().send() -> WebSocket.send().
5. Traced the connection lifecycle from ensureConnected() -> connectSession() -> WebSocket lifecycle (onopen/onclose/onerror/onmessage).
6. Examined error paths: token fetch failure, backend unavailability, WebSocket close codes, SSE failure.
7. Identified TOCTOU races, unhandled promise rejections, silent failures, and missing heartbeat.

## Findings

### R-001 — Silent message drop when WebSocket closes between `canSend` check and `send()` call

**Priority**: high
**File**: `web/src/components/ChatInput.vue:1012-1041`
**Symbol**: `handleSend`

**Description**: There is a TOCTOU (time-of-check-to-time-of-use) race between the `canSend` guard in `handleSend()` and the actual `WebSocket.send()` call in `useChat().send()`. If the WebSocket disconnects between these two points, the user's input text is cleared but the message is never delivered. The user sees their text disappear and has no indication the message was lost.

**Reproduction steps**:
1. Type a message in ChatInput when WebSocket is connected (status shows "online").
2. Simulate a WebSocket disconnect (e.g., kill the backend sidecar) precisely between the guard check and the send call.
3. Observe: the text field is cleared, but the message was never sent to the backend.
4. A console.warn is logged, but no user-visible error feedback appears.

**Expected**: If the message cannot be sent, the text should NOT be cleared and a user-visible error should be shown (like the existing `connectionError` banner).

**Actual**: Text is cleared regardless of whether the send succeeded. The message is silently dropped.

**Evidence**:
- `web/src/components/ChatInput.vue:1017-1028` — `handleSend()` checks `canSend` (which is the `connected` ref from `useChat`), but this check is separate from the actual WS readyState check in `send()`.
- `web/src/components/ChatInput.vue:1034-1039` — `chatInput.send()` is called and then `text.value = ''` unconditionally.
- `web/src/composables/useChat.ts:1009-1013` — `send()` has a guard `if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) { console.warn(...); return }` that silently returns without setting any error state.

---

### R-002 — `connectSession()` promise rejection unhandled in `ensureConnected()` and reconnection timer

**Priority**: medium
**File**: `web/src/composables/useChat.ts:317,360`
**Symbol**: `connectSession`

**Description**: `connectSession()` can throw if `ensureTokenLoaded()` fails after exhausting its 3 retries. However, both call sites — `ensureConnected()` (line 360) and the reconnection timer callback (line 317) — do not catch the error, leading to unhandled promise rejections that could crash the runtime context.

**Reproduction steps**:
1. Set up a scenario where the token endpoint (`/auth/token`) consistently returns 500.
2. Call `ensureConnected(sid)` to start a session.
3. Observe: `connectSession()` is called without `await`, so the promise is fire-and-forget.
4. When `ensureTokenLoaded()` throws after 3 retries, the rejection is unhandled.

**Expected**: Errors from `connectSession()` should be caught and logged, and the channel should be left in a failed state with an appropriate error message.

**Actual**: Unhandled promise rejection from the WebSocket connection attempt.

**Evidence**:
- `web/src/composables/useChat.ts:360` — `connectSession(sid)` is called without `await` or `.catch()`.
- `web/src/composables/useChat.ts:317` — `chFinal.reconnectTimer = setTimeout(() => connectSession(sid), delay)` — the timer callback does not wrap `connectSession()` in try-catch.
- `web/src/composables/useChat.ts:234` — `await ensureTokenLoaded()` can throw, but `connectSession()` has no try-catch around it.

---

### R-003 — `waitForBackend()` return value ignored; connection proceeds regardless

**Priority**: medium
**File**: `web/src/composables/useChat.ts:228-231`
**Symbol**: `connectSession`

**Description**: In `connectSession()`, `waitForBackend()` is called to check backend readiness. The function returns a boolean (`true` if ready, `false` on timeout). However, the return value is discarded. The connection attempt continues even if the backend is not ready, causing an unnecessary failed WebSocket connection attempt and triggering the reconnection logic prematurely.

**Reproduction steps**:
1. Start the frontend before the backend is ready (e.g., during sidecar initialization).
2. Call `ensureConnected()` to start a session.
3. `waitForBackend()` returns `false` after 60 seconds.
4. `connectSession()` continues to `ensureTokenLoaded()` and `new WebSocket(...)`, both of which fail.
5. The reconnection logic kicks in, adding more latency to eventual recovery.

**Expected**: If `waitForBackend()` returns `false`, the connection attempt should be aborted with a clear error. The reconnection timer should retry `waitForBackend()` first before attempting the full connection sequence.

**Actual**: `connectSession()` ignores the backend readiness check result and proceeds with the full connection flow.

**Evidence**:
- `web/src/composables/useChat.ts:228-231` — `await waitForBackend()` followed by `if (!isChannelStillValid(sid)) return`, but the return value of `waitForBackend()` is never checked.
- `web/src/utils/env.ts:97-121` — `waitForBackend()` returns `boolean` indicating readiness.

---

### R-004 — Auth token exposed in SSE URL query parameter

**Priority**: medium
**File**: `web/src/stores/activity.ts:55-56`
**Symbol**: `startStream`

**Description**: The Activity store uses `EventSource` for the SSE activity stream. Since `EventSource` does not support custom headers, the auth token is passed as a URL query parameter: `?token=${encodeURIComponent(token)}`. This exposes the auth token in:
- Server access logs (the full URL including query string is logged)
- Browser developer tools (Network tab shows the URL)
- The `Referer` header of any requests originating from the page
- Browser history (though SSE requests are not typically stored)

**Reproduction steps**:
1. Open the application.
2. Check the Network tab in browser dev tools.
3. Observe the request URL for `/api/activity/stream?token=<plaintext_token>`.
4. The auth token is visible in the URL.

**Expected**: Auth tokens should not be exposed in URLs. Use an alternative mechanism: a short-lived session cookie, a dedicated SSE auth endpoint that issues a one-time token, or a URL hash fragment if absolutely necessary.

**Actual**: The full auth token appears in the SSE request URL query parameter.

**Evidence**:
- `web/src/stores/activity.ts:55-56` — `const url = `${base}/api/activity/stream${token ? `?token=${encodeURIComponent(token)}` : ''}``

---

### R-005 — Missing application-level WebSocket heartbeat/ping mechanism

**Priority**: medium
**File**: `web/src/composables/useChat.ts`
**Symbol**: `connectSession` (onopen handler)

**Description**: There is no application-level heartbeat (periodic ping) to detect stale WebSocket connections. While the underlying TCP connection has keepalive, the browser's default TCP keepalive timeout can be 2+ hours on some platforms. This means:

- A connection can appear `connected` (UI shows "online") while the underlying WebSocket is actually dead.
- Messages sent via `send()` silently fail (see R-001).
- The `onclose` handler, which triggers reconnection, may not fire for minutes or hours after the actual connection loss.

Note: the backend does handle `ping` messages (in `api/routes/chat.py:317-319`), but the frontend never sends them.

**Reproduction steps**:
1. Establish a WebSocket connection (status shows "online").
2. Simulate a silent disconnection (e.g., unplug the network cable, wait for OS-level keepalive to not apply).
3. Type a message and send it.
4. The message is silently lost (per R-001), but the UI still shows "online".
5. The reconnection logic never triggers because `onclose` is never called.

**Expected**: The frontend should periodically send `{ type: "ping" }` messages (e.g., every 30 seconds) and expect a `pong` response. If no `pong` arrives within a timeout, the WS should be proactively closed and reconnection initiated.

**Actual**: No ping/pong heartbeat at the application level. The backend's ping handler is unused.

**Evidence**:
- `web/src/composables/useChat.ts` — No `setInterval` for ping in `onopen`.
- `api/routes/chat.py:317-319` — Backend handles `{ type: "ping" }` with `{ type: "pong" }`, but frontend never sends pings.
- `web/src/composables/useChat.ts:619-620` — `pong` event handler exists but is a no-op (never triggered).

---

### R-006 — Default `waitForBackend` timeout mismatched with documented sidecar startup time

**Priority**: low
**File**: `web/src/utils/env.ts:97-99`
**Symbol**: `waitForBackend`

**Description**: The `waitForBackend` function defaults to `maxAttempts=30` and `intervalMs=2000`, giving a total timeout of 60 seconds. However, the function's own doc comment (lines 91-92) states that the sidecar can take "30-90 seconds" to start. The default timeout is therefore insufficient for the upper bound of documented startup times. This causes the frontend to give up waiting and proceed with a connection attempt that is guaranteed to fail, triggering wasteful reconnection cycles.

**Reproduction steps**:
1. Start the application on a system where the PyInstaller sidecar takes 75 seconds to start.
2. `waitForBackend()` returns `false` after 60 seconds.
3. The WebSocket connection attempt fails (backend not ready).
4. An unnecessary reconnection cycle begins.

**Expected**: The default `maxAttempts` should be at least 45 (90 seconds at 2s interval) to cover the documented maximum startup time. Alternatively, the function should be called with an explicit timeout tailored to the environment.

**Actual**: Default timeout (60s) is lower than documented maximum startup time (90s).

**Evidence**:
- `web/src/utils/env.ts:91-92` — Comment: "sidecar 启动可能需要 30-90 秒（PyInstaller onefile 解压 + 数据库加载）"
- `web/src/utils/env.ts:97-99` — Default parameters: `maxAttempts: number = 30`, `intervalMs: number = 2000` giving total 60s.

---

### R-007 — Global error handler only logs to console, no user-facing feedback

**Priority**: low
**File**: `web/src/main.ts:11-13`

**Description**: The global Vue error handler (`app.config.errorHandler`) only logs errors to the console. Unhandled component errors or lifecycle errors do not produce any user-visible feedback. If a critical error occurs (e.g., a rendering crash), the user sees a blank or broken UI with no indication of what went wrong or how to recover.

**Reproduction steps**:
1. Trigger an unhandled error in a Vue component (e.g., `throw new Error('test')` in a render function).
2. Observe: the error is logged to console, but there is no UI notification.
3. The user has no way to know an error occurred or what to do about it.

**Expected**: The global error handler should show a user-visible notification (e.g., a toast) in addition to console logging, especially for errors that affect functionality.

**Actual**: Only console.error is called.

**Evidence**:
- `web/src/main.ts:11-13` — `app.config.errorHandler = (err, _instance, info) => { console.error('[GlobalError]', err, '\nInfo:', info) }`

---

## Summary

- Filed: 7 issues
  - High: 1
  - Medium: 4
  - Low: 2
- Estimated points (before arbiter): 1*3 + 4*2 + 2*1 = 13
- Areas deliberately NOT covered:
  - Agent engine (oh-my-pi) internal logic — out of scope per project.md
  - Database/storage layer — out of scope
  - Tauri Rust code — no communication-layer issues identified during survey
  - Backend business logic for specific routes — out of scope
  - UI/UX design changes not related to connection feedback — out of scope

## Suspicions about opponent's work (optional)

N/A — first round.
