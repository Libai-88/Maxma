/**
 * routes/security.ts — 本地安全策略的用户显式配置面（M1 / T2）。
 *
 * 这里只管理 Agent 路径 allowlist；它不是“放宽审批”的后门：
 *   - 所有条目必须是已存在目录，落盘前 realpath；
 *   - 只能追加/删除用户显式选择的根，不接受通配符、相对路径、UNC；
 *   - 只允许 loopback，远程 Web 不能改写本机授权。
 */

import type { Context } from "hono";
import { Hono } from "hono";

import {
  addPathAllowlistEntry,
  listPathAllowlist,
  removePathAllowlistEntry,
} from "../services/path-allowlist";

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function requestIsLoopback(c: Context): boolean {
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

function error(c: Context, message: string, status: 400 | 403 | 404 | 409 | 500 = 400) {
  return c.json({ error: { code: "PATH_ALLOWLIST_ERROR", message } }, status);
}

export function createSecurityRoutes(): Hono {
  const app = new Hono();

  app.use("/api/security/*", async (c, next) => {
    if (!requestIsLoopback(c)) {
      return c.json({ error: { code: "LOOPBACK_ONLY", message: "安全策略接口仅允许本机访问" } }, 403);
    }
    return await next();
  });

  app.get("/api/security/path-allowlist", (c) => {
    return c.json({ entries: listPathAllowlist() });
  });

  app.post("/api/security/path-allowlist", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: unknown };
    if (typeof body.path !== "string") return error(c, "path 必须是字符串");
    try {
      return c.json({ entry: addPathAllowlistEntry(body.path) }, 201);
    } catch (err) {
      return error(c, err instanceof Error ? err.message : String(err), 400);
    }
  });

  app.delete("/api/security/path-allowlist/:id", (c) => {
    const removed = removePathAllowlistEntry(c.req.param("id"));
    if (!removed) return error(c, "条目不存在", 404);
    return c.json({ removed });
  });

  return app;
}
