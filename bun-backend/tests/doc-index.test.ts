/**
 * tests/doc-index.test.ts — 文档索引 REST 的真实入口（含全局 auth + loopback）。
 *
 * 覆盖：授权根才能建索引、后台任务可轮询到 ready、中文检索返回来源坐标、
 * 非回环请求被拒绝、未授权 root_id 404。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hono } from "hono";

import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let workspace = "";
let prevDataDir: string | undefined;
let prevDocDb: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-di-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-di-ws-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevDocDb = process.env.MAXMA_DOC_INDEX_DB;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_DOC_INDEX_DB = path.join(dataDir, "doc-index.db");
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "docs", "notes.md"), "# 文献\n热电材料的热电性能记录。\n");
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevDocDb === undefined) delete process.env.MAXMA_DOC_INDEX_DB;
  else process.env.MAXMA_DOC_INDEX_DB = prevDocDb;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function makeApp(): Promise<Hono> {
  const { createApp } = await import("../src/server");
  return createApp();
}

async function call(app: Hono, urlPath: string, init?: RequestInit, address = "127.0.0.1"): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maxma-token", authHeaderFor(dataDir)["x-maxma-token"] ?? "");
  return app.fetch(new Request(`http://localhost${urlPath}`, { ...init, headers }), {
    server: { requestIP: () => ({ address }) },
  });
}

async function waitReady(app: Hono, rootId: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const res = await call(app, `/api/doc-index/status?root_id=${rootId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roots: Array<{ status: string; error: string | null; fileCount: number }> };
    const current = body.roots[0];
    if (current?.status === "ready") return;
    if (current?.status === "error") throw new Error(current.error ?? "index error");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("doc index not ready");
}

describe("doc-index routes", () => {
  test("建索引 → 中文搜索 → 状态；非回环 403", async () => {
    const { addWorkspaceRoot } = await import("../src/services/workspace-store");
    const root = addWorkspaceRoot(workspace, "docs");
    const app = await makeApp();

    const build = await call(app, "/api/doc-index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, force: true }),
    });
    expect(build.status).toBe(202);
    await waitReady(app, root.id);

    const search = await call(app, `/api/doc-index/search?q=${encodeURIComponent("热电材料")}&root_id=${root.id}`);
    expect(search.status).toBe(200);
    const hits = ((await search.json()) as { hits: Array<{ relPath: string; locator: { lines?: number[] } }> }).hits;
    expect(hits[0]?.relPath).toBe("docs/notes.md");
    expect(hits[0]?.locator.lines?.[0]).toBe(1);
    expect(hits[0]?.locator.lines?.[1]).toBe(2);

    const status = await call(app, `/api/doc-index/status?root_id=${root.id}`);
    expect(status.status).toBe(200);
    const rows = ((await status.json()) as { roots: Array<{ fileCount: number; chunkCount: number }> }).roots;
    expect(rows[0]?.fileCount).toBe(1);
    expect(rows[0]?.chunkCount).toBeGreaterThan(0);

    const cancel = await call(app, "/api/doc-index/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id }),
    });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { ok: boolean }).ok).toBe(false);

    const outside = await call(app, "/api/doc-index/status", undefined, "203.0.113.9");
    expect(outside.status).toBe(403);
  });

  test("未授权 root_id 404", async () => {
    const app = await makeApp();
    const build = await call(app, "/api/doc-index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: "wr_does_not_exist" }),
    });
    expect(build.status).toBe(404);
    const search = await call(app, "/api/doc-index/search?q=热电&root_id=wr_does_not_exist");
    expect(search.status).toBe(404);
  });
});
