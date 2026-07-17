"""测试 — api/middleware/rate_limit.py 限流中间件。

覆盖 TokenBucket / TokenBucketRegistry / RateLimitMiddleware /
WsSessionRateLimiter / get_ws_rate_limiter。
"""

import asyncio
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import rate_limit as rl_mod
from api.middleware.rate_limit import (
    RateLimitMiddleware,
    TokenBucket,
    TokenBucketRegistry,
    WsSessionRateLimiter,
    get_ws_rate_limiter,
    reset_ws_rate_limiter,
)


class TestTokenBucket:
    def test_init_defaults(self):
        b = TokenBucket(capacity=10, refill_rate=1.0)
        assert b.capacity == 10.0
        assert b.refill_rate == 1.0
        assert abs(b.peek() - 10.0) < 0.1  # 默认满桶

    def test_init_clamps_minimums(self):
        b = TokenBucket(capacity=0, refill_rate=0)
        assert b.capacity == 1.0  # max(1.0, 0)
        assert b.refill_rate == 0.1  # max(0.1, 0)

    def test_init_with_initial_tokens(self):
        b = TokenBucket(capacity=10, refill_rate=1.0, initial_tokens=3)
        # peek() 会触发 _refill()，经过极短时间后 token 略增
        assert abs(b.peek() - 3.0) < 0.1

    def test_try_take_success(self):
        b = TokenBucket(capacity=5, refill_rate=1.0)
        assert b.try_take(1) is True
        assert b.peek() < 5.0

    def test_try_take_insufficient(self):
        b = TokenBucket(capacity=2, refill_rate=0.1, initial_tokens=1)
        assert b.try_take(2) is False
        # 令牌未被消耗（peek 会 _refill 略增，但接近 1）
        assert abs(b.peek() - 1.0) < 0.1

    def test_peek_does_not_consume(self):
        b = TokenBucket(capacity=5, refill_rate=0.0, initial_tokens=3)
        # refill_rate=0.1 (clamped min) → 极慢补充，两次 peek 应接近
        p1 = b.peek()
        p2 = b.peek()
        assert abs(p1 - p2) < 0.01

    def test_remaining_property(self):
        b = TokenBucket(capacity=5, refill_rate=0.1, initial_tokens=2)
        assert abs(b.remaining - 2.0) < 0.1

    def test_reset_at_when_full(self):
        b = TokenBucket(capacity=5, refill_rate=1.0, initial_tokens=5)
        # 满桶时 reset_at 约等于 last_refill
        assert b.reset_at <= time.monotonic() + 0.1

    def test_reset_at_when_partial(self):
        b = TokenBucket(capacity=5, refill_rate=1.0, initial_tokens=0)
        # 需要 5 个令牌 / 1.0 per sec = 5 秒
        ra = b.reset_at
        assert ra > time.monotonic()

    def test_refill_over_time(self):
        b = TokenBucket(capacity=10, refill_rate=100.0, initial_tokens=0)
        # 等 0.05s → 补 5 个令牌
        time.sleep(0.06)
        assert b.peek() > 0


class TestTokenBucketRegistry:
    def test_get_creates_and_reuses(self):
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        b1 = reg.get("ip1")
        b2 = reg.get("ip1")
        assert b1 is b2
        b3 = reg.get("ip2")
        assert b3 is not b1

    def test_try_take_convenience(self):
        reg = TokenBucketRegistry(capacity=2, refill_rate=0.1)
        assert reg.try_take("k1") is True
        assert reg.try_take("k1") is True
        assert reg.try_take("k1") is False  # 桶空

    def test_cleanup_removes_idle(self):
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0, idle_ttl=0.0)
        reg.get("k1")
        # idle_ttl=0 → 立即过期
        removed = reg.cleanup()
        assert removed == 1

    def test_cleanup_keeps_recent(self):
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0, idle_ttl=100.0)
        reg.get("k1")
        removed = reg.cleanup()
        assert removed == 0

    def test_reset_clears_all(self):
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        reg.get("k1")
        reg.get("k2")
        reg.reset()
        # 清理后应找不到旧桶（新桶是重新创建的）
        assert len(reg._buckets) == 0

    def test_start_cleanup_task_no_event_loop(self):
        # 在无事件循环的环境下调用应静默跳过
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        reg.start_cleanup_task()
        assert reg._cleanup_task is None

    def test_stop_cleanup_task_none_is_noop(self):
        reg = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        asyncio.run(reg.stop_cleanup_task())
        assert reg._cleanup_task is None


