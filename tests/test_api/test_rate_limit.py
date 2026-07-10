"""阶段 3.2 测试：令牌桶 + RateLimitMiddleware + WebSocket per-session 限流。

测试覆盖：
1. TokenBucket 基础行为（消耗、补充、容量上限、初始令牌）
2. TokenBucketRegistry（惰性创建、独立桶、清理过期桶）
3. RateLimitMiddleware（HTTP 按 IP 限流、429 响应、跳过白名单路径）
4. WsSessionRateLimiter（per-session 限流、错误响应格式）
5. Metrics 集成（record_rate_limit 统计）
"""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from api.errors import ErrorCode
from api.metrics import Metrics, get_metrics
from api.middleware.rate_limit import (
    RateLimitMiddleware,
    TokenBucket,
    TokenBucketRegistry,
    WsSessionRateLimiter,
    get_ws_rate_limiter,
    reset_ws_rate_limiter,
)


# ── TokenBucket 基础行为 ──────────────────────────────────────


class TestTokenBucket:
    """测试令牌桶基础行为。"""

    def test_initial_tokens_default_to_capacity(self):
        """默认初始令牌数 = 容量。"""
        bucket = TokenBucket(capacity=10, refill_rate=1.0)
        assert bucket.remaining == 10.0

    def test_initial_tokens_explicit(self):
        """显式指定初始令牌数。"""
        bucket = TokenBucket(capacity=10, refill_rate=0.1, initial_tokens=5)
        # 用近似比较避免 refill 补充干扰
        assert abs(bucket.remaining - 5.0) < 0.5

    def test_try_take_consumes_tokens(self):
        """try_take 消耗令牌。"""
        bucket = TokenBucket(capacity=5, refill_rate=0.1)
        assert bucket.try_take(1) is True
        assert bucket.try_take(1) is True
        assert abs(bucket.remaining - 3.0) < 0.5

    def test_try_take_rejected_when_empty(self):
        """令牌不足时拒绝。"""
        bucket = TokenBucket(capacity=2, refill_rate=1.0)
        assert bucket.try_take(1) is True
        assert bucket.try_take(1) is True
        # 桶已空
        assert bucket.try_take(1) is False

    def test_refill_over_time(self):
        """令牌随时间补充。"""
        bucket = TokenBucket(capacity=5, refill_rate=100.0)  # 100/s
        # 消耗所有令牌
        for _ in range(5):
            assert bucket.try_take(1) is True
        assert bucket.try_take(1) is False

        # 等待补充
        time.sleep(0.05)  # 50ms 应补充约 5 个
        assert bucket.try_take(1) is True

    def test_refill_capped_at_capacity(self):
        """补充不超过容量上限。"""
        bucket = TokenBucket(capacity=5, refill_rate=1000.0)
        # 等待足够时间让补充超过容量
        time.sleep(0.01)
        assert bucket.remaining <= 5.0

    def test_capacity_clamped_to_minimum(self):
        """容量最小为 1。"""
        bucket = TokenBucket(capacity=0, refill_rate=1.0)
        assert bucket.capacity == 1.0

    def test_refill_rate_clamped_to_minimum(self):
        """补充速率最小为 0.1。"""
        bucket = TokenBucket(capacity=10, refill_rate=0)
        assert bucket.refill_rate == 0.1

    def test_peek_does_not_consume(self):
        """peek 查看令牌数但不消耗。"""
        bucket = TokenBucket(capacity=5, refill_rate=1.0)
        assert bucket.peek() == 5.0
        assert bucket.remaining == 5.0


# ── TokenBucketRegistry ───────────────────────────────────────


