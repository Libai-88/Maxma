/**
 * tests/routes-2.2c.test.ts — memory / audit-log 路由单测（阶段 2.2c）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-r22c-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "config", "personas"), { recursive: true });
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

const MEM_YAML = () => path.join(dataDir, "config", "personas", "memory.yaml");

describe("memory 路由（阶段 2.2c）", () => {
  test("投影契约：description/theme/latest_update_time → content/category/updatedAt；_前缀键与过期剔除", async () => {
    fs.writeFileSync(
      MEM_YAML(),
      [
        "mem1:",
        "  description: 用户偏好深色主题",
        "  theme: 偏好",
        '  latest_update_time: "2026-09-01 10:00:00"',
        "  confidence: 0.8",
        "mem2:",
        "  content: 已过期条目",
        "  theme: 事实",
        "  expires_at: \"2020-01-01T00:00:00\"",
        "_maxma_ltm_projection_operations:",
        "  internal: true",
      ].join("\n"),
    );
    const app = await makeApp();
    const res = await app.request("/api/memory", { headers: authHeader() });
    const facts = (await res.json()) as Array<Record<string, unknown>>;
    expect(facts.length).toBe(1); // mem2 过期剔除 + _ 前缀跳过
    expect(facts[0]).toMatchObject({
      id: "mem1",
      content: "用户偏好深色主题",
      category: "偏好",
      confidence: 0.8,
    });
  });

  test("搜索/分类/置信度过滤 + stats", async () => {
    fs.writeFileSync(
      MEM_YAML(),
      [
        "m1:",
        "  description: 喜欢简洁回复",
        "  theme: 偏好",
        '  latest_update_time: "2026-09-01 10:00:00"',
        "m2:",
        "  description: 使用 Windows",
        "  theme: 事实",
        '  latest_update_time: "2026-09-02 10:00:00"',
      ].join("\n"),
    );
    const app = await makeApp();

    const searched = (await (
      await app.request("/api/memory?q=简洁", { headers: authHeader() })
    ).json()) as Array<{ id: string }>;
    expect(searched.map((f) => f.id)).toEqual(["m1"]);

    const byCat = (await (
      await app.request("/api/memory?category=事实", { headers: authHeader() })
    ).json()) as Array<{ id: string }>;
    expect(byCat.map((f) => f.id)).toEqual(["m2"]);

    const stats = (await (await app.request("/api/memory/stats", { headers: authHeader() })).json()) as {
      total: number;
      categories: Record<string, number>;
      avg_confidence: number;
    };
    expect(stats.total).toBe(2);
    expect(stats.categories).toEqual({ 偏好: 1, 事实: 1 });
    expect(stats.avg_confidence).toBe(1);
  });

  test("PUT 更新 + DELETE 删除 + 404", async () => {
    fs.writeFileSync(
      MEM_YAML(),
      ["m1:", "  description: 原内容", "  theme: 事实", '  latest_update_time: "2026-09-01 10:00:00"'].join("\n"),
    );
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const updated = await app.request("/api/memory/m1", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ content: "新内容", category: "偏好" }),
    });
    expect(((await updated.json()) as { status: string }).status).toBe("updated");

    // 落盘验证（YAML 内容已被改写）
    const onDisk = Bun.YAML.parse(fs.readFileSync(MEM_YAML(), "utf8")) as Record<string, { description: string; theme: string }>;
    expect(onDisk.m1!.description).toBe("新内容");
    expect(onDisk.m1!.theme).toBe("偏好");

    const deleted = await app.request("/api/memory/m1", { method: "DELETE", headers: authHeader() });
    expect(((await deleted.json()) as { status: string }).status).toBe("deleted");

    const missing = await app.request("/api/memory/m1", { method: "DELETE", headers: authHeader() });
    expect(missing.status).toBe(404);
  });
});

describe("audit-log 路由（阶段 2.2c）", () => {
  const PRESET = [
    { timestamp: "2026-09-30T10:00:00+0800", epoch: 1790752800, type: "file_op", target: "t0", detail: "", data_size: 0, status: "ok" },
    { timestamp: "2026-09-30T11:00:00+0800", epoch: 1790756400, type: "file_op", target: "t1", detail: "", data_size: 0, status: "ok" },
    { timestamp: "2026-09-30T12:00:00+0800", epoch: 1790760000, type: "settings", target: "t2", detail: "", data_size: 0, status: "ok" },
  ];

  function preset(): void {
    fs.writeFileSync(path.join(dataDir, "api", "data", "audit_log.json"), JSON.stringify(PRESET, null, 2));
  }

  test("append → limit/倒序/event_type 过滤 → stats → clear", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    preset();

    const appended = (await (
      await app.request("/api/audit-log/append", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ type: "file_op", target: "t3", status: "ok" }),
      })
    ).json()) as { ok: boolean; record: { timestamp: string; epoch: number } };
    expect(appended.ok).toBe(true);
    expect(appended.record.epoch).toBeGreaterThan(0);

    const list = (await (await app.request("/api/audit-log?limit=2", { headers: authHeader() })).json()) as {
      records: Array<{ timestamp: string }>;
    };
    expect(list.records.length).toBe(2);
    // 倒序：最新在前（append 的时间戳必然晚于预置）
    expect(list.records[0]!.timestamp >= list.records[1]!.timestamp).toBe(true);

    const filtered = (await (
      await app.request("/api/audit-log?event_type=file_op", { headers: authHeader() })
    ).json()) as { records: Array<{ type: string }> };
    expect(filtered.records.every((r) => r.type === "file_op")).toBe(true);

    const stats = (await (await app.request("/api/audit-log/stats", { headers: authHeader() })).json()) as {
      stats: { total: number; by_type: Record<string, number>; top_targets: Array<{ target: string }> };
    };
    expect(stats.stats.total).toBe(4);
    expect(stats.stats.by_type.file_op).toBe(3);
    expect(stats.stats.top_targets.length).toBeGreaterThan(0);

    const cleared = (await (await app.request("/api/audit-log/clear", { method: "POST", headers: h })).json()) as {
      status: string;
      deleted: number;
    };
    expect(cleared.deleted).toBe(4);
    const after = (await (await app.request("/api/audit-log", { headers: authHeader() })).json()) as {
      records: unknown[];
    };
    expect(after.records).toEqual([]);
  });
});
