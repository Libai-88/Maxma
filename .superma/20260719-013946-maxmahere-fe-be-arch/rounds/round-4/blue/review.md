# Round 4 — Blue review

## Mode: A — Independent hunt (final sweep)

### Summary

Round 4 Blue performed a comprehensive final sweep of the codebase. All previously filed issues (R-001..R-009, B-001..B-004) have been verified as fixed. Red's B-004 patch (RateLimitMiddleware registration) was reviewed and confirmed correct: the middleware is properly imported at `api/server.py:18` and registered at `api/server.py:98` with the correct LIFO stacking order (RequestLog -> RateLimit -> Auth -> CORS -> Route).

**No new medium or high priority issues were discovered.** The codebase has been thoroughly examined across 4 rounds, covering WebSocket lifecycle, REST API communication, session management, auth token flow, error handling, and rate limiting.

---

### Verification results

| Check | Result |
|-------|--------|
| `pytest -q` (full suite) | 1824 passed, 7 skipped -- no regressions |
| Rate-limit specific tests | 38/38 passed (`test_rate_limit_extra.py` + `test_rate_limit_push.py`) |
| `npm run build` (Vite) | Build successful (chunk size warning only, non-blocking) |
| B-004 patch verification | Fix correct: import + registration present and properly ordered |

### Red's B-004 fix verification

- **Import**: `from api.middleware import RateLimitMiddleware, RequestLogMiddleware` at line 18
- **Registration**: `app.add_middleware(RateLimitMiddleware)` at line 98, positioned after `AuthMiddleware` (line 95) and before `RequestLogMiddleware` (line 100)
- **LIFO execution order**: RequestLog (outermost) -> RateLimit -> Auth -> CORS -> Route -- correct. Rate limiting runs before auth, so rejected auth requests don't consume rate-limit quota.

### Final sweep areas examined

1. **WebSocket communication**: `web/src/composables/useChat.ts` -- heartbeat/ping-pong (R-005 fix), exponential backoff reconnection (R-001 fix), token auth via subprotocol, proper close handling with reconnection logic, `ensureConnected()` with `initialized` flag
2. **REST API**: `web/src/api/index.ts` -- `ensureTokenLoaded()` with retry + version guard against `resetToken()` race (B-001 fix), `request()` wrapper with error propagation
3. **Backend WebSocket handler**: `api/routes/chat.py` -- message type whitelisting, ping/pong, cancel handling, sidecar streaming with timeout/cancel/error recovery
4. **Auth middleware**: `api/middleware/auth.py` -- HMAC comparison, subprotocol injection on accept, proper 401/4001 rejection
5. **Rate limiting**: `api/middleware/rate_limit.py` -- TokenBucket implementation, HTTP rate limiter (now registered), WS per-session rate limiter, proper skip lists for read-only endpoints
6. **Session sync**: `web/src/stores/session.ts` -- retry with exponential backoff, orphaned cache cleanup with defensive guard
7. **Global error handler**: Both `web/src/main.ts` and `web/src/quick-chat/main.ts` have `maxma:error` CustomEvent dispatch (B-002 fix)
8. **Vite proxy config**: `web/vite.config.ts` -- `/ws` proxy with `handleProtocols` forwarding, `/api` proxy

### Minor observations (not filed)

- **Backend turn error silence**: When `_stream_turn_sidecar` raises an exception, `_handle_turn_result` logs the error but sends no event to the frontend. The frontend remains in `isStreaming` state until manual cancel or WebSocket reconnect. Mitigated by reconnect cleanup logic and cancel button.
- **WS rate limiter config fallback**: `get_ws_rate_limiter()` tries to load `rate_limit_ws_capacity` / `rate_limit_ws_window_seconds` from Settings, but these fields don't exist in the Pydantic model (`extra="forbid"`). Falls back to defaults silently. Already noted in Red's handoff.
- **REST API token refresh on 401**: `request()` does not automatically retry with a fresh token on 401. Acceptable for local-only deployment where tokens don't expire mid-session.
