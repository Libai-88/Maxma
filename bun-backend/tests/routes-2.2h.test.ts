/**
 * tests/routes-2.2h.test.ts — workflows / deferred-runs / collab / const-store
 * 单测（阶段 2.2h，2.2 批收尾）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-r22h-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  // 造一个工作流定义（sleep + log + set_var，全 simple 模式）
  const wfDir = path.join(dataDir, "workflows");
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(
    path.join(wfDir, "demo.yaml"),
    ["name: 演示工作流", "description: 测试用", "version: 1", "steps:", "  - step_id: s1", "    tool: log", "    args:", '      message: "hello"', "  - step_id: s2", "    tool: set_var", "    args:", "      key: k1", "      value: v1"].join("\n"),
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

async function makeSession(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
  const created = (await (
    await app.request("/api/sessions", { method: "POST", headers: authHeader() })
  ).json()) as { session_id: string };
  return created.session_id;
}

describe("workflows（阶段 2.2h）", () => {
  test("定义列表 → 启动 → 轮询至 succeeded → cancel/resume 状态机", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const defs = (await (await app.request("/api/workflows/definitions", { headers: h })).json()) as {
      workflow_ids: string[];
      definitions: Record<string, { name: string; step_count: number }>;
    };
    expect(defs.workflow_ids).toContain("demo");
    expect(defs.definitions.demo.step_count).toBe(2);

    const sid = await makeSession(app);
    const started = (await (
      await app.request(`/api/sessions/${sid}/workflows`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ workflow_id: "demo" }),
      })
    ).json()) as { run_id: string; status: string };
    expect(started.status).toBe("running");

    // 轮询至终态（simple 步骤瞬时完成）
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) {
      final = (await (
        await app.request(`/api/sessions/${sid}/workflows/${started.run_id}`, { headers: h })
      ).json()) as Record<string, unknown>;
      if (final.status === "succeeded") break;
      await Bun.sleep(100);
    }
    expect(final.status).toBe("succeeded");
    const steps = final.steps as Array<{ status: string }>;
    expect(steps.every((s) => s.status === "succeeded")).toBe(true);

    // 对已终态 run cancel → 400
    const cancel = await app.request(`/api/sessions/${sid}/workflows/${started.run_id}/cancel`, {
      method: "POST",
      headers: h,
    });
    expect(cancel.status).toBe(400);

    // resume 非 failed → 400
    const resume = await app.request(`/api/sessions/${sid}/workflows/${started.run_id}/resume`, {
      method: "POST",
      headers: h,
    });
    expect(resume.status).toBe(400);
  });

  test("未知 workflow 404", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const sid = await makeSession(app);
    const res = await app.request(`/api/sessions/${sid}/workflows`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ workflow_id: "no-such" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("deferred-runs（阶段 2.2h）", () => {
  test("manager upsert/list/cancel 终态 409/404", async () => {
    const app = await makeApp();
    const h = authHeader();
    const sid = await makeSession(app);

    // 直接写一条 run（模拟 WS 事件写入）
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    const mgr = getDeferredRunManager();
    mgr.addOrUpdate(sid, { run_id: "r1", status: "running", tool: "research" });

    const list = (await (
      await app.request(`/api/sessions/${sid}/deferred-runs`, { headers: h })
    ).json()) as { runs: Array<{ run_id: string; status: string }> };
    expect(list.runs.length).toBe(1);
    expect(list.runs[0]!.run_id).toBe("r1");

    const single = await app.request(`/api/sessions/${sid}/deferred-runs/r1`, { headers: h });
    expect(single.status).toBe(200);

    const cancelled = (await (
      await app.request(`/api/sessions/${sid}/deferred-runs/r1/cancel`, { method: "POST", headers: h })
    ).json()) as { status: string; cancel_reason: string };
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancel_reason).toBe("cancelled_by_user");

    // 终态再取消 → 409
    const again = await app.request(`/api/sessions/${sid}/deferred-runs/r1/cancel`, { method: "POST", headers: h });
    expect(again.status).toBe(409);

    // 未知 run → 404
    const missing = await app.request(`/api/sessions/${sid}/deferred-runs/nope`, { headers: h });
    expect(missing.status).toBe(404);
  });

  test("浏览器投影：列表不含 task/name/result，单条才返回 result", async () => {
    const app = await makeApp();
    const h = authHeader();
    const sid = await makeSession(app);
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    const mgr = getDeferredRunManager();

    mgr.addOrUpdate(sid, {
      run_id: "secret-1",
      status: "succeeded",
      task: "完整子任务提示词",
      name: "子任务标题",
      result: "最终结果",
      error_message: "失败原因",
    });

    const list = (await (
      await app.request(`/api/sessions/${sid}/deferred-runs`, { headers: h })
    ).json()) as { runs: Array<Record<string, unknown>> };
    const row = list.runs.find((r) => r.run_id === "secret-1")!;
    expect(row.task).toBeUndefined();
    expect(row.name).toBeUndefined();
    expect(row.result).toBeNull();

    const one = (await (
      await app.request(`/api/sessions/${sid}/deferred-runs/secret-1`, { headers: h })
    ).json()) as Record<string, unknown>;
    expect(one.result).toBe("最终结果");
    expect(one.error_message).toBe("失败原因");
    expect(one.task).toBeUndefined();
  });

  test("取消是终态：迟到的 succeeded 事件不会把 cancelled 冲掉", async () => {
    const app = await makeApp();
    await makeSession(app);
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    const mgr = getDeferredRunManager();
    const sid = "sess-sticky-cancel";

    mgr.addOrUpdate(sid, { run_id: "r-sticky", status: "running" });
    mgr.cancelRun(sid, "r-sticky");
    const after = mgr.addOrUpdate(sid, { run_id: "r-sticky", status: "succeeded", result: "late" });
    expect(after.status).toBe("cancelled");
    expect(after.cancel_reason).toBe("cancelled_by_user");
    mgr.deleteSession(sid);
  });

  test("分页：活跃任务永不裁剪，终态按 limit 返回并带 has_more", async () => {
    const app = await makeApp();
    await makeSession(app);
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    const mgr = getDeferredRunManager();
    const sid = "sess-page";

    mgr.addOrUpdate(sid, { run_id: "active", status: "running", created_at: 1 });
    for (let i = 0; i < 3; i += 1) {
      mgr.addOrUpdate(sid, { run_id: `done-${i}`, status: "succeeded", created_at: 100 + i });
    }

    const page = mgr.listPage(sid, 1);
    expect(page.runs.map((r) => r.run_id)).toContain("active");
    expect(page.runs.filter((r) => r.status === "succeeded").length).toBe(1);
    expect(page.hasMore).toBe(true);
    mgr.deleteSession(sid);
  });

  test("超时兜底：过期 running 记录变为 failed/timeout", async () => {
    const app = await makeApp();
    await makeSession(app);
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    const mgr = getDeferredRunManager();
    const sid = "sess-timeout";

    mgr.addOrUpdate(sid, { run_id: "r-timeout", status: "running", deadline_at: 1 });
    const got = mgr.getRun(sid, "r-timeout")!;
    expect(got.status).toBe("failed");
    expect(got.error_code).toBe("timeout");
    mgr.deleteSession(sid);
  });
});

describe("collab（阶段 2.2h）", () => {
  test("分享：创建/列表/访问+计数/撤销 404；快照：创建/列表/删除", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    const sid = await makeSession(app);

    // 分享
    const created = (await (
      await app.request(`/api/sessions/${sid}/shares`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ session_id: sid, access_mode: "read", expires_in_hours: 24 }),
      })
    ).json()) as { share_id: string; password_protected: boolean };
    expect(created.share_id).toBeTruthy();

    const shares = (await (await app.request(`/api/sessions/${sid}/shares`, { headers: h })).json()) as Array<{
      share_id: string;
    }>;
    expect(shares.length).toBe(1);

    // 访问（会话消息为空数组）
    const view = (await (await app.request(`/api/shares/${created.share_id}`, { headers: h })).json()) as {
      share: { access_count: number };
      messages: unknown[];
    };
    expect(Array.isArray(view.messages)).toBe(true);

    const revoked = (await (
      await app.request(`/api/shares/${created.share_id}`, { method: "DELETE", headers: h })
    ).json()) as { ok: boolean };
    expect(revoked.ok).toBe(true);
    const gone = await app.request(`/api/shares/${created.share_id}`, { headers: h });
    expect(gone.status).toBe(404);

    // 快照
    const snap = (await (
      await app.request(`/api/sessions/${sid}/snapshots`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title: "检查点 1" }),
      })
    ).json()) as { snapshot_id: string; turn_count: number };
    expect(snap.snapshot_id).toBeTruthy();

    const snaps = (await (
      await app.request(`/api/sessions/${sid}/snapshots`, { headers: h })
    ).json()) as Array<{ snapshot_id: string }>;
    expect(snaps.length).toBe(1);

    const snapDel = (await (
      await app.request(`/api/snapshots/${snap.snapshot_id}`, { method: "DELETE", headers: h })
    ).json()) as { ok: boolean };
    expect(snapDel.ok).toBe(true);
  });
});

describe("const-session-store（阶段 2.2h）", () => {
  test("save/load/loadAll/delete 往返", async () => {
    const { saveConstSession, loadConstSessionById, loadAllConstSessions, deleteConstSession } =
      await import("../src/const-session-store");
    const sid = "test-const-1";
    saveConstSession(sid, "我的常驻", { foo: "bar" }, [
      { type: "human", content: "你好" },
      { type: "ai", content: "在的" },
    ]);

    const loaded = loadConstSessionById(sid);
    expect(loaded).not.toBeNull();
    expect(loaded!.const_name).toBe("我的常驻");
    expect((loaded!.messages as Array<Record<string, unknown>>).length).toBe(2);

    expect(loadAllConstSessions().length).toBe(1);
    expect(deleteConstSession(sid)).toBe(true);
    expect(loadConstSessionById(sid)).toBeNull();
    expect(deleteConstSession(sid)).toBe(false);
  });
});
