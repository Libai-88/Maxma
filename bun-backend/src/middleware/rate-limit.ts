/**
 * middleware/rate-limit.ts — IP 令牌桶限流（api/middleware/rate_limit.py 的 Bun 直译）。
 *
 * 参数与 Python 版一致：capacity=30（突发上限）、refill_rate=2.0/s；
 * 本地回环地址豁免（与 Python 版 EXEMPT 集合同义）；超限返回 429 + RATE_LIMITED 结构。
 */

import type { Context, Next } from "hono";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const EXEMPT_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/** `Bun.serve` 的 server 对象里我们唯一需要的那一小块（避免把 Bun 类型拉进中间件签名）。 */
type BunServerLike = { requestIP?: (req: Request) => { address?: string } | null };

export interface RateLimitOptions {
  capacity?: number;
  refillRate?: number;
  /** 测试可注入时间源 */
  now?: () => number;
}

export function clientIpOf(c: Context): string {
  // 优先反向代理头（与 Python 版行为一致），回退到 Bun 提供的地址
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real;
  // STABILITY-005：Bun 的 Request 没有套接字地址，只读 header 会让**本机所有请求**
  // 都落进 "unknown" 这个桶——于是桌面壳自己的界面点几次就被自己的限流 429 挡住
  // （实测：扩展页刷新两次即 "操作过于频繁"）。回环豁免要靠 server.requestIP。
  // server 由 server.ts 的 app.fetch(req, { server }) 传进来；拿不到就维持 "unknown"
  // （宁可限流也不要把未知来源当成"本地可信"）。
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return address || "unknown";
}

export function createRateLimitMiddleware(options: RateLimitOptions = {}) {
  const capacity = Math.max(1, options.capacity ?? 30);
  const refillRate = Math.max(0.1, options.refillRate ?? 2.0);
  const now = options.now ?? (() => Date.now() / 1000);
  const buckets = new Map<string, Bucket>();

  function take(ip: string): boolean {
    const t = now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: t };
      buckets.set(ip, bucket);
    } else {
      const elapsed = t - bucket.lastRefill;
      if (elapsed > 0) {
        bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = t;
      }
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const ip = clientIpOf(c);
    if (EXEMPT_IPS.has(ip)) return await next();
    if (!take(ip)) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "请求过于频繁，请稍后再试",
          },
        },
        429,
      );
    }
    return await next();
  };
}
