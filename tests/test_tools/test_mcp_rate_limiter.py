"""阶段 4.4 专项测试 — MCP 调用速率限制（per-server_id 令牌桶）。

覆盖 MCPRateLimiter：
- 突发上限（capacity）
- 持续速率（refill_rate）
- 恢复（令牌补充）
- 多 server_id 独立计数
- enabled=False 全放行
- cleanup 清理过期桶
- 单例工厂 get_mcp_rate_limiter
"""

import time

import pytest

from tools.mcp_rate_limiter import (
    MCPRateLimiter,
    get_mcp_rate_limiter,
    reset_mcp_rate_limiter,
)


class TestBasics:
    """基础行为：突发 + 持续速率。"""

    def test_burst_capacity_allowed(self):
        """桶容量内的调用应全部放行。"""
        limiter = MCPRateLimiter(per_minute=60, burst=5, enabled=True)
        for _ in range(5):
            allowed, info = limiter.try_acquire("srv")
            assert allowed is True
            assert info is None

    def test_exceed_burst_is_rejected(self):
        """超过桶容量后应被限流。"""
        limiter = MCPRateLimiter(per_minute=60, burst=3, enabled=True)
        for _ in range(3):
            assert limiter.try_acquire("srv")[0] is True
        allowed, info = limiter.try_acquire("srv")
        assert allowed is False
        assert info is not None
        assert "retry_after" in info
        assert "limit" in info
        assert "remaining" in info
        assert info["limit"] == 3
        assert info["remaining"] == 0

    def test_retry_after_is_positive(self):
        """限流时 retry_after 应为正整数。"""
        limiter = MCPRateLimiter(per_minute=60, burst=1, enabled=True)
        limiter.try_acquire("srv")
        _, info = limiter.try_acquire("srv")
        assert info["retry_after"] >= 1


class TestRecovery:
    """令牌补充恢复。"""

    def test_token_refills_over_time(self):
        """等待足够时间后，令牌应补充，调用再次放行。"""
        # 60 per minute = 1 per second; burst=1
        limiter = MCPRateLimiter(per_minute=60, burst=1, enabled=True)
        # 第一次调用消耗唯一令牌
        assert limiter.try_acquire("srv")[0] is True
        # 立即第二次应被拒
        assert limiter.try_acquire("srv")[0] is False
        # 等待 1.1 秒（补充 ~1.1 个令牌，上限 1）
        time.sleep(1.1)
        # 现在应再次放行
        assert limiter.try_acquire("srv")[0] is True

    def test_refill_does_not_exceed_capacity(self):
        """令牌补充不应超过桶容量。"""
        limiter = MCPRateLimiter(per_minute=600, burst=3, enabled=True)
        # 消耗 2 个令牌
        limiter.try_acquire("srv")
        limiter.try_acquire("srv")
        # 等待足够时间让令牌补充到满桶
        # refill_rate=10/s，从 1 到 3 需 0.2s，等 0.3s 确保满桶
        time.sleep(0.3)
        # 应有 3 个可用（满桶）
        for _ in range(3):
            assert limiter.try_acquire("srv")[0] is True
        # 第 4 次应被拒（超过容量）
        assert limiter.try_acquire("srv")[0] is False


class TestPerServerIsolation:
    """不同 server_id 独立计数。"""

    def test_different_servers_have_independent_buckets(self):
        limiter = MCPRateLimiter(per_minute=60, burst=2, enabled=True)
        # server-a 用尽 2 个令牌
        assert limiter.try_acquire("server-a")[0] is True
        assert limiter.try_acquire("server-a")[0] is True
        assert limiter.try_acquire("server-a")[0] is False  # server-a 限流
        # server-b 仍有满桶
        assert limiter.try_acquire("server-b")[0] is True
        assert limiter.try_acquire("server-b")[0] is True
        assert limiter.try_acquire("server-b")[0] is False  # server-b 也用尽


class TestDisabled:
    """enabled=False 时全放行。"""

    def test_disabled_limiter_always_allows(self):
        limiter = MCPRateLimiter(per_minute=1, burst=1, enabled=False)
        # 即使 burst=1，禁用后应无限放行
        for _ in range(100):
            assert limiter.try_acquire("srv")[0] is True


class TestCleanup:
    """cleanup 清理过期桶。"""

    def test_cleanup_removes_idle_buckets(self):
        limiter = MCPRateLimiter(
            per_minute=60, burst=5, enabled=True, idle_ttl=0.01,
        )
        # 创建几个桶
        limiter.try_acquire("srv-a")
        limiter.try_acquire("srv-b")
        # 等待超过 idle_ttl
        time.sleep(0.05)
        # cleanup 应清理所有桶
        removed = limiter.cleanup()
        assert removed == 2
        # 清理后新调用应创建新桶
        assert limiter.try_acquire("srv-a")[0] is True

    def test_cleanup_keeps_active_buckets(self):
        limiter = MCPRateLimiter(
            per_minute=60, burst=5, enabled=True, idle_ttl=10.0,
        )
        limiter.try_acquire("srv-active")
        # 立即 cleanup，不应清理活跃桶
        removed = limiter.cleanup()
        assert removed == 0


class TestReset:
    """reset 清空所有桶。"""

    def test_reset_clears_all_buckets(self):
        limiter = MCPRateLimiter(per_minute=60, burst=1, enabled=True)
        limiter.try_acquire("srv-a")
        limiter.try_acquire("srv-b")
        # 两者都用尽了
        assert limiter.try_acquire("srv-a")[0] is False
        assert limiter.try_acquire("srv-b")[0] is False

        limiter.reset()

        # reset 后应再次放行（新桶）
        assert limiter.try_acquire("srv-a")[0] is True
        assert limiter.try_acquire("srv-b")[0] is True


class TestSingleton:
    """get_mcp_rate_limiter 单例工厂。"""

    def test_singleton_returns_same_instance(self):
        reset_mcp_rate_limiter()
        a = get_mcp_rate_limiter()
        b = get_mcp_rate_limiter()
        assert a is b

    def test_reset_returns_new_instance(self):
        reset_mcp_rate_limiter()
        a = get_mcp_rate_limiter()
        reset_mcp_rate_limiter()
        b = get_mcp_rate_limiter()
        assert a is not b

    def test_singleton_reads_settings(self):
        """单例应从 settings 读取配置。"""
        reset_mcp_rate_limiter()
        limiter = get_mcp_rate_limiter()
        # 默认配置：per_minute=60, burst=10, enabled=True
        assert limiter.per_minute == 60
        assert limiter.burst == 10
        assert limiter.enabled is True
