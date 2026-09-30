/**
 * tests/routes-2.2b.test.ts — 阶段 2.2b 五路由批中的 blocker/settings/transcripts 单测。
 * （files.py 的 /select-file 为 tkinter 桌面对话框，随 Tauri 壳移除不迁移）
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-r22b-"));
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

describe("maxma-blocker 路由", () => {
  test("POST 201 创建标记 + 列表 + DELETE 移除标记（含旧版文件名清理）", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const targetDir = path.join(dataDir, "workspace");
    fs.mkdirSync(targetDir, { recursive: true });

    const created = await app.request("/api/maxma-blocker", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ path: targetDir, description: "保护目录" }),
    });
    expect(created.status).toBe(201);
    expect(fs.existsSync(path.join(targetDir, ".maxma_blocker"))).toBe(true);

    const list = (await (await app.request("/api/maxma-blocker", { headers: authHeader() })).json()) as {
      entries: Array<{ path: string; description: string }>;
    };
    expect(list.entries.length).toBe(1);
    expect(list.entries[0]!.description).toBe("保护目录");

    // 旧版标记文件也在删除时被清理
    fs.writeFileSync(path.join(targetDir, "MaxBlocker"), "");

    const del = await app.request("/api/maxma-blocker/0", { method: "DELETE", headers: authHeader() });
    const body = (await del.json()) as { status: string };
    expect(body.status).toBe("ok");
    expect(fs.existsSync(path.join(targetDir, ".maxma_blocker"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "MaxBlocker"))).toBe(false);
  });

  test("POST 无效目录 → 400；DELETE 越界 → 404", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const bad = await app.request("/api/maxma-blocker", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ path: path.join(dataDir, "no-such-dir") }),
    });
    expect(bad.status).toBe(400);
    const del = await app.request("/api/maxma-blocker/99", { method: "DELETE", headers: authHeader() });
    expect(del.status).toBe(404);
  });

  test("check-path-blocked：父目录锚点命中 + fail-closed（NUL 字节）", async () => {
    const app = await makeApp();
    const parent = path.join(dataDir, "ws");
    const child = path.join(parent, "sub", "file.txt");
    fs.mkdirSync(path.join(parent, "sub"), { recursive: true });
    fs.writeFileSync(path.join(parent, ".maxma_blocker"), "");

    const blocked = (await (
      await app.request(`/api/check-path-blocked?path=${encodeURIComponent(child)}`, { headers: authHeader() })
    ).json()) as { blocked: boolean; blocker_path: string };
    expect(blocked.blocked).toBe(true);
    expect(blocked.blocker_path).toBe(path.resolve(parent));

    const nul = (await (
      await app.request(`/api/check-path-blocked?path=${encodeURIComponent("bad\x00path")}`, { headers: authHeader() })
    ).json()) as { blocked: boolean };
    // fail-closed：NUL 视为存在 blocker
    expect(nul.blocked).toBe(true);

    const clean = path.join(dataDir, "clean.txt");
    fs.writeFileSync(clean, "");
    const free = (await (
      await app.request(`/api/check-path-blocked?path=${encodeURIComponent(clean)}`, { headers: authHeader() })
    ).json()) as { blocked: boolean };
    expect(free.blocked).toBe(false);
  });
});

describe("settings 路由", () => {
  test("GET 核心键（未设键跳过）；PUT 写入后读回", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    // pi Settings 可选键默认 undefined——未知/未设键静默跳过（与 Python 版行为一致）
    const res = await app.request("/api/settings", { headers: authHeader() });
    const settings = (await res.json()) as Record<string, unknown>;
    expect(typeof settings).toBe("object");

    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ path: "compaction.enabled", value: false }),
    });
    expect(((await put.json()) as { ok: boolean }).ok).toBe(true);

    const readBack = await app.request("/api/settings?paths=compaction.enabled", { headers: authHeader() });
    expect(((await readBack.json()) as Record<string, unknown>)["compaction.enabled"]).toBe(false);
  });

  test("PUT 缺 path → 422", async () => {
    const app = await makeApp();
    const put = await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ value: 1 }),
    });
    expect(put.status).toBe(422);
  });
});

describe("transcripts 路由", () => {
  test("列表按类别分组；读取内容；穿越防护 400；未知类别 400；404", async () => {
    const app = await makeApp();
    const h = authHeader();
    const catDir = path.join(dataDir, "transcripts", "autonomy");
    fs.mkdirSync(catDir, { recursive: true });
    fs.writeFileSync(
      path.join(catDir, "run-1.jsonl"),
      JSON.stringify({ role: "user", content: "a" }) + "\n" + JSON.stringify({ role: "assistant", content: "b" }),
    );

    const list = (await (await app.request("/api/transcripts", { headers: h })).json()) as {
      categories: Record<string, Array<{ filename: string }>>;
    };
    expect(list.categories.autonomy?.[0]?.filename).toBe("run-1.jsonl");

    const read = await app.request("/api/transcripts/autonomy/run-1.jsonl", { headers: h });
    const rb = (await read.json()) as { messages: unknown[]; filename: string; category: string };
    expect(rb.messages.length).toBe(2);
    expect(rb.category).toBe("autonomy");

    // 穿越防护
    const traversal = await app.request("/api/transcripts/autonomy/..%2F..%2Fsecret.jsonl", { headers: h });
    expect(traversal.status).toBe(400);
    // 未知类别
    const badCat = await app.request("/api/transcripts/others/f.jsonl", { headers: h });
    expect(badCat.status).toBe(400);
    // 不存在
    const missing = await app.request("/api/transcripts/autonomy/nope.jsonl", { headers: h });
    expect(missing.status).toBe(404);
  });
});
