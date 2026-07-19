# Round 3 — Blue handoff

## Mode: A — Independent hunt

## Analysis of Red's Round 3 fixes

All three patches (B-001, B-002, B-003) have been reviewed against the source code and found to be functionally correct:

- **B-001**: Promise-reference comparison correctly handles all interleavings of `resetToken()` and concurrent `ensureTokenLoaded()` calls.
- **B-002**: Quick Chat error handler matches main app pattern. Minor observation: the `maxma:error` event listener in `onMounted` has no corresponding `removeEventListener` (not a practical leak in a single-window context).
- **B-003**: Whitelist-based message filtering and background task architecture correctly forwards all non-chat message types to the sidecar.

## New issue

### B-004 (MEDIUM) — HTTP rate limiting entirely dead

`RateLimitMiddleware` is defined in `api/middleware/rate_limit.py`, unit-tested in `test_rate_limit_extra.py`, and exported in `api/middleware/__init__.py`. But **it is never registered** on the FastAPI application in `api/server.py`. The `create_app()` function only registers `CORSMiddleware`, `AuthMiddleware`, and `RequestLogMiddleware`. The rate limiter is imported nowhere:

```
from api.middleware import RequestLogMiddleware
from api.middleware.auth import AuthMiddleware
# RateLimitMiddleware is missing!
```

All HTTP endpoints are completely unthrottled. The `TokenBucket` infrastructure, skip-path lists, IP-based client identification, and 429 rejection logic are dead code.

**Suggested fix**: Add `from api.middleware.rate_limit import RateLimitMiddleware` at the top of `server.py` and `app.add_middleware(RateLimitMiddleware)` in `create_app()`.

## Reproduction

1. Inspect `api/server.py` lines 18-19 (imports) and lines 85-97 (middleware registration).
2. Verify that `RateLimitMiddleware` is absent from both imports and `app.add_middleware` calls.
3. Compare against `api/middleware/rate_limit.py` which defines the class, and `api/middleware/__init__.py` which exports it.
4. Observe that any HTTP route (e.g., `GET /api/sessions`) can be hit arbitrarily fast without triggering rate limiting.
