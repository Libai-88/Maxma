/**
 * middleware/auth.ts — Token 鉴权中间件（api/middleware/auth.py 的 Bun 直译）。
 *
 * 契约与 Python 版逐条对齐：
 *   - 仅保护 /api/ 与 /ws/ 路径（静态资源天然放行）
 *   - OPTIONS 预检放行
 *   - 白名单：/api/health、/api/auth/token
 *   - GET /api/mcp/oauth/callback 放行（安全性由 state 参数保证）
 *   - GET|HEAD /api/stickers/{category}/{filename} 及 random/{category} 放行
 *     （img 标签无法携带自定义头）
 *   - Token 来源优先级：X-Maxma-Token 头 → ?token= query（HTTP 备用）
 *     → WS subprotocol
 *   - 拒绝：HTTP 401 {detail} / WS 4001
 */

import type { Context, Next } from "hono";

import { timingSafeEqualStr } from "./crypto-equal";

/** 无需鉴权的精确路径。 */
const EXACT_WHITELIST = new Set(["/api/health", "/api/auth/token"]);

function isWhitelisted(path: string, method: string): boolean {
  if (EXACT_WHITELIST.has(path)) return true;
  if (path === "/api/mcp/oauth/callback" && method === "GET") return true;
  // 表情包静态资源：GET/HEAD 且子路径 >= 2 段（{category}/{filename}、random/{category}）
  if (path.startsWith("/api/stickers/")) {
    const sub = path.slice("/api/stickers/".length);
    const parts = sub.split("/").filter((p) => p.length > 0);
    if ((method === "GET" || method === "HEAD") && parts.length >= 2) return true;
  }
  return false;
}

function extractToken(c: Context): string {
  const header = c.req.header("x-maxma-token");
  if (header) return header;

  // HTTP 备用路径：?token=xxx（EventSource / img 无法设置自定义头）
  const qs = c.req.query("token");
  if (qs && qs.length >= 8 && !qs.startsWith("-")) return qs;

  return "";
}

/** WS 握手阶段的 Token 提取（subprotocol 或 header/query 回退）。 */
export function extractWsToken(req: Request, protocols: string[]): string {
  const header = req.headers.get("x-maxma-token");
  if (header) return header;
  const url = new URL(req.url);
  const qs = url.searchParams.get("token");
  if (qs && qs.length >= 8 && !qs.startsWith("-")) return qs;
  const proto = protocols[0];
  if (proto && proto.length >= 8 && !proto.startsWith("-")) return proto;
  return "";
}

export function createAuthMiddleware(expectedToken: () => string) {
  return async function authMiddleware(c: Context, next: Next) {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method.toUpperCase();

    if (!path.startsWith("/api/") && !path.startsWith("/ws/")) {
      return await next();
    }
    if (method === "OPTIONS") return await next();
    if (isWhitelisted(path, method)) return await next();

    const token = extractToken(c);
    const expected = expectedToken();
    if (!expected || !timingSafeEqualStr(token, expected)) {
      return c.json({ detail: "Unauthorized — X-Maxma-Token 缺失或不匹配" }, 401);
    }
    return await next();
  };
}
