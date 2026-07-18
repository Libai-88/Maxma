# Round 1 Handoff — Red

```yaml
round: 1
team: red
phase_completed_at: 2026-07-19T01:50:00Z

issues_filed:
  - id: R-001
    title: Silent message drop when WebSocket closes between canSend check and send() call
  - id: R-002
    title: connectSession() promise rejection unhandled in ensureConnected() and reconnection timer
  - id: R-003
    title: waitForBackend() return value ignored; connection proceeds regardless
  - id: R-004
    title: Auth token exposed in SSE URL query parameter
  - id: R-005
    title: Missing application-level WebSocket heartbeat/ping mechanism
  - id: R-006
    title: Default waitForBackend timeout mismatched with documented sidecar startup time
  - id: R-007
    title: Global error handler only logs to console, no user-facing feedback

issues_fixed:
  - id: R-001
    patch_path: rounds/round-1/red/patches/R-001.patch
  - id: R-002
    patch_path: rounds/round-1/red/patches/R-002.patch
  - id: R-003
    patch_path: rounds/round-1/red/patches/R-003.patch
  - id: R-004
    patch_path: rounds/round-1/red/patches/R-004.patch
  - id: R-005
    patch_path: rounds/round-1/red/patches/R-005.patch
  - id: R-006
    patch_path: rounds/round-1/red/patches/R-006.patch
  - id: R-007
    patch_path: rounds/round-1/red/patches/R-007.patch

items_deferred: []

areas_of_concern:
  - web/src/composables/useChat.ts:connectSession — potential duplicate WebSocket
    creation if connectSession() is called in rapid succession (the guards use
    await-check-await-check pattern with TOCTOU gap). Not filed because JS event
    loop ordering mitigates most scenarios, but worth review.
  - web/src/stores/activity.ts:startStream — SSE token exposure is a known
    EventSource limitation. Full fix requires backend to support short-lived
    SSE tickets; current fix adds documentation and monitoring only.
  - web/src/composables/useChat.ts:getReconnectDelay — exponential backoff
    with jitter could be improved with a cap on total retry duration (currently
    20 attempts up to 30s each = up to ~10 minutes of retrying).
  - api/ws_registry.py — uses threading.RLock() in asyncio context. Not a
    correctness issue for dict ops, but should be asyncio.Lock() for consistency
    with the async runtime.
```