class TestTokenBucketRegistry:
    """测试令牌桶注册表。"""

    def test_lazy_creation(self):
        """首次访问时惰性创建桶。"""
        registry = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        bucket = registry.get("key1")
        assert isinstance(bucket, TokenBucket)
        assert bucket.remaining == 5.0

    def test_same_key_returns_same_bucket(self):
        """同一 key 返回同一桶实例。"""
        registry = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        b1 = registry.get("key1")
        b2 = registry.get("key1")
        assert b1 is b2

    def test_different_keys_get_independent_buckets(self):
        """不同 key 获得独立桶。"""
        registry = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        b1 = registry.get("key1")
        b2 = registry.get("key2")
        assert b1 is not b2
        # 消耗 key1 的令牌不影响 key2
        assert b1.try_take(5) is True
        assert b2.remaining == 5.0

    def test_try_take_convenience(self):
        """try_take 便捷方法。"""
        registry = TokenBucketRegistry(capacity=2, refill_rate=1.0)
        assert registry.try_take("k1") is True
        assert registry.try_take("k1") is True
        assert registry.try_take("k1") is False
        # k2 独立
        assert registry.try_take("k2") is True

    def test_cleanup_removes_idle_buckets(self):
        """cleanup 清理长时间未访问的桶。"""
        registry = TokenBucketRegistry(capacity=5, refill_rate=1.0, idle_ttl=0.05)
        registry.get("k1")
        registry.get("k2")
        # 等待超过 idle_ttl
        time.sleep(0.06)
        removed = registry.cleanup()
        assert removed == 2
        # 清理后重新访问应创建新桶
        b = registry.get("k1")
        assert b.remaining == 5.0

    def test_reset_clears_all_buckets(self):
        """reset 清空所有桶。"""
        registry = TokenBucketRegistry(capacity=5, refill_rate=1.0)
        registry.get("k1")
        registry.get("k2")
        registry.reset()
        # 新桶应有满桶令牌
        assert registry.get("k1").remaining == 5.0


# ── RateLimitMiddleware（HTTP 按 IP 限流）────────────────────


@pytest.fixture
def rate_limit_app():
    """创建带 RateLimitMiddleware 的测试 app（容量 3，便于测试）。"""
    app = FastAPI()

    @app.get("/api/test")
    async def test_endpoint():
        return {"status": "ok"}

    @app.get("/api/health")
    async def health():
        return {"status": "healthy"}

    @app.head("/api/health")
    async def health_head():
        return None

    @app.post("/api/health")
    async def mutate_health():
        return {"status": "mutated"}

    app.add_middleware(RateLimitMiddleware, capacity=3, refill_rate=0.5)
    return app


@pytest.fixture
def rate_limit_client(rate_limit_app):
    return TestClient(rate_limit_app)


class TestRateLimitMiddleware:
    """测试 HTTP 限流中间件。"""

    def test_under_limit_passes(self, rate_limit_client):
        """未超限时请求正常通过。"""
        for _ in range(3):
            resp = rate_limit_client.get("/api/test")
            assert resp.status_code == 200

    def test_over_limit_returns_429(self, rate_limit_client):
        """超过容量返回 429。"""
        # 消耗 3 个令牌
        for _ in range(3):
            rate_limit_client.get("/api/test")
        # 第 4 次应被限流
        resp = rate_limit_client.get("/api/test")
        assert resp.status_code == 429
        assert resp.headers.get("Retry-After") is not None

    def test_429_response_body_has_error_structure(self, rate_limit_client):
        """429 响应体包含 RATE_LIMITED 错误结构。"""
        for _ in range(3):
            rate_limit_client.get("/api/test")
        resp = rate_limit_client.get("/api/test")
        assert resp.status_code == 429
        body = resp.json()
        assert "error" in body
        err = body["error"]
        assert err["code"] == ErrorCode.RATE_LIMITED.value
        assert err["category"] == "rate_limit"
        assert "retry_after" in err["details"]
        assert "limit" in err["details"]
        assert "remaining" in err["details"]

    def test_health_path_skipped(self, rate_limit_client):
        """/api/health 的 GET/HEAD 不限流。"""
        # 只读健康检查可以连续调用超过容量。
        for _ in range(10):
            resp = rate_limit_client.get("/api/health")
            assert resp.status_code == 200
            assert rate_limit_client.head("/api/health").status_code == 200

    def test_write_method_on_skipped_path_is_still_limited(self, rate_limit_client):
        """白名单路径只豁免 GET/HEAD，写方法仍然消耗令牌。"""
        for _ in range(3):
            assert rate_limit_client.post("/api/health").status_code == 200
        assert rate_limit_client.post("/api/health").status_code == 429

    def test_different_ip_independent(self):
        """不同 IP 的限流独立（直接测试 TokenBucketRegistry）。"""
        registry = TokenBucketRegistry(capacity=2, refill_rate=1.0)
        # IP1 消耗 2 个令牌
        assert registry.try_take("1.1.1.1") is True
        assert registry.try_take("1.1.1.1") is True
        # IP1 第 3 次被限流
        assert registry.try_take("1.1.1.1") is False
        # IP2 仍可访问
        assert registry.try_take("2.2.2.2") is True


# ── WsSessionRateLimiter ──────────────────────────────────────