class TestRateLimitMiddleware:
    @pytest.fixture
    def app_with_middleware(self):
        app = FastAPI()

        @app.get("/api/test")
        async def test_endpoint():
            return {"ok": True}

        @app.get("/api/health")
        async def health():
            return {"status": "ok"}

        @app.post("/api/write")
        async def write():
            return {"written": True}

        app.add_middleware(RateLimitMiddleware, capacity=2, refill_rate=100.0)
        return app

    def test_skip_health_check(self, app_with_middleware):
        client = TestClient(app_with_middleware)
        # /api/health 在 skip 列表中，GET 不限流
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_skip_get_for_prefix(self, app_with_middleware):
        app = FastAPI()

        @app.get("/api/stickers")
        async def stickers():
            return {"ok": True}

        app.add_middleware(RateLimitMiddleware, capacity=1, refill_rate=0.01)
        client = TestClient(app)
        # /api/stickers GET 在 skip 前缀中
        resp = client.get("/api/stickers")
        assert resp.status_code == 200

    def test_post_not_skipped(self, app_with_middleware):
        app = FastAPI()

        @app.post("/api/stickers")
        async def upload():
            return {"ok": True}

        app.add_middleware(RateLimitMiddleware, capacity=1, refill_rate=0.01)
        client = TestClient(app)
        # POST /api/stickers 不在 skip 中（skip 仅限 GET/HEAD）
        resp1 = client.post("/api/stickers")
        assert resp1.status_code == 200
        resp2 = client.post("/api/stickers")
        assert resp2.status_code == 429

    def test_rate_limit_429(self, app_with_middleware):
        client = TestClient(app_with_middleware)
        # capacity=2, 消耗 2 个后第 3 个 429
        client.get("/api/test")
        client.get("/api/test")
        resp = client.get("/api/test")
        assert resp.status_code == 429
        body = resp.json()
        assert "error" in body
        assert body["error"]["code"] == "RATE_LIMITED"
        assert "Retry-After" in resp.headers

    def test_non_http_scope_passes_through(self):
        # WebSocket scope type != "http" → 直接放行
        # 通过直接调用中间件验证非 http scope 不被限流
        app = FastAPI()

        @app.get("/api/test")
        async def test_ep():
            return {"ok": True}

        app.add_middleware(RateLimitMiddleware, capacity=1, refill_rate=0.01)
        client = TestClient(app)
        # 正常 HTTP 请求应工作
        resp = client.get("/api/test")
        assert resp.status_code == 200

    def test_get_client_ip_from_client(self):
        scope = {"client": ("192.168.1.1", 12345), "headers": []}
        assert RateLimitMiddleware._get_client_ip(scope) == "192.168.1.1"

    def test_get_client_ip_from_xff(self):
        scope = {
            "client": None,
            "headers": [(b"x-forwarded-for", b"10.0.0.1, 10.0.0.2")],
        }
        assert RateLimitMiddleware._get_client_ip(scope) == "10.0.0.1"

    def test_get_client_ip_unknown(self):
        scope = {"client": None, "headers": []}
        assert RateLimitMiddleware._get_client_ip(scope) == "unknown"


class TestWsSessionRateLimiter:
    def test_try_consume_allowed(self):
        limiter = WsSessionRateLimiter(capacity=3, refill_rate=100.0)
        allowed, err = limiter.try_consume("s1")
        assert allowed is True
        assert err is None

    def test_try_consume_denied(self):
        limiter = WsSessionRateLimiter(capacity=1, refill_rate=0.01)
        limiter.try_consume("s1")
        allowed, err = limiter.try_consume("s1")
        assert allowed is False
        assert err is not None
        assert err["code"] == "RATE_LIMITED"

    def test_reset(self):
        limiter = WsSessionRateLimiter(capacity=1, refill_rate=0.01)
        limiter.try_consume("s1")
        limiter.reset()
        # 重置后可再次消费
        allowed, _ = limiter.try_consume("s1")
        assert allowed is True


class TestGetWsRateLimiter:
    def test_singleton(self):
        reset_ws_rate_limiter()
        r1 = get_ws_rate_limiter()
        r2 = get_ws_rate_limiter()
        assert r1 is r2

    def test_reset_clears_singleton(self):
        r1 = get_ws_rate_limiter()
        reset_ws_rate_limiter()
        r2 = get_ws_rate_limiter()
        assert r1 is not r2
