/**
 * tests/routes-2.2h.test.ts — collab / const-store（deferred-runs 已随子任务方案删除）
 * 单测（阶段 2.2h，2.2 批收尾）。工作流 REST 面已于 2026-11-02 作为死代码整体删除
 * （空 deps 挂载 → sidecar 分支永不可达），本文件只剩它剩下的三条路由链。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { authHeaderFor } from "./_helpers/auth";

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
/** 读 auth token 生成鉴权头（实现见 tests/_helpers/auth.ts，勿再手搓 sqlite 类型桩）。 */
function authHeader(): Record<string, string> {
  return authHeaderFor(dataDir);
}

async function makeSession(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
  const created = (await (
    await app.request("/api/sessions", { method: "POST", headers: authHeader() })
  ).json()) as { session_id: string };
  return created.session_id;
}

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
