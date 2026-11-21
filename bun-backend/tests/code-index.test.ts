/**
 * tests/code-index.test.ts — 代码索引 REST 的真实入口（含全局 auth + loopback）。
 *
 * 覆盖：授权根才能建索引、后台任务可轮询到 ready、搜索/符号/定义/引用/诊断
 * 返回真实结果、非回环请求被拒绝。索引库落在临时 MAXMA_DATA_DIR 下。
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

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ci-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ci-ws-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "index.ts"), [
    "export interface Config { name: string }",
    "export function buildConfig(name: string): Config { return { name } }",
    "const marker = 'code-index-route-marker';",
  ].join("\n"), "utf8");
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
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
  while (Date.now() - started < 4000) {
    const res = await call(app, "/api/code-index/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roots: Array<{ root_id: string; status: string; error: string | null }> };
    const current = body.roots.find((row) => row.root_id === rootId);
    if (current?.status === "ready") return;
    if (current?.status === "error") throw new Error(current.error ?? "index error");
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("index not ready");
}

describe("code-index routes", () => {
  test("建索引 → 搜索/符号/定义/引用/诊断；非回环 403", async () => {
    const { addWorkspaceRoot } = await import("../src/services/workspace-store");
    const root = addWorkspaceRoot(workspace, "fixture");
    const app = await makeApp();

    const build = await call(app, "/api/code-index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: root.id, force: true }),
    });
    expect(build.status).toBe(202);
    await waitReady(app, root.id);

    const search = await call(app, "/api/code-index/search?q=code-index-route-marker");
    expect(search.status).toBe(200);
    const hits = ((await search.json()) as { hits: Array<{ relPath: string }> }).hits;
    expect(hits.some((hit) => hit.relPath === "src/index.ts")).toBe(true);

    const symbols = await call(app, "/api/code-index/symbols?query=buildConfig");
    expect(symbols.status).toBe(200);
    expect(((await symbols.json()) as { symbols: Array<{ name: string }> }).symbols[0]?.name).toBe("buildConfig");

    const definition = await call(app, "/api/code-index/definition?name=Config");
    expect(definition.status).toBe(200);
    expect(((await definition.json()) as { definitions: Array<{ relPath: string }> }).definitions[0]?.relPath).toBe("src/index.ts");

    const references = await call(app, "/api/code-index/references?name=buildConfig");
    expect(references.status).toBe(200);
    expect(((await references.json()) as { references: unknown[] }).references.length).toBeGreaterThan(0);

    const file = path.join(workspace, "src", "index.ts");
    const diagnostics = await call(app, "/api/code-index/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    expect(diagnostics.status).toBe(200);
    expect(((await diagnostics.json()) as { diagnostics: unknown[] }).diagnostics).toEqual([]);

    const outside = await call(app, "/api/code-index/status", undefined, "203.0.113.9");
    expect(outside.status).toBe(403);
  });

  test("未授权 root_id 404；诊断拒绝工作区外文件 403", async () => {
    const app = await makeApp();
    const build = await call(app, "/api/code-index/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root_id: "wr_does_not_exist" }),
    });
    expect(build.status).toBe(404);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ci-outside-"));
    const file = path.join(outside, "evil.ts");
    fs.writeFileSync(file, "const x = ;", "utf8");
    const diagnostics = await call(app, "/api/code-index/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    expect(diagnostics.status).toBe(403);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
