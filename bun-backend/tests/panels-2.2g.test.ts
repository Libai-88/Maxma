/**
 * tests/panels-2.2g.test.ts — settings_panels 四面板单测（阶段 2.2g）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-panels-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

function authHeader(): Record<string, string> {
  const { Database } = require("bun:sqlite") as {
    Database: new (p: string, o?: object) => { query: (s: string) => { get: () => { token: string } | null } };
  };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

describe("settings_panels（阶段 2.2g）", () => {
  test("hindsight：GET 默认值 → PUT 合并写入 → 422 非法枚举", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const init = (await (await app.request("/api/memory/hindsight-config", { headers: h })).json()) as Record<string, unknown>;
    expect(init.enabled).toBe(false);
    expect(init.retention_days).toBe(90);

    const put = await app.request("/api/memory/hindsight-config", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ enabled: true, retention_days: 180 }),
    });
    const merged = (await put.json()) as Record<string, unknown>;
    expect(merged.enabled).toBe(true);
    expect(merged.retention_days).toBe(180);
    expect(merged.processing_mode).toBe("auto"); // 默认补全

    const bad = await app.request("/api/memory/hindsight-config", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ processing_mode: "never" }),
    });
    expect(bad.status).toBe(422);
  });

  test("tts：legacy provider 规范化 + speed 范围 422", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    // 写入 legacy 值 → GET 读回规范化为 system
    await app.request("/api/settings/tts", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ provider: "edge-tts" }),
    });
    const got = (await (await app.request("/api/settings/tts", { headers: h })).json()) as {
      provider: string;
    };
    expect(got.provider).toBe("system");

    const bad = await app.request("/api/settings/tts", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ speed: 5.0 }),
    });
    expect(bad.status).toBe(422);
  });

  test("browser-tools：allowed_domains 清洗 + 越界 422", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const put = await app.request("/api/settings/browser-tools", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({
        allowed_domains: [" a.com ", "", "b.com", "a.com"],
        viewport_width: 99999,
      }),
    });
    expect(put.status).toBe(422);

    const ok = (await (
      await app.request("/api/settings/browser-tools", {
        method: "PUT",
        headers: h,
        body: JSON.stringify({ allowed_domains: [" a.com ", "", "b.com", "a.com"] }),
      })
    ).json()) as { allowed_domains: string[] };
    expect(ok.allowed_domains).toEqual(["a.com", "b.com"]);
  });

  test("sub-agents：默认值合并 + max_concurrent 越界 422", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const put = await app.request("/api/settings/sub-agents", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ enabled: true }),
    });
    const merged = (await put.json()) as Record<string, unknown>;
    expect(merged.enabled).toBe(true);
    expect(merged.max_concurrent).toBe(3);

    const bad = await app.request("/api/settings/sub-agents", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ max_concurrent: 99 }),
    });
    expect(bad.status).toBe(422);
  });
});
