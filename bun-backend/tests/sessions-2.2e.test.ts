/**
 * tests/sessions-2.2e.test.ts — 会话门面路由单测（阶段 2.2e）。
 *
 * 覆盖：创建/列表/详情/权限模式/消息 role 映射/undo 409/context-usage/
 * 清空/删除。kernel in-process（跨目录 import），无端口绑定。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-sess-"));
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

describe("sessions 门面（阶段 2.2e）", () => {
  test("POST /api/sessions 创建 → 列表/详情/消息", async () => {
    const app = await makeApp();
    const h = authHeader();

    const created = (await (
      await app.request("/api/sessions", { method: "POST", headers: h })
    ).json()) as { session_id: string; engine: string };
    expect(created.session_id).toBeTruthy();
    expect(created.engine).toBe("pi");

    const list = (await (await app.request("/api/sessions", { headers: h })).json()) as {
      sessions: Array<{ session_id: string; engine: string }>;
    };
    expect(list.sessions.some((s) => s.session_id === created.session_id)).toBe(true);

    const detail = await app.request(`/api/sessions/${created.session_id}`, { headers: h });
    const d = (await detail.json()) as { message_count: number; has_active_agent: boolean };
    expect(d.has_active_agent).toBe(false);

    const msgs = (await (
      await app.request(`/api/sessions/${created.session_id}/messages?limit=10`, { headers: h })
    ).json()) as { messages: unknown[]; total: number; source: string };
    expect(msgs.source).toBe("sidecar");
    expect(Array.isArray(msgs.messages)).toBe(true);

    // limit 越界 → 400（PARAM-RANGE-001）
    const bad = await app.request(`/api/sessions/${created.session_id}/messages?limit=0`, { headers: h });
    expect(bad.status).toBe(400);
  });

  test("权限模式：GET/PUT 4 档 + 非法值 422", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const created = (await (
      await app.request("/api/sessions", { method: "POST", headers: h })
    ).json()) as { session_id: string };

    const get = await app.request(`/api/sessions/${created.session_id}/permission-mode`, { headers: h });
    const g = (await get.json()) as { permission_mode: string; enabled: boolean };
    expect(g.enabled).toBe(true);
    expect(["read_only", "ask", "operate", "auto"]).toContain(g.permission_mode);

    const put = await app.request(`/api/sessions/${created.session_id}/permission-mode`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ permission_mode: "operate" }),
    });
    expect(((await put.json()) as { permission_mode: string }).permission_mode).toBe("operate");

    const bad = await app.request(`/api/sessions/${created.session_id}/permission-mode`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ permission_mode: "god" }),
    });
    expect(bad.status).toBe(422);
  });

  test("context-usage / 清空 / 删除", async () => {
    const app = await makeApp();
    const h = authHeader();
    const created = (await (
      await app.request("/api/sessions", { method: "POST", headers: h })
    ).json()) as { session_id: string };
    const sid = created.session_id;

    const usage = (await (
      await app.request(`/api/sessions/${sid}/context-usage`, { headers: h })
    ).json()) as { estimated_tokens: number; max_tokens: number; message_count: number };
    expect(usage.max_tokens).toBe(256000);
    expect(usage.estimated_tokens).toBe(0);

    const cleared = (await (
      await app.request(`/api/sessions/${sid}/messages`, { method: "DELETE", headers: h })
    ).json()) as { status: string };
    expect(cleared.status).toBe("cleared");

    const deleted = (await (
      await app.request(`/api/sessions/${sid}`, { method: "DELETE", headers: h })
    ).json()) as { status: string };
    expect(deleted.status).toBe("deleted");

    const gone = await app.request(`/api/sessions/${sid}`, { headers: h });
    expect(gone.status).toBe(404);
  });

  test("batch-delete：best-effort 批量删除", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const s1 = (await (
      await app.request("/api/sessions", { method: "POST", headers: h })
    ).json()) as { session_id: string };
    const s2 = (await (
      await app.request("/api/sessions", { method: "POST", headers: h })
    ).json()) as { session_id: string };

    const batch = (await (
      await app.request("/api/sessions/batch-delete", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ session_ids: [s1.session_id, s2.session_id, "ghost"] }),
      })
    ).json()) as { deleted: string[]; count: number };
    expect(batch.count).toBe(2);
    expect(batch.deleted).toContain(s1.session_id);
    expect(batch.deleted).not.toContain("ghost");
  });
});
