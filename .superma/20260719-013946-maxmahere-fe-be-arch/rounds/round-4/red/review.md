# Round 4 — Red review

## Mode: Fix Blue's B-004 + new issue hunt

### Summary

Round 4 tasked Red with fixing **B-004** (MEDIUM, +2): RateLimitMiddleware defined with unit tests but never imported or registered in `api/server.py`. All HTTP endpoints were completely unthrottled.

The fix is implemented and verified with `pytest -q` (1824 passed, 7 skipped — no regressions). No new medium/high priority issues were found.

---

## B-004 fix: RateLimitMiddleware never registered on FastAPI app

**Files**: `api/server.py` (2 changes)

**Root cause**: `api/server.py` imported only `RequestLogMiddleware` from `api.middleware` and registered 3 middlewares (`CORSMiddleware`, `AuthMiddleware`, `RequestLogMiddleware`). `RateLimitMiddleware` was defined in `api/middleware/rate_limit.py`, complete with `TokenBucket` infrastructure, skip-path lists, trusted-proxy-aware IP extraction, and 429 `JSONResponse` rejection — but never wired into the application. All HTTP endpoints were unthrottled.

**Fix**:
1. **Import** (line 18): Changed `from api.middleware import RequestLogMiddleware` to `from api.middleware import RateLimitMiddleware, RequestLogMiddleware`
2. **Registration** (between AuthMiddleware and RequestLogMiddleware): Added `app.add_middleware(RateLimitMiddleware)` with a comment explaining the execution order.

**Middleware execution order** (LIFO — last added runs first):
```
RequestLog  (outermost) — logs all requests
RateLimit   — throttles before auth, avoids consuming quota on rejected requests
Auth        — validates token
CORS        — handles preflight
Route handler
```

**Verification**:
- `pytest tests/test_api/test_rate_limit_extra.py -v` — 30 passed
- `pytest tests/test_api/test_rate_limit_push.py -v` — 8 passed
- `pytest -q` (full suite) — 1824 passed, 7 skipped (zero regressions)

---

## New issues

No new medium or high priority issues were discovered. The codebase has been thoroughly examined across 4 rounds (90+ files) for frontend-backend communication architecture concerns.

### Minor observation

The `RateLimitMiddleware` does not exempt `OPTIONS` preflight requests from rate limiting. `OPTIONS` is not in the `{"GET", "HEAD"}` skip set, so preflight requests to paths not covered by `_RATE_LIMIT_SKIP_PREFIXES` consume rate-limit quota. In practice this is not triggered because:
- Tauri WebView mode: CORS preflight is typically not required for localhost connections.
- Vite dev mode: requests go through the Vite proxy, not directly to the backend.
- Production browser mode: frontend is served from the same origin (static files).

Not filed as an issue — it's a design tuning point rather than a bug given the deployment model.

---

## Patches

Patches are in `./patches/`:
- `B-004.patch` — RateLimitMiddleware import and registration (api/server.py)
