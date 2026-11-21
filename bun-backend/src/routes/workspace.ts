/**
 * routes/workspace.ts — Workbench 文件面板的工作区接口（P0 只读）。
 *
 * 这些接口只服务于本机 UI 文件面板：
 *  - 全局 auth middleware 已要求 X-Maxma-Token；
 *  - 这里再要求请求来自 loopback，远程 Web 访问不能浏览宿主机文件系统；
 *  - 工作区根是用户显式授权，不是 Agent 的全局路径白名单。
 */

import type { Context } from "hono";
import { Hono } from "hono";
import * as fs from "node:fs";

import {
  addWorkspaceRoot,
  getWorkspaceRoot,
  listWorkspaceRoots,
  removeWorkspaceRoot,
  renameWorkspaceRoot,
  touchWorkspaceRoot,
  type WorkspaceRoot,
} from "../services/workspace-store";
import {
  listTree,
  readBlobFile,
  readTextFile,
  searchWorkspaceFiles,
  writeTextFile,
  WorkspaceError,
} from "../services/workspace-fs";
import { runWorkspaceCommand, CommandPolicyError } from "../services/command-runner";

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function requestIsLoopback(c: Context): boolean {
  // 不信任 x-forwarded-for：那是可伪造的 header。只认 Bun 的套接字地址。
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

function workspaceError(c: Context, error: unknown) {
  if (error instanceof WorkspaceError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as 400 | 403 | 404 | 413 | 415 | 500,
    );
  }
  return c.json(
    { error: { code: "WORKSPACE_ERROR", message: error instanceof Error ? error.message : String(error) } },
    500,
  );
}

function rootFor(c: Context, rootId: string): WorkspaceRoot {
  if (!rootId) {
    throw new WorkspaceError("WORKSPACE_ROOT_NOT_FOUND", 404, "缺少 root_id");
  }
  const root = getWorkspaceRoot(rootId);
  if (!root) throw new WorkspaceError("WORKSPACE_ROOT_NOT_FOUND", 404, "工作区不存在");
  return root;
}

export function createWorkspaceRoutes(): Hono {
  const app = new Hono();

  app.use("/api/workspace/*", async (c, next) => {
    if (!requestIsLoopback(c)) {
      return c.json(
        { error: { code: "LOOPBACK_ONLY", message: "工作区文件接口仅允许本机访问" } },
        403,
      );
    }
    return await next();
  });

  app.get("/api/workspace/roots", (c) => {
    return c.json({
      roots: listWorkspaceRoots().map((root) => ({
        ...root,
        available: fs.existsSync(root.realpath),
      })),
    });
  });

  app.post("/api/workspace/roots", async (c) => {
    const body = await c.req.json().catch(() => null) as { path?: unknown; label?: unknown } | null;
    if (!body || typeof body.path !== "string" || !body.path) {
      return c.json({ error: { code: "PATH_INVALID", message: "缺少文件夹路径" } }, 400);
    }
    try {
      const root = addWorkspaceRoot(body.path, typeof body.label === "string" ? body.label : undefined);
      return c.json({ root: { ...root, available: true } }, 201);
    } catch (error) {
      return workspaceError(c, new WorkspaceError("PATH_INVALID", 400, error instanceof Error ? error.message : "无法添加工作区"));
    }
  });

  app.delete("/api/workspace/roots/:id", (c) => {
    const removed = removeWorkspaceRoot(c.req.param("id"));
    if (!removed) {
      return c.json({ error: { code: "WORKSPACE_ROOT_NOT_FOUND", message: "工作区不存在" } }, 404);
    }
    return c.json({ removed });
  });

  app.patch("/api/workspace/roots/:id", async (c) => {
    const body = await c.req.json().catch(() => null) as { label?: unknown } | null;
    if (!body || typeof body.label !== "string") {
      return c.json({ error: { code: "PATH_INVALID", message: "缺少标签" } }, 400);
    }
    try {
      const renamed = renameWorkspaceRoot(c.req.param("id"), body.label);
      if (!renamed) {
        return c.json({ error: { code: "WORKSPACE_ROOT_NOT_FOUND", message: "工作区不存在" } }, 404);
      }
      return c.json({ root: { ...renamed, available: fs.existsSync(renamed.realpath) } });
    } catch (error) {
      return workspaceError(c, new WorkspaceError("PATH_INVALID", 400, error instanceof Error ? error.message : "无法重命名工作区"));
    }
  });

  app.get("/api/workspace/search", (c) => {
    try {
      const root = rootFor(c, c.req.query("root_id") ?? "");
      touchWorkspaceRoot(root.id);
      const result = searchWorkspaceFiles(root, c.req.query("q") ?? "", c.req.query("show_ignored") === "1");
      return c.json(result);
    } catch (error) {
      return workspaceError(c, error);
    }
  });

  app.get("/api/workspace/tree", (c) => {
    try {
      const root = rootFor(c, c.req.query("root_id") ?? "");
      touchWorkspaceRoot(root.id);
      const result = listTree(root, c.req.query("path") ?? "", c.req.query("show_ignored") === "1");
      return c.json(result);
    } catch (error) {
      return workspaceError(c, error);
    }
  });

  app.get("/api/workspace/file", (c) => {
    try {
      const root = rootFor(c, c.req.query("root_id") ?? "");
      touchWorkspaceRoot(root.id);
      return c.json({ file: readTextFile(root, c.req.query("path") ?? "") });
    } catch (error) {
      return workspaceError(c, error);
    }
  });

  app.put("/api/workspace/file", async (c) => {
    try {
      const body = await c.req.json<{
        root_id?: string;
        path?: string;
        content?: string;
        base_hash?: string;
      }>().catch(() => null);
      if (!body || typeof body !== "object") {
        throw new WorkspaceError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      }
      const root = rootFor(c, body.root_id ?? "");
      touchWorkspaceRoot(root.id);
      return c.json({
        file: writeTextFile(root, body.path ?? "", body.content ?? "", body.base_hash ?? ""),
      });
    } catch (error) {
      return workspaceError(c, error);
    }
  });

  app.post("/api/workspace/run", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; command?: string; timeout_ms?: number; allow_network?: boolean }>().catch(() => null);
      if (!body || typeof body !== "object") throw new WorkspaceError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      const root = rootFor(c, body.root_id ?? "");
      touchWorkspaceRoot(root.id);
      const result = await runWorkspaceCommand(root, body.command ?? "", body.timeout_ms, {
        allowNetwork: body.allow_network === true,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof WorkspaceError) return workspaceError(c, error);
      if (error instanceof CommandPolicyError) {
        return c.json({ error: { code: error.code, message: error.message } }, 403);
      }
      return c.json({ error: "COMMAND_FAILED", message: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/workspace/blob", (c) => {
    try {
      const root = rootFor(c, c.req.query("root_id") ?? "");
      touchWorkspaceRoot(root.id);
      const result = readBlobFile(root, c.req.query("path") ?? "");
      return c.body(new Uint8Array(result.content), 200, {
        "Content-Type": result.contentType,
        "Content-Length": String(result.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
    } catch (error) {
      return workspaceError(c, error);
    }
  });

  return app;
}
