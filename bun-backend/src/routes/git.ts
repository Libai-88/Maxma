/**
 * routes/git.ts — 工作区 Git 只读接口（P2）。
 *
 * 与 workspace 路由同样的边界：需要全局 token + 请求来自 loopback。
 * 这里只提供 status/diff，不接受任意 cwd 或任意 git 参数。
 */

import type { Context } from "hono";
import { Hono } from "hono";

import { getWorkspaceRoot } from "../services/workspace-store";
import { GitError, gitCommit, gitCreatePullRequest, gitDiff, gitPush, gitRemoteStatus, gitStage, gitStatus, gitUnstage } from "../services/git-service";

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function requestIsLoopback(c: Context): boolean {
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

function rootFor(c: Context, rootId: string) {
  if (!requestIsLoopback(c)) throw new GitError("PATH_INVALID", 403, "Git 接口只允许本机访问");
  const root = getWorkspaceRoot(rootId);
  if (!root) throw new GitError("PATH_INVALID", 404, "工作区根不存在");
  return root;
}

function gitErrorResponse(c: Context, error: unknown) {
  if (error instanceof GitError) {
    if (error.status >= 500) console.warn("[git]", error.code, error.message);
    return c.json({ error: error.code, message: error.message }, error.status as 400);
  }
  console.warn("[git]", error);
  return c.json({ error: "GIT_FAILED", message: error instanceof Error ? error.message : String(error) }, 500);
}

export function createGitRoutes(): Hono {
  const app = new Hono();

  app.get("/api/git/status", async (c) => {
    try {
      return c.json(await gitStatus(rootFor(c, c.req.query("root_id") ?? "")));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.get("/api/git/diff", async (c) => {
    try {
      const root = rootFor(c, c.req.query("root_id") ?? "");
      return c.json(await gitDiff(root, c.req.query("path") ?? "", c.req.query("staged") === "1"));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.post("/api/git/stage", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; paths?: string[] }>().catch(() => null);
      if (!body || typeof body !== "object") throw new GitError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      return c.json(await gitStage(rootFor(c, body.root_id ?? ""), body.paths ?? []));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.post("/api/git/unstage", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; paths?: string[] }>().catch(() => null);
      if (!body || typeof body !== "object") throw new GitError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      return c.json(await gitUnstage(rootFor(c, body.root_id ?? ""), body.paths ?? []));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.post("/api/git/commit", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; message?: string; confirm?: boolean }>().catch(() => null);
      if (!body || typeof body !== "object") throw new GitError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      return c.json(await gitCommit(rootFor(c, body.root_id ?? ""), body.message ?? "", body.confirm === true));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.get("/api/git/remote", async (c) => {
    try {
      return c.json(await gitRemoteStatus(rootFor(c, c.req.query("root_id") ?? "")));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.post("/api/git/push", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; confirm?: boolean }>().catch(() => null);
      if (!body || typeof body !== "object") throw new GitError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      return c.json(await gitPush(rootFor(c, body.root_id ?? ""), body.confirm === true));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  app.post("/api/git/pr", async (c) => {
    try {
      const body = await c.req.json<{ root_id?: string; title?: string; body?: string; base?: string; confirm?: boolean }>().catch(() => null);
      if (!body || typeof body !== "object") throw new GitError("PATH_INVALID", 400, "请求体必须是 JSON 对象");
      return c.json(await gitCreatePullRequest(rootFor(c, body.root_id ?? ""), {
        title: body.title ?? "",
        body: body.body ?? "",
        base: body.base ?? "",
        confirm: body.confirm === true,
      }));
    } catch (error) {
      return gitErrorResponse(c, error);
    }
  });

  return app;
}
