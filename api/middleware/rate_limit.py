"""限流中间件 — 令牌桶 + ASGI 中间件（阶段 3.2）。

HTTP 请求：RateLimitMiddleware 按 IP 限流，超限返回 429 JSONResponse
WebSocket 消息：在 chat.py 消息循环内使用 per-session TokenBucket（中间件层
无法拦截长连接内的多次消息）

令牌桶算法：
- 容量 capacity，每秒补充 refill_rate 个令牌
- 请求消耗 1 个令牌；令牌不足时拒绝
- 线程安全（threading.Lock）
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from starlette.responses import JSONResponse

from api.errors import ErrorCode, make_error
from api.metrics import get_metrics

logger = logging.getLogger(__name__)


class TokenBucket:
    """令牌桶 — 线程安全的速率限制器。

    Args:
        capacity: 桶容量（最大令牌数 = 突发上限）
        refill_rate: 每秒补充的令牌数（持续速率）
        initial_tokens: 初始令牌数（默认满桶）
    """

    def __init__(
        self,
        capacity: float,
        refill_rate: float,
        initial_tokens: Optional[float] = None,
    ):
        self.capacity = max(1.0, float(capacity))
        self.refill_rate = max(0.1, float(refill_rate))
        self._tokens = (
            float(initial_tokens) if initial_tokens is not None else self.capacity
        )
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        """补充令牌（必须在持有 self._lock 时调用）。"""
        now = time.monotonic()
        elapsed = now - self._last_refill
        if elapsed <= 0:
            return
        added = elapsed * self.refill_rate
        self._tokens = min(self.capacity, self._tokens + added)
        self._last_refill = now

    def try_take(self, n: float = 1.0) -> bool:
        """尝试消耗 n 个令牌。

        Returns:
            True 如果有足够令牌并已扣除；False 如果令牌不足。
        """
        with self._lock:
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False

    def peek(self) -> float:
        """查看当前可用令牌数（不消耗）。"""
        with self._lock:
            self._refill()
            return self._tokens

    @property
    def remaining(self) -> float:
        """当前剩余令牌数（含补充）。"""
        return self.peek()

    @property
    def reset_at(self) -> float:
        """令牌桶完全恢复的时间戳（monotonic）。"""
        with self._lock:
            self._refill()
            if self._tokens >= self.capacity:
                return self._last_refill
            needed = self.capacity - self._tokens
            return self._last_refill + (needed / self.refill_rate)


class TokenBucketRegistry:
    """令牌桶注册表 — 按键（IP/session_id）维护独立的 TokenBucket 实例。

    线程安全。支持惰性创建和定期清理过期桶。
    """

    def __init__(
        self,
        capacity: float,
        refill_rate: float,
        idle_ttl: float = 600.0,
    ):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.idle_ttl = idle_ttl  # 超过此时间未访问的桶会被清理
        self._buckets: dict[str, tuple[TokenBucket, float]] = {}  # key -> (bucket, last_access)
        self._lock = threading.Lock()

    def get(self, key: str) -> TokenBucket:
        """获取（或惰性创建）指定 key 的 TokenBucket。"""
        now = time.monotonic()
        with self._lock:
            entry = self._buckets.get(key)
            if entry is None:
                bucket = TokenBucket(self.capacity, self.refill_rate)
                self._buckets[key] = (bucket, now)
                return bucket
            bucket, _ = entry
            self._buckets[key] = (bucket, now)
            return bucket

    def try_take(self, key: str, n: float = 1.0) -> bool:
        """便捷方法：尝试消耗 key 对应桶的 n 个令牌。"""
        return self.get(key).try_take(n)

    def cleanup(self) -> int:
        """清理长时间未访问的桶，返回清理数量。"""
        now = time.monotonic()
        with self._lock:
            expired = [
                k for k, (_, last) in self._buckets.items()
                if now - last > self.idle_ttl
            ]
            for k in expired:
                del self._buckets[k]
            return len(expired)

    def reset(self) -> None:
        """重置所有桶（用于测试）。"""
        with self._lock:
            self._buckets.clear()


# ── HTTP 限流中间件 ────────────────────────────────────────────


# 不限流的路径（健康检查、静态资源等）
_RATE_LIMIT_SKIP_PATHS = {"/api/health", "/api/auth/token", "/favicon.ico"}
_RATE_LIMIT_SKIP_PREFIXES = ("/assets/", "/static/", "/api/stickers")


class RateLimitMiddleware:
    """ASGI 中间件 — HTTP 请求按 IP 限流。

    中间件执行顺序（后 add 先执行）：
        RequestLog -> RateLimit -> Auth -> 路由
    限流在 Auth 之前，避免被拒绝的鉴权请求也消耗限流配额。

    超限时返回 429 JSONResponse，body 为 RATE_LIMITED 错误结构。
    """

    def __init__(
        self,
        app,
        capacity: float = 10,
        refill_rate: float = 0.1667,  # 10 per 60s
    ):
        self.app = app
        self._registry = TokenBucketRegistry(
            capacity=capacity,
            refill_rate=refill_rate,
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            # WebSocket 限流在 chat.py 消息循环内处理，中间件层放行
            return await self.app(scope, receive, send)

        path = scope.get("path", "")

        # 跳过不限流的路径
        if path in _RATE_LIMIT_SKIP_PATHS or any(
            path.startswith(p) for p in _RATE_LIMIT_SKIP_PREFIXES
        ):
            return await self.app(scope, receive, send)

        # 按 IP 限流
        client_ip = self._get_client_ip(scope)
        if not self._registry.try_take(client_ip):
            get_metrics().record_rate_limit("http")
            await self._reject(scope, receive, send, client_ip)
            return

        await self.app(scope, receive, send)

    @staticmethod
    def _get_client_ip(scope) -> str:
        """从 ASGI scope 提取客户端 IP。"""
        client = scope.get("client")
        if client:
            return str(client[0])
        # 代理场景：X-Forwarded-For
        headers = dict(scope.get("headers", []))
        xff = headers.get(b"x-forwarded-for", b"")
        if xff:
            return str(xff.decode().split(",")[0].strip())
        return "unknown"

    async def _reject(self, scope, receive, send, client_ip: str) -> None:
        """返回 429 限流响应。"""
        bucket = self._registry.get(client_ip)
        # 修复 Bug 5.4：原实现对 remaining/refill_rate 分别调用 property，每次
        # `bucket.remaining` 都会触发 _refill() 改变内部状态，导致 line 218 与
        # line 227 读到不同的 remaining 值（TOCTOU）。现在一次性快照所有字段。
        remaining = bucket.remaining
        capacity = bucket.capacity
        refill_rate = bucket.refill_rate
        # 计算重试等待时间（秒）：令牌恢复到 1 个所需时间
        retry_after = max(1, int(round((1 - remaining) / refill_rate))) if remaining < 1 else 1

        body = make_error(
            code=ErrorCode.RATE_LIMITED,
            message="请求过于频繁，请稍后重试",
            details={
                "retry_after": retry_after,
                "limit": int(capacity),
                "remaining": int(remaining),
            },
        )

        response = JSONResponse(
            {"detail": body["message"], "error": body},
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )
        await response(scope, receive, send)

        logger.warning(
            "Rate limit exceeded for IP %s on %s (retry_after=%ds)",
            client_ip,
            scope.get("path", ""),
            retry_after,
        )


# ── WebSocket per-session 限流 ─────────────────────────────────


class WsSessionRateLimiter:
    """WebSocket per-session 限流器 — 基于 TokenBucket。

    在 chat.py 消息循环内调用 try_consume(session_id) 判断是否放行。
    超限时返回 format_ws_error 格式的错误事件。
    """

    def __init__(
        self,
        capacity: float = 6,
        refill_rate: float = 0.1,  # 6 per 60s
    ):
        self._registry = TokenBucketRegistry(
            capacity=capacity,
            refill_rate=refill_rate,
        )

    def try_consume(self, session_id: str) -> tuple[bool, Optional[dict]]:
        """尝试消耗 1 个令牌。

        Returns:
            (allowed, error_payload)
            - allowed=True: 放行，error_payload=None
            - allowed=False: 限流，error_payload 为 format_ws_error 格式
        """
        if self._registry.try_take(session_id, 1.0):
            return True, None

        # 修复 Bug 5.4：一次性快照 remaining/capacity/refill_rate，避免多次
        # 调用 bucket.remaining 触发 _refill() 导致前后值不一致。
        bucket = self._registry.get(session_id)
        remaining = bucket.remaining
        capacity = bucket.capacity
        refill_rate = bucket.refill_rate
        retry_after = max(1, int(round((1 - remaining) / refill_rate))) if remaining < 1 else 1

        error_payload = make_error(
            code=ErrorCode.RATE_LIMITED,
            message="消息发送过于频繁，请稍后重试",
            details={
                "retry_after": retry_after,
                "limit": int(capacity),
                "remaining": int(remaining),
            },
        )
        return False, error_payload

    def reset(self) -> None:
        """重置所有 session 桶（用于测试）。"""
        self._registry.reset()


# ── 全局单例 ───────────────────────────────────────────────────

_ws_rate_limiter: Optional[WsSessionRateLimiter] = None
_ws_rate_limiter_lock = threading.Lock()  # 保护单例初始化


def get_ws_rate_limiter() -> WsSessionRateLimiter:
    """获取全局 WebSocket 限流器单例（从 settings 读取配置）。

    线程安全：通过 _ws_rate_limiter_lock 双重检查，保证仅创建一个实例。
    """
    global _ws_rate_limiter
    if _ws_rate_limiter is not None:
        return _ws_rate_limiter
    with _ws_rate_limiter_lock:
        if _ws_rate_limiter is not None:
            return _ws_rate_limiter
        from config.settings import get_settings
        try:
            s = get_settings()
            _ws_rate_limiter = WsSessionRateLimiter(
                capacity=s.rate_limit_ws_capacity,
                refill_rate=s.rate_limit_ws_capacity / s.rate_limit_ws_window_seconds,
            )
        except Exception:
            _ws_rate_limiter = WsSessionRateLimiter()  # 默认值
        return _ws_rate_limiter


def reset_ws_rate_limiter() -> None:
    """重置全局 WebSocket 限流器单例（用于测试/配置更新）。"""
    global _ws_rate_limiter
    with _ws_rate_limiter_lock:
        _ws_rate_limiter = None
