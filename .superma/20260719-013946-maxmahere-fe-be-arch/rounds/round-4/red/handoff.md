# Round 4 — Red handoff

## What was fixed

### B-004 (MEDIUM) — RateLimitMiddleware never registered on FastAPI app
- **File**: `api/server.py`
- **Changes**:
  1. **Import** (line 18): Added `RateLimitMiddleware` to the existing `from api.middleware import ...` line.
  2. **Registration** (after AuthMiddleware, before RequestLogMiddleware): Added `app.add_middleware(RateLimitMiddleware)` with a comment explaining execution order.

- **Why**: `RateLimitMiddleware` was defined with full `TokenBucket` infrastructure, skip-path lists, and unit tests — but never imported or registered in `create_app()`. All HTTP endpoints were completely unthrottled.

- **Middleware order rationale**: The LIFO middleware stack executes as `RequestLog -> RateLimit -> Auth -> CORS -> Route`. Rate limiting runs before auth so rejected authentication requests don't consume rate-limit quota. RequestLog wraps everything so rate-limited requests still get logged.

## Verified

- `pytest -q` — 1824 passed, 7 skipped (no regressions)
- 30 rate limit extra tests + 8 rate limit push tests — all pass

## Areas not addressed

- **`RateLimitMiddleware` default capacity (10) / refill rate (0.1667 = 10 per 60s)**: Reasonable defaults for a local-only deployment. Can be tuned via constructor args if needed.
- **WS rate limiter settings ignored**: `get_ws_rate_limiter()` tries to load `rate_limit_ws_capacity` / `rate_limit_ws_window_seconds` from `Settings`, but these fields don't exist in the Pydantic model (`extra="forbid"`). Falls back to defaults (6 per 60s). Not a bug — the defaults are fine for the current deployment — but if centralized rate-limit configuration is desired later, these fields need to be added to `config/settings.py`.
- **OPTIONS preflight not exempt**: Not a practical issue for current deployment (see review.md).
- Previous handoff items from Round 3 remain unaddressed (rate-limit prefix tuning, `threading.RLock` in asyncio context, production console stripping).

## File index

```
api/server.py  — B-004 fix (import + registration)
```

## Patch summary

| Patch | Files | Lines changed |
|-------|-------|--------------|
| B-004 | 1     | 5            |