class TestWsSessionRateLimiter:
    """测试 WebSocket per-session 限流器。"""

    def test_under_limit_allows(self):
        """未超限时放行。"""
        limiter = WsSessionRateLimiter(capacity=3, refill_rate=1.0)
        for _ in range(3):
            allowed, err = limiter.try_consume("session1")
            assert allowed is True
            assert err is None

    def test_over_limit_returns_error(self):
        """超过容量返回错误响应。"""
        limiter = WsSessionRateLimiter(capacity=2, refill_rate=1.0)
        limiter.try_consume("session1")
        limiter.try_consume("session1")
        allowed, err = limiter.try_consume("session1")
        assert allowed is False
        assert err is not None
        assert err["code"] == ErrorCode.RATE_LIMITED.value
        assert err["category"] == "rate_limit"
        assert "retry_after" in err["details"]

    def test_different_sessions_independent(self):
        """不同 session 限流独立。"""
        limiter = WsSessionRateLimiter(capacity=1, refill_rate=1.0)
        # session1 消耗令牌
        allowed, _ = limiter.try_consume("session1")
        assert allowed is True
        # session1 第 2 次被限流
        allowed, err = limiter.try_consume("session1")
        assert allowed is False
        # session2 仍可访问
        allowed, _ = limiter.try_consume("session2")
        assert allowed is True

    def test_reset_clears_sessions(self):
        """reset 清空所有 session 桶。"""
        limiter = WsSessionRateLimiter(capacity=1, refill_rate=1.0)
        limiter.try_consume("session1")
        limiter.reset()
        # reset 后 session1 应有满桶
        allowed, _ = limiter.try_consume("session1")
        assert allowed is True


# ── Metrics 集成 ──────────────────────────────────────────────


class TestMetricsRateLimit:
    """测试 Metrics.record_rate_limit 统计。"""

    def setup_method(self):
        """每个测试前重置 Metrics 单例。"""
        Metrics().reset()

    def test_record_rate_limit_http(self):
        """record_rate_limit('http') 正确计数。"""
        m = get_metrics()
        m.record_rate_limit("http")
        m.record_rate_limit("http")
        snapshot = m.get_snapshot()
        assert snapshot["errors"].get("rate_limit_http") == 2

    def test_record_rate_limit_ws(self):
        """record_rate_limit('ws') 正确计数。"""
        m = get_metrics()
        m.record_rate_limit("ws")
        snapshot = m.get_snapshot()
        assert snapshot["errors"].get("rate_limit_ws") == 1

    def test_record_rate_limit_default_scope(self):
        """record_rate_limit 默认 scope=http。"""
        m = get_metrics()
        m.record_rate_limit()
        snapshot = m.get_snapshot()
        assert snapshot["errors"].get("rate_limit_http") == 1


# ── 全局单例 ──────────────────────────────────────────────────


class TestWsRateLimiterSingleton:
    """测试 get_ws_rate_limiter 全局单例。"""

    def setup_method(self):
        reset_ws_rate_limiter()
        Metrics().reset()

    def test_get_ws_rate_limiter_returns_instance(self):
        """get_ws_rate_limiter 返回 WsSessionRateLimiter 实例。"""
        limiter = get_ws_rate_limiter()
        assert isinstance(limiter, WsSessionRateLimiter)

    def test_get_ws_rate_limiter_singleton(self):
        """get_ws_rate_limiter 返回同一实例。"""
        l1 = get_ws_rate_limiter()
        l2 = get_ws_rate_limiter()
        assert l1 is l2

    def test_reset_ws_rate_limiter_creates_new_instance(self):
        """reset_ws_rate_limiter 后创建新实例。"""
        l1 = get_ws_rate_limiter()
        reset_ws_rate_limiter()
        l2 = get_ws_rate_limiter()
        assert l1 is not l2

    def test_uses_settings_when_available(self):
        """配置可用时从 settings 读取参数。"""
        with patch("config.settings.get_settings") as mock_gs:
            class FakeSettings:
                rate_limit_ws_capacity = 99
                rate_limit_ws_window_seconds = 60
            mock_gs.return_value = FakeSettings()
            limiter = get_ws_rate_limiter()
            assert limiter._registry.capacity == 99

    def test_fallback_on_settings_error(self):
        """配置读取失败时使用默认值。"""
        with patch("config.settings.get_settings", side_effect=Exception("config error")):
            limiter = get_ws_rate_limiter()
            assert isinstance(limiter, WsSessionRateLimiter)
            # 默认 capacity=6
            assert limiter._registry.capacity == 6
