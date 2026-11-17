/**
 * tests/extensions-route.test.ts — 扩展只读清单与启停接口的契约测试。
 *
 * 闸门纪律：这里验证的是**可观察契约**——
 *   1. 没建过会话时 loaded=false，不假装有清单；
 *   2. 禁用清单能读回来（坏文件按空处理、不 500）；
 *   3. 非法 id / 内置安全扩展名一律拒绝（不能被伪造请求绕过）；
 *   4. 写盘形状是 { disabled: [...] } 且排序。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { authHeaderFor } from "./_helpers/auth";
import {
  disabledExtensionsPath,
  isValidExtensionId,
  readDisabledExtensions,
  setExtensionEnabled,
} from "../src/extensions-config";
import { resetExtensionsSnapshotForTests } from "../../bun-sidecar/src/kernel/extensions";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ext-route-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  // 扩展快照是 kernel 模块级缓存：全量跑时前面的用例建过会话，`loaded` 会残留为 true。
  // 不重置就会得到"单跑绿、全量红"，而且失败原因看起来像路由写错了。
  resetExtensionsSnapshotForTests();
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

describe("disabled_extensions.json", () => {
  test("缺失文件 → 空数组", () => {
    expect(readDisabledExtensions()).toEqual([]);
  });

  test("损坏 JSON → 空数组（不抛错、不阻断启动）", () => {
    fs.writeFileSync(disabledExtensionsPath(), "{ not json", "utf8");
    expect(readDisabledExtensions()).toEqual([]);
  });

  test("写入排序去重，且形状是 { disabled: [] }", () => {
    setExtensionEnabled("b.ts", false);
    setExtensionEnabled("a.ts", false);
    setExtensionEnabled("a.ts", false);
    const raw = JSON.parse(fs.readFileSync(disabledExtensionsPath(), "utf8")) as { disabled: string[] };
    expect(raw).toEqual({ disabled: ["a.ts", "b.ts"] });
  });

  test("重新启用会从清单里移除", () => {
    setExtensionEnabled("a.ts", false);
    setExtensionEnabled("a.ts", true);
    expect(readDisabledExtensions()).toEqual([]);
  });

  test("isValidExtensionId：拒绝绝对路径、穿越、内联/内置、无扩展名", () => {
    for (const bad of ["/abs/x.ts", "C:\\x\\y.ts", "../evil.ts", "a/../../b.ts", "<inline:x>", "builtin:mcp", "noext"]) {
      expect(isValidExtensionId(bad)).toBe(false);
    }
    expect(isValidExtensionId("hello.ts")).toBe(true);
    expect(isValidExtensionId("team/tool.js")).toBe(true);
  });
});

describe("HTTP 契约", () => {
  test("GET 未加载时 loaded=false，并给出目录与禁用清单", async () => {
    fs.writeFileSync(disabledExtensionsPath(), JSON.stringify({ disabled: ["hello.ts"] }), "utf8");
    const app = await makeApp();
    const res = await app.request("/api/extensions", { headers: authHeaderFor(dataDir) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.loaded).toBe(false);
    expect(body.disabled).toEqual(["hello.ts"]);
    expect(typeof body.extensions_dir).toBe("string");
    expect(body.protected_bundled).toContain("maxma-approval");
  });

  test("PUT 非法 id → 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/extensions", {
      method: "PUT",
      headers: { ...authHeaderFor(dataDir), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "<inline:maxma-approval>", enabled: false }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT 内置安全扩展名 → 403，且不写入清单", async () => {
    const app = await makeApp();
    const res = await app.request("/api/extensions", {
      method: "PUT",
      headers: { ...authHeaderFor(dataDir), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "maxma-approval.ts", enabled: false }),
    });
    expect(res.status).toBe(403);
    expect(readDisabledExtensions()).toEqual([]);
  });

  test("PUT enabled 非布尔 → 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/extensions", {
      method: "PUT",
      headers: { ...authHeaderFor(dataDir), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "hello.ts", enabled: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT 合法用户扩展 → 200 并落盘", async () => {
    const app = await makeApp();
    const res = await app.request("/api/extensions", {
      method: "PUT",
      headers: { ...authHeaderFor(dataDir), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "hello.ts", enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(readDisabledExtensions()).toEqual(["hello.ts"]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.disabled).toEqual(["hello.ts"]);
  });
});
