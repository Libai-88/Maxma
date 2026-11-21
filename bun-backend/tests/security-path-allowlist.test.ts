/**
 * tests/security-path-allowlist.test.ts — M1/T2 用户显式路径 allowlist 的 REST 契约。
 *
 * 只测实际入口：createApp 的全局 auth/loopback 中间件 + 新 security 路由。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hono } from "hono";

import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let allowDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-security-data-"));
  allowDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-security-allow-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(allowDir, { recursive: true, force: true });
});

async function makeApp(): Promise<Hono> {
  const { createApp } = await import("../src/server");
  return createApp();
}

async function call(
  app: Hono,
  urlPath: string,
  init?: RequestInit,
  address = "127.0.0.1",
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maxma-token", authHeaderFor(dataDir)["x-maxma-token"] ?? "");
  return app.fetch(
    new Request(`http://localhost${urlPath}`, { ...init, headers }),
    { server: { requestIP: () => ({ address }) } },
  );
}

describe("security path allowlist", () => {
  test("添加目录、重复添加幂等、删除后消失；文件路径与缺失路径被拒绝", async () => {
    const app = await makeApp();
    const added = await call(app, "/api/security/path-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: allowDir }),
    });
    expect(added.status).toBe(201);
    const entry = ((await added.json()) as { entry: { id: string; realpath: string } }).entry;
    expect(entry.realpath).toBe(fs.realpathSync.native(allowDir));

    const again = await call(app, "/api/security/path-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: allowDir }),
    });
    expect(again.status).toBe(201);
    expect(((await again.json()) as { entry: { id: string } }).entry.id).toBe(entry.id);

    const list = await call(app, "/api/security/path-allowlist");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { entries: Array<{ id: string }> }).entries.map((e) => e.id)).toEqual([entry.id]);

    const file = path.join(allowDir, "not-a-dir.txt");
    fs.writeFileSync(file, "x", "utf8");
    const rejected = await call(app, "/api/security/path-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: file }),
    });
    expect(rejected.status).toBe(400);

    const missing = await call(app, "/api/security/path-allowlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: path.join(allowDir, "missing") }),
    });
    expect(missing.status).toBe(400);

    const removed = await call(app, `/api/security/path-allowlist/${entry.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const after = await call(app, "/api/security/path-allowlist");
    expect(((await after.json()) as { entries: unknown[] }).entries).toHaveLength(0);
  });

  test("非回环请求 403，不能改写本机授权", async () => {
    const app = await makeApp();
    const remote = await call(app, "/api/security/path-allowlist", undefined, "10.1.2.3");
    expect(remote.status).toBe(403);
    expect(((await remote.json()) as { error?: { code?: string } }).error?.code).toBe("LOOPBACK_ONLY");
  });
});
