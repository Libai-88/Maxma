/**
 * tests/rules-2.2.test.ts — rules 路由单测（阶段 2.2 存储批首个）。
 *
 * 契约对照 api/routes/rules.py：6 端点 + source/editable 附加 + 内置保护
 * （403 不可编辑/删除）+ toggle 覆盖文件持久化（RULES-TOGGLE-001）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-rules-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir; // config/rules/ 也指向临时目录
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  // 造共享内置规则 JSON（BUNDLE_DIR 下 config/rules/）
  const rulesDir = path.join(dataDir, "config", "rules");
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(rulesDir, "builtin_rules.json"),
    JSON.stringify([
      { id: "py-type-hints", language: "python", name: "类型提示完整性", description: "d", severity: "warning", pattern: "", enabled: true },
      { id: "ts-strict-null", language: "typescript", name: "严格空检查", description: "d", severity: "error", pattern: "", enabled: true },
    ]),
  );
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
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

describe("rules 路由（阶段 2.2）", () => {
  test("GET /api/rules：内置规则 + source/editable 附加 + language 过滤", async () => {
    const app = await makeApp();
    const res = await app.request("/api/rules", { headers: authHeader() });
    const { rules, total } = (await res.json()) as { rules: Array<Record<string, unknown>>; total: number };
    expect(res.status).toBe(200);
    expect(total).toBe(2);
    expect(rules.every((r) => r.source === "builtin" && r.editable === false)).toBe(true);

    const filtered = await app.request("/api/rules?language=typescript", { headers: authHeader() });
    const f = (await filtered.json()) as { rules: Array<Record<string, unknown>>; total: number };
    expect(f.total).toBe(1);
    expect(f.rules[0]!.id).toBe("ts-strict-null");

    const langs = await (await app.request("/api/rules/languages", { headers: authHeader() })).json();
    expect((langs as { languages: string[] }).languages).toEqual(["python", "typescript"]);
  });

  test("POST 201 创建 + 409 重复；PUT 更新；DELETE", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const created = await app.request("/api/rules", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: "自定义", description: "d", language: "go", severity: "warning", pattern: "p1" }),
    });
    expect(created.status).toBe(201);
    const rule = (await created.json()) as Record<string, unknown>;
    expect(rule.source).toBe("custom");
    expect(rule.editable).toBe(true);
    const ruleId = rule.id as string;

    const dup = await app.request("/api/rules", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ id: ruleId, name: "重复", description: "d", language: "go", severity: "info" }),
    });
    expect(dup.status).toBe(409);

    const updated = await app.request(`/api/rules/${ruleId}`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ severity: "error" }),
    });
    expect(((await updated.json()) as { severity: string }).severity).toBe("error");

    // 持久化验证：user_rules.json 落盘
    expect(fs.existsSync(path.join(dataDir, "api", "data", "user_rules.json"))).toBe(true);

    const del = await app.request(`/api/rules/${ruleId}`, { method: "DELETE", headers: authHeader() });
    expect(((await del.json()) as { status: string }).status).toBe("deleted");
  });

  test("内置规则保护：PUT/DELETE → 403；toggle 走覆盖文件", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const put = await app.request("/api/rules/py-type-hints", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ severity: "error" }),
    });
    expect(put.status).toBe(403);

    const del = await app.request("/api/rules/py-type-hints", { method: "DELETE", headers: h });
    expect(del.status).toBe(403);

    // toggle 内置 → rule_toggles.json 持久化（RULES-TOGGLE-001）
    const toggle = await app.request("/api/rules/py-type-hints/toggle", {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggle.status).toBe(200);
    const toggles = JSON.parse(
      fs.readFileSync(path.join(dataDir, "api", "data", "rule_toggles.json"), "utf8"),
    ) as Record<string, boolean>;
    expect(toggles["py-type-hints"]).toBe(false);

    // toggle 后列表反映禁用状态
    const list = (await (await app.request("/api/rules", { headers: authHeader() })).json()) as {
      rules: Array<Record<string, unknown>>;
    };
    expect(list.rules.find((r) => r.id === "py-type-hints")?.enabled).toBe(false);

    // toggle 自定义规则走 user_rules.json
    const created = await app.request("/api/rules", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: "c1", description: "d", language: "go", severity: "info" }),
    });
    const cid = ((await created.json()) as { id: string }).id;
    const toggled = await app.request(`/api/rules/${cid}/toggle`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ enabled: false }),
    });
    expect(((await toggled.json()) as { enabled: boolean }).enabled).toBe(false);
    const saved = JSON.parse(
      fs.readFileSync(path.join(dataDir, "api", "data", "user_rules.json"), "utf8"),
    ) as Array<{ id: string; enabled: boolean }>;
    expect(saved.find((r) => r.id === cid)?.enabled).toBe(false);
  });

  test("404：不存在的规则", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const put = await app.request("/api/rules/no-such", { method: "PUT", headers: h, body: JSON.stringify({ severity: "error" }) });
    expect(put.status).toBe(404);
    const del = await app.request("/api/rules/no-such", { method: "DELETE", headers: h });
    expect(del.status).toBe(404);
    const toggle = await app.request("/api/rules/no-such/toggle", { method: "PATCH", headers: h, body: JSON.stringify({ enabled: true }) });
    expect(toggle.status).toBe(404);
  });
});
