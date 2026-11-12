/**
 * tests/panels-2.2g.test.ts — settings_panels 四面板单测（阶段 2.2g）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { authHeaderFor } from "./_helpers/auth";

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
/** 读 auth token 生成鉴权头（实现见 tests/_helpers/auth.ts，勿再手搓 sqlite 类型桩）。 */
function authHeader(): Record<string, string> {
  return authHeaderFor(dataDir);
}

describe("settings_panels（阶段 2.2g）", () => {
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
