# Round 3 — Blue review

## Mode: A — Independent hunt

### Summary

Analyzed Red's Round 3 fixes (B-001, B-002, B-003) and verified them sound. Then conducted an independent hunt across the remaining vulnerability surface. Identified 1 new issue:

- **B-004** (MEDIUM, +2): HTTP rate limiting entirely non-functional because `RateLimitMiddleware` is never registered on the FastAPI application.

### B-001 verification — resetToken() race (patched by Red)

**Patch**: Replaced version-counter guard with promise-reference comparison in `tokenLoadPromise` finally block (`web/src/api/index.ts:128-133`).

**Analysis**: The promise-reference pattern (`tokenLoadPromise === capturedPromise`) correctly handles all interleavings:
- Concurrent `ensureTokenLoaded()` calls: only the first caller's finally clears the promise; the second caller's check fails and skips.
- `resetToken()` mid-flight: sets `tokenLoadPromise = null`, so the old promise's finally comparison fails and does not re-clear.
- Nested resets (multiple `resetToken()` calls creating promise generations): each generation's finally correctly leaves clearing to the current promise holder.

**Verdict**: Fixed. No remaining edge case found.

### B-002 verification — Quick Chat error handler (patched by Red)

**Patch**: Added `app.config.errorHandler` in `quick-chat/main.ts` dispatching `maxma:error` CustomEvent, plus `maxma:error` listener and dismissible error bar UI in `QuickChatApp.vue`.

**Analysis**: Error handler matches the pattern in `main.ts`. The error bar uses `var(--status-error, #e74c3c)` for theme-consistent styling. The `CustomEvent` dispatch is wrapped in try/catch to prevent recursive errors.

**Minor observation**: The `window.addEventListener('maxma:error', ...)` in `onMounted` is never paired with `removeEventListener` in `onUnmounted`. Since Quick Chat is a separate browser window that mounts once and never unmounts, this is not a practical leak, but it would accumulate listeners if the component were mounted repeatedly (e.g., in a SPA route scenario).

**Verdict**: Fixed. Functionally correct.

### B-003 verification — Backend WS handler drops non-chat messages (patched by Red)

**Patch**: Restructured `websocket_chat` in `api/routes/chat.py` with whitelist-based message filtering, background task for streaming, `cancel_event` support, and additional sidecar event type registrations.

**Analysis**:
- The whitelist approach (`KNOWN_TYPES` set) correctly accepts `chat`, `cancel`, `user_response`, `plan_response`, `artifact_action`, `update_auto_approve` and drops unknown types.
- The `asyncio.wait` interleaving between `recv_task` and `turn_task` keeps the message loop responsive during streaming.
- Cancel handling correctly sets `cancel_event`, cancels the turn task, and sends sidecar RPC cancel.
- Auxiliary message forwarding to the sidecar uses the correct payload shape.
- The `_make_handler` generic `else` branch correctly forwards all newly registered event types (`ask_user`, `plan_proposed`, `plan_step_start`, `plan_step_end`, `plan_step_error`, `plan_completed`).

**Potential concern**: Both the message loop cancel handler AND `_stream_turn_sidecar`'s cancel_event guard send the sidecar cancel RPC, making it redundant. This is harmless (idempotent RPC) but unnecessary.

**Verdict**: Fixed. All message types now properly forwarded.

---

## New issue filed

### B-004 (MEDIUM) — RateLimitMiddleware never registered on FastAPI app

**File**: `api/server.py`

**Root cause**: The HTTP rate limiting middleware (`RateLimitMiddleware`) is defined in `api/middleware/rate_limit.py`, exported in `api/middleware/__init__.py`, and has unit tests (`test_rate_limit_extra.py`). However, `api/server.py` only registers three middlewares:

```python
app.add_middleware(CORSMiddleware, ...)
app.add_middleware(AuthMiddleware)
app.add_middleware(RequestLogMiddleware)
```

`RateLimitMiddleware` is never imported or added. The import line reads:

```python
from api.middleware import RequestLogMiddleware
```

But `RateLimitMiddleware` is not imported alongside it. Compare with `api/middleware/__init__.py` which exports all three: `["AuthMiddleware", "RateLimitMiddleware", "RequestLogMiddleware"]`.

**Impact**: Every HTTP endpoint is completely unthrottled. The `TokenBucket` infrastructure, the `_RATE_LIMIT_SKIP_PATHS` / `_RATE_LIMIT_SKIP_PREFIXES` lists, the IP-based client identification with trusted proxy support, and the 429 JSONResponse rejection are all dead code. Only the WebSocket per-session rate limiter (`WsSessionRateLimiter`) functions because it is called inline from `chat.py`.

**Severity rationale**: Medium. In the local-only deployment model (Tauri sidecar, localhost-only bind), the practical blast radius is limited. But this is a silent gap between the designed architecture (clearly planned and tested) and the running application. If the server were ever bound to a non-localhost interface, there would be zero protection against request flooding.

**Suggested fix**: Add `from api.middleware.rate_limit import RateLimitMiddleware` and `app.add_middleware(RateLimitMiddleware)` in `create_app()` (or, equivalently, `from api.middleware import RateLimitMiddleware, RequestLogMiddleware` and register it).

---

## Score change if confirmed

- B-004: +2 (medium)
