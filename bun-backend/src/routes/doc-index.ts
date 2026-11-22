/**
 * routes/doc-index.ts — 文档索引 REST（C3.1）。
 *
 * 边界与 code-index 一致：
 *   - 只能对用户已授权的工作区根建索引（root_id 经 workspace-store 解析）；
 *   - 只允许本机回环访问；
 *   - 查询只返回索引内的相对路径与来源坐标，不接受任意磁盘路径。
 */

import type { Context } from "hono";
import { Hono } from "hono";

import { getWorkspaceRoot, listWorkspaceRoots } from "../services/workspace-store";
import { cancelDocIndex, getDocIndexStatus, startDocIndex } from "../../../bun-sidecar/src/docintel/index";
import { searchDocs } from "../../../bun-sidecar/src/docintel/search";

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
  if (!requestIsLoopback(c)) throw new Error("文档索引接口只允许本机访问");
}

function rootsWithStatus() {
  const roots = listWorkspaceRoots();
  return getDocIndexStatus(
    undefined,
    roots.map((root) => ({ path: root.realpath, label: root.label })),
  ).map((row) => ({
    ...row,
    root_id: roots.find((root) => root.realpath === row.root)?.id ?? null,
  }));
}

function errorResponse(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("只允许本机") ? 403 : 400;
  if (status >= 500) console.warn("[doc-index]", message);
  return c.json({ error: "DOC_INDEX_FAILED", message }, status as 400);
}

export function createDocIndexRoutes(): Hono {
  const app = new Hono();

  app.get("/api/doc-index/status", (c) => {
    try {
      requireLoopback(c);
      const rootId = c.req.query("root_id") ?? "";
      if (rootId) {
        const root = getWorkspaceRoot(rootId);
        if (!root) return c.json({ error: "DOC_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
        const status = getDocIndexStatus(undefined, [{ path: root.realpath, label: root.label }])[0];
        return c.json({ roots: status ? [{ ...status, root_id: root.id }] : [] });
      }
      return c.json({ roots: rootsWithStatus() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/doc-index/build", async (c) => {
    try {
      requireLoopback(c);
      const body = await c.req.json<{ root_id?: string; force?: boolean; max_files?: number }>().catch(() => null);
      if (!body || typeof body !== "object") {
        return c.json({ error: "DOC_INDEX_FAILED", message: "请求体必须是 JSON 对象" }, 400);
      }
      const rootId = typeof body.root_id === "string" ? body.root_id : "";
      const root = getWorkspaceRoot(rootId);
      if (!root) return c.json({ error: "DOC_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
      const status = startDocIndex(root.realpath, {
        label: root.label,
        force: body.force === true,
        ...(typeof body.max_files === "number" ? { maxFiles: body.max_files } : {}),
      });
      return c.json({ ok: true, status: { ...status, root_id: root.id } }, 202);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/doc-index/cancel", async (c) => {
    try {
      requireLoopback(c);
      const body = await c.req.json<{ root_id?: string }>().catch(() => null);
      const root = body && typeof body.root_id === "string" ? getWorkspaceRoot(body.root_id) : null;
      if (!root) return c.json({ error: "DOC_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
      return c.json({ ok: cancelDocIndex(root.realpath) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/doc-index/search", (c) => {
    try {
      requireLoopback(c);
      const query = c.req.query("q") ?? "";
      const rootId = c.req.query("root_id") ?? "";
      const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
      const root = rootId ? getWorkspaceRoot(rootId) : null;
      if (rootId && !root) return c.json({ error: "DOC_INDEX_FAILED", message: "工作区根不存在或未授权" }, 404);
      const hits = searchDocs(query, {
        ...(root ? { root: root.realpath } : {}),
        limit: Number.isFinite(limit) ? limit : 20,
      });
      return c.json({ hits });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}
