# R-002 Challenge: Missed `.catch()` call site at useChat.ts:271

## Issue
Red's fix for R-002 added `.catch()` handlers at 3 call sites, but missed a 4th:

- Line 248: `connectSession(sid).catch(...)` -- backend-not-ready retry (FIXED)
- Line 365: `connectSession(sid).catch(...)` -- onclose reconnection timer (FIXED)
- Line 416: `connectSession(sid).catch(...)` -- ensureConnected() (FIXED)
- **Line 271: `connectSession(sid)` -- NO .catch()** (MISSED)

## Location
`web/src/composables/useChat.ts:271`

## Code
```typescript
// Lines 260-272:
const token = getToken()
if (!token) {
  const ch = getChatStore().channels.get(sid)
  if (!ch) return
  ch.connected = false
  ch.error = '连接失败：未能获取认证令牌'
  if (ch.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    return
  }
  const delay = getReconnectDelay(ch.reconnectAttempts)
  ch.reconnectAttempts++
  ch.reconnectTimer = setTimeout(() => connectSession(sid), delay)  // <-- MISSING .catch()
  return
}
```

## Reproduction
1. Set up a scenario where `ensureTokenLoaded()` consistently fails (e.g., `/auth/token` returns 500), which causes `getToken()` to return `''`
2. The code enters the `if (!token)` branch at line 261
3. On line 271, `connectSession(sid)` is scheduled via setTimeout
4. The timed `connectSession()` call will call `ensureTokenLoaded()` which will throw after exhausting 3 retries
5. The rejection is **unhandled** -- no `.catch()` on this call

## Expected
Every async call to `connectSession()` should have error handling. Line 271 should read:
```typescript
ch.reconnectTimer = setTimeout(() => {
  connectSession(sid).catch(err => {
    console.error(`[useChat] 重连失败 (sid=${sid}):`, err)
    const ch = getChatStore().channels.get(sid)
    if (ch && !ch.error) {
      ch.error = `重连失败：${err instanceof Error ? err.message : String(err)}`
    }
  })
}, delay)
```
