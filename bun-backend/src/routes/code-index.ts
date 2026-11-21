/**
 * routes/code-index.ts — 代码索引与代码智能查询（M2 / C1–C3）。
 *
 * 边界：
 *   - 只能对用户已经授权的工作区根建索引（root_id 经 workspace-store 解析）；
 *   - 只允许本机回环访问（同 workspace/git/security）；
 *   - 查询只返回索引中的相对路径与片段，不接受任意磁盘路径。
 */

import type { Context } from "hono";
import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { listWorkspaceRoots, getWorkspaceRoot } from "../services/workspace-store";
import {
  cancelCodeIndex,
  findDefinition,
  findReferences,
  getCodeIndexStatus,
  listSymbols,
  searchCode,
  startCodeIndex,
  syntaxDiagnostics,
} from "../../../bun-sidecar/src/codeintel/service";

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function requestIsLoopback(c: Context): boolean {
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

function requireLoopback(c: Context): void {
  if (!requestIsLoopback(c)) throw new Error("代码索引接口只允许本机访问");
}

function rootsWithStatus() {
  return getCodeIndexStatus(undefined, listWorkspaceRoots().map((root) => ({ path: root.realpath, label: root.label })))
    .map((row) => ({
      ...row,
      root_id: listWorkspaceRoots().find((root) => root.realpath === row.root)?.id ?? null,
    }));
}

function errorResponse(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("只允许本机") ? 403 : 400;
  if (status >= 500) console.warn("[code-index]", message);
  return c.json({ error: "CODE_INDEX_FAILED", message }, status as 400);
}

export function createCodeIndexRoutes(): Hono {
  const app = new Hono();

  app.get("/api/code-index/status", (c) => {
    try {
      requireLoopback(c);
      return c.json({ roots: rootsWithStatus() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/code-index/build", async (c) => {
    try {
      requireLoopback(c);
      const body = await c.req.json<{ root_id?: string; force?: boolean; max_files?: number }>().catch(() => null);
      if (!body || typeof body !== "object") return c.json({ error: "CODE_INDEX_FAILED", message: "请求体必须是 JSON 对象" }, 400);
      const rootId = typeof body.root_id === "string" ? body.root_id : "";
      const root = getWorkspaceRoot(rootId);
      if (!root) return c.json({ error: "CODE_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
      const status = startCodeIndex(root.realpath, {
        label: root.label,
        force: body.force === true,
        ...(typeof body.max_files === "number" ? { maxFiles: body.max_files } : {}),
      });
      return c.json({ ok: true, status: { ...status, root_id: root.id } }, 202);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/code-index/cancel", async (c) => {
    try {
      requireLoopback(c);
      const body = await c.req.json<{ root_id?: string }>().catch(() => null);
      const root = body && typeof body.root_id === "string" ? getWorkspaceRoot(body.root_id) : null;
      if (!root) return c.json({ error: "CODE_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
      return c.json({ ok: cancelCodeIndex(root.realpath) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/code-index/search", (c) => {
    try {
      requireLoopback(c);
      const query = c.req.query("q") ?? "";
      const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
      return c.json({ hits: searchCode(query, Number.isFinite(limit) ? limit : 20) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/code-index/symbols", (c) => {
    try {
      requireLoopback(c);
      const path = c.req.query("path") ?? "";
      const query = c.req.query("query") ?? "";
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
      if (!path && !query.trim()) return c.json({ error: "CODE_INDEX_FAILED", message: "path 或 query 至少给一个" }, 400);
      return c.json({ symbols: listSymbols({ ...(path ? { path } : {}), ...(query ? { query } : {}), limit: Number.isFinite(limit) ? limit : 100 }) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/code-index/definition", (c) => {
    try {
      requireLoopback(c);
      const name = c.req.query("name") ?? "";
      if (!name.trim()) return c.json({ error: "CODE_INDEX_FAILED", message: "name 不能为空" }, 400);
      return c.json({ definitions: findDefinition(name) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/code-index/references", (c) => {
    try {
      requireLoopback(c);
      const name = c.req.query("name") ?? "";
      const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
      if (!name.trim()) return c.json({ error: "CODE_INDEX_FAILED", message: "name 不能为空" }, 400);
      return c.json({ references: findReferences(name, Number.isFinite(limit) ? limit : 50) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/code-index/diagnostics", async (c) => {
    try {
      requireLoopback(c);
      const body = await c.req.json<{ path?: string }>().catch(() => null);
      if (!body || typeof body.path !== "string" || !body.path.trim()) {
        return c.json({ error: "CODE_INDEX_FAILED", message: "path 不能为空" }, 400);
      }
      const absolute = fs.realpathSync.native(path.resolve(body.path));
      const root = listWorkspaceRoots().find((candidate) => {
        const relative = path.relative(candidate.realpath, absolute);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      });
      if (!root) return c.json({ error: "CODE_INDEX_FAILED", message: "文件不在已授权工作区内" }, 403);
      return c.json({ diagnostics: syntaxDiagnostics(absolute) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
