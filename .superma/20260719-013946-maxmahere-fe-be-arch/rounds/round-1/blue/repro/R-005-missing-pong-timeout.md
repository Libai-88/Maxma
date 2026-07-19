# R-005 Challenge: Missing pong timeout monitoring — heartbeat is one-directional

## Issue
Red's heartbeat fix adds a 30s `setInterval` to send `{ type: "ping" }` messages, but it does **not** track pong responses. The connection can appear "online" indefinitely even when the backend has stopped responding.

## Location
`web/src/composables/useChat.ts:299-311` (ping interval)

```typescript
chFinal._pingTimer = setInterval(() => {
  const ch = getChatStore().channels.get(sid)
  if (ch?.ws && ch.ws.readyState === WebSocket.OPEN) {
    ch.ws.send(JSON.stringify({ type: 'ping' }))
  } else {
    // connection already dead, clear timer
    ...
  }
}, 30000)
```

## Backend handler (chat.py:317-319)
```python
if msg.get("type") == "ping":
    await ws.send_json({"type": "pong"})
    continue
```

## Frontend pong handler (useChat.ts:682)
```typescript
case 'pong':
  break  // NO-OP
```

## Gap
The ping fires every 30s, and the backend replies with pong. But there is **no mechanism** that:

1. **Records the timestamp** of the last received pong
2. **Monitors** whether a pong arrives within a reasonable window (e.g., 10s after each ping)
3. **Proactively closes** the WebSocket if a pong is overdue

### What this means in practice:
- **Network half-open**: If the network drops packets in only one direction (e.g., cellular handoff, firewall idle timeout), the `ping` never reaches the backend, but `readyState` stays `OPEN`. No close event fires. The UI shows "online".
- **Backend deadlock**: If the backend's `send_json()` call blocks or fails silently, no error surfaces to the frontend.
- **Silent message loss**: Messages sent via `send()` will fail silently (the original R-001 scenario) because `readyState` is still `OPEN` but the connection is dead.

## Root cause
The fix assumes that if `ws.send()` succeeds (no exception), the connection is healthy. But `ws.send()` can succeed even when the connection is in a degraded state, and `readyState` only transitions to `CLOSED` after TCP detects the failure — which can take 30+ minutes with default OS keepalive settings.

## Reproduction
1. Establish a WebSocket connection (UI shows "online")
2. Use a network tool (e.g., Clumsy, NetEm) to simulate packet drop **in one direction only** (inbound packets blocked, outbound allowed)
3. Observe: the ping interval continues to fire, `ws.send()` doesn't throw, `readyState` stays OPEN
4. The UI continues to show "online"
5. Messages sent via `send()` are silently lost

Alternatively, more simply:
1. Establish a WebSocket connection
2. Kill the backend process without a proper WebSocket close (e.g., `taskkill /F`)
3. Observe that the frontend may not detect the disconnection for a long time, because `ws.close()` is never called by the server

## Expected
The heartbeat should include pong timeout monitoring:
```typescript
// Track last pong received
let lastPongAt = Date.now()

// In ping interval:
const now = Date.now()
if (now - lastPongAt > PONG_TIMEOUT_MS) {
  // No pong received for too long — force reconnect
  ws.close()
  return
}
ws.send(JSON.stringify({ type: 'ping' }))

// In pong handler:
case 'pong':
  lastPongAt = Date.now()
  break
```

Without this, the heartbeat is a one-directional signal that cannot detect all failure modes.
