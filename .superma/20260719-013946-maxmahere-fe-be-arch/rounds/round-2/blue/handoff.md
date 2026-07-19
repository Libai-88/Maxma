# Round 2 Handoff — Blue

```yaml
round: 2
team: blue
mode: A (Independent hunt)
phase_completed_at: 2026-07-19T02:20:00Z

# Red's R2 fixes — verification
red_fixes_verified:
  - id: BC-001
    status: correct
    notes: .catch() properly added at line 272-279. All 4 connectSession() call sites now have error handling.
  - id: BC-002
    status: correct
    notes: _lastPongAt tracking in both interfaces, initialized on onopen, updated in pong handler, checked in ping interval with proactive close at 35s threshold.
  - id: BC-003
    status: correct
    notes: DsToast component added to App.vue template, window.addEventListener('maxma:error', ...) in onMounted, reactive state for toast visibility/message.

no_challenges: true

new_issues_filed:
  - id: BC-004
    title: resetToken() race with in-flight ensureTokenLoaded()
    severity: medium
    files:
      - web/src/api/index.ts:83-142
    summary: >
      When resetToken() is called while ensureTokenLoaded() has an in-flight fetch,
      the version-counter mechanism leaves a stale resolved promise in tokenLoadPromise.
      The next ensureTokenLoaded() caller awaits this stale promise (immediate resolution)
      but tokenFetchedAtRuntime remains false. Only the third call actually fetches the token.
      API calls during this window lack auth header (401); WS reconnection takes an extra
      retry cycle.

  - id: BC-005
    title: Quick Chat entry point lacks global error handler
    severity: low
    files:
      - web/src/quick-chat/main.ts:14-16
    summary: >
      quick-chat/main.ts creates the Vue app without app.config.errorHandler, unlike
      main.ts which dispatches maxma:error CustomEvents and shows user-visible toasts
      (R-007 + BC-003). Errors in Quick Chat silently fail with only console output,
      which is stripped in production builds (vite.config.ts:44 drop:['console']).

  - id: BC-006
    title: Backend WS handler silently drops all non-chat messages
    severity: medium
    files:
      - api/routes/chat.py:321
      - api/routes/chat.py:193-197
    summary: >
      The WebSocket message loop at chat.py:321 has a catch-all filter that drops
      every message type except ping and chat. At least 5 message types the frontend
      sends (cancel, user_response, plan_response, artifact_action, update_auto_approve)
      are silently discarded. Simultaneously, the sidecar event-publisher registration
      at lines 193-197 only forwards 7 event types — ask_user and all plan_* events
      from the sidecar are never forwarded to the frontend, even though the frontend
      has complete handler logic for them. Interactive agent features (tool approval,
      plan review, cancel) are completely non-functional through the WS bridge.

areas_of_concern:
  - Production esbuild drop:['console'] strips all console.* output from the bundle.
    While intentional, it makes production debugging harder and means the Quick Chat
    error handler gap (BC-005) is even more impactful in production.
  - The rate-limit skip-prefixes list should be periodically audited as new endpoints
    are added, to avoid premature 429s on GET-only routes.
  - threading.RLock() in WebSocketRegistry under asyncio context (noted R1) — works
    but is semantically incorrect.
```
