# Round 1 Handoff — Blue

```yaml
round: 1
team: blue
mode: B
phase_completed_at: 2026-07-19T02:20:00Z

challenges_filed:
  - id: B-001
    challenges: R-002
    title: Missed .catch() call site at useChat.ts:271 — unhandled rejection remains
    severity: medium
    file: web/src/composables/useChat.ts:271
    evidence: |
      Red added .catch() at 3 call sites (lines 248, 365, 416) but missed line 271
      where connectSession(sid) is called inside a setTimeout without .catch().
      This is the "token not available" retry path. ensureTokenLoaded() can throw
      after 3 retries, producing an unhandled promise rejection.

  - id: B-002
    challenges: R-005
    title: Missing pong timeout — heartbeat cannot detect stale connections
    severity: medium
    file: web/src/composables/useChat.ts:299-311
    evidence: |
      The heartbeat sends pings every 30s but does not track pong responses.
      There is no lastPongAt variable, no pong timeout monitoring, and no
      proactive close mechanism. Under half-open network conditions (packets
      dropped in one direction), the connection appears "online" indefinitely.
      Frontend pong handler (line 682) is a no-op: "case 'pong': break".

  - id: B-003
    challenges: R-007
    title: No listener for maxma:error CustomEvent — fix is entirely cosmetic
    severity: low
    file: web/src/main.ts:16-25
    evidence: |
      Red's fix dispatches a CustomEvent('maxma:error') from the global error
      handler. However, grep search across the entire web/src/ directory finds
      ZERO listeners for 'maxma:error'. The event is dispatched into the void.
      User experience is identical to pre-fix: console.error only, no toast/
      notification/UI feedback.

items_deferred:
  - R-004: Token still in SSE URL. Red's "fix" is console.warn + comment.
    Arbiter acknowledged this is a known EventSource limitation requiring
    backend changes. Not challenged because it's a documented compromise.
  - R-001: TOCTOU race fix appears complete in single-threaded JS execution model.
  - R-003/R-006: Both fixes appear complete and correct.

areas_of_concern:
  - web/src/api/index.ts:144-169 (request function) — no timeout on API calls.
    tauriFetch in browser mode uses native fetch which has no timeout by default.
    A hanging backend (during sidecar restart) can leave the UI loading
    indefinitely with no recovery path for the user.
  - web/src/composables/useChat.ts:271 — same as B-001; documented here for
    completeness.
  - api/middleware/rate_limit.py — WsSessionRateLimiter defaults to capacity=6,
    refill_rate=0.1 (6 per 60s). This is very restrictive for chat apps where
    users might send several messages in quick succession during conversation.
  - api/ws_registry.py — uses threading.RLock() in asyncio context (noted by Red).
```
