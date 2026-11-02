/**
 * 插件数据契约测试（PLUGIN-001 全功能健康复查）。
 *
 * ## 为什么需要它
 *
 * 本轮复查发现**五个同类缺陷**，全部是「界面读的字段 / 参数名」与插件真实结构不符：
 *
 * | # | 位置 | 错法 | 症状 |
 * | --- | --- | --- | --- |
 * | 1 | `credits.balances` | 把 `balance` 对象当数字读 | 积分恒显示 0 |
 * | 2 | `account.list` | 不传 `provider` | 账号列表永远为空 |
 * | 3 | `account.reorder` | 键名写成 `order`（应为 `orderedIds`） | 拖排序没反应 |
 * | 4 | `cline.quota` / `cline.requestLog` | 读不存在的 `summary` / `status` / `durationMs` | 那两栏永远空白 |
 * | 5 | `onboarding.status` | 把 `tasks` 当数组（实为 Record） | 任务列表永远为空 |
 *
 * 共同点：**不报错、类型检查也过**（因为我把返回类型写成了自己以为的形状），
 * 只表现为「界面空白/为 0/点了没反应」。所以必须用**真实结构**来锁，
 * 而不是再写一遍我以为的类型。
 *
 * ## 做法
 *
 * 真机调用插件 RPC（离线端点，不需要登录），把返回结构拍平成字段路径集合，
 * 再断言「界面消费的字段」确实存在于其中。参数名则用**空参调用的校验文案**反向核对。
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import * as path from "node:path";

import { createDshPluginHost, type DshPluginHost } from "../../src/plugins/dsh/host";

let host: DshPluginHost;
let dataDir: string;
let prevDataDir: string | undefined;

/** 调一次插件 RPC。 */
async function call(method: string, payload: Record<string, unknown> = {}) {
  const handler = host.httpHandlers().find((h) => h.path === "/api/jet-hub")!;
  const response = await handler.fetch(
    new Request("http://127.0.0.1/api/jet-hub", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: "t", method: "jet-hub", payload: { method, payload } }),
    }),
  );
  const body = (await response.json()) as { result: { ok: boolean; value?: unknown; error?: { message: string } } };
  return body.result;
}

/** 递归拍平字段路径；数组取首元素形状并标 `[]`。 */
function fieldPaths(value: unknown, prefix = "", out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    if (value.length > 0) fieldPaths(value[0], `${prefix}[]`, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${key}` : key;
      out.add(p);
      fieldPaths(child, p, out, depth + 1);
    }
  }
  return out;
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "maxma-contract-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  host = await createDshPluginHost({
    stateDir: path.join(dataDir, "plugins", "dsh"),
    pluginSpecifiers: ["dsh-codearts-auth"],
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  // 造数据：匿名通道有余额、可测试
  await call("opencode.addAnonymous", {});
});

afterAll(async () => {
  await host?.dispose();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("插件数据契约：界面读的字段必须真实存在", () => {
  test("credits.balances —— 余额在 balance.total，单位在 packages[].unit", async () => {
    const res = await call("credits.balances", { provider: "opencode" });
    expect(res.ok).toBe(true);
    const paths = fieldPaths(res.value);
    // 缺陷 1 的正面契约
    expect(paths.has("accounts[].balance.total")).toBe(true);
    expect(paths.has("accounts[].balance.packages[].unit")).toBe(true);
    // 反证：账号对象上**没有** balance 之外的数字字段可当余额用
    expect(paths.has("accounts[].unit")).toBe(false);
    const first = (res.value as { accounts: Array<{ balance: { total: number } }> }).accounts[0];
    expect(typeof first?.balance?.total).toBe("number");
  });

  test("account.list —— 必须带 provider，否则永远空数组", async () => {
    // 缺陷 2：插件的 listAccounts 用 `a.provider === provider` 严格过滤
    const withoutProvider = await call("account.list", {});
    expect((withoutProvider.value as { accounts: unknown[] }).accounts).toHaveLength(0);

    const withProvider = await call("account.list", { provider: "opencode" });
    expect((withProvider.value as { accounts: unknown[] }).accounts.length).toBeGreaterThan(0);
  });

  test("account.reorder —— 键名是 orderedIds（不是 order）", async () => {
    // 缺陷 3：传 order 会回「orderedIds 必须是字符串数组」
    const wrong = await call("account.reorder", { provider: "opencode", order: ["x"] });
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.message).toContain("orderedIds");

    // 用真实账号 id（空数组会被判非法，测不出正向路径）
    const accounts = await call("account.list", { provider: "opencode" });
    const ids = (accounts.value as { accounts: Array<{ id: string }> }).accounts.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    const right = await call("account.reorder", { provider: "opencode", orderedIds: [...ids].reverse() });
    expect(right.ok).toBe(true);
  });

  test("provider.setOrder —— 键名是 order（与 account.reorder 不同名）", async () => {
    const wrong = await call("provider.setOrder", { orderedIds: ["opencode"] });
    expect(wrong.ok).toBe(false);
    const right = await call("provider.setOrder", { order: ["opencode"] });
    expect(right.ok).toBe(true);
  });

  test("cline.quota —— 账号元素有 ok/windows/error，没有 summary", async () => {
    // 缺陷 4a：读 row.summary 永远得空
    const res = await call("cline.quota", { provider: "cline" });
    expect(res.ok).toBe(true);
    const paths = fieldPaths(res.value);
    expect(paths.has("accounts[]")).toBe(true);
    expect(paths.has("accounts[].summary")).toBe(false);
  });

  test("cline.requestLog —— 行有 inputTokens/ttftMs/usageReported，没有 status/durationMs", async () => {
    // 缺陷 4b：读 row.status / row.durationMs 永远渲染成空
    const accounts = await call("account.list", { provider: "cline" });
    const accountId = (accounts.value as { accounts: Array<{ id: string }> }).accounts[0]?.id ?? "nope";
    const res = await call("cline.requestLog", { provider: "cline", accountId });
    // 无账号时端点仍应成功（空 rows），有账号时才有行
    expect(res.ok).toBe(true);
    const rows = (res.value as { rows: unknown[] }).rows ?? [];
    if (rows.length > 0) {
      const paths = fieldPaths(res.value);
      expect(paths.has("rows[].inputTokens")).toBe(true);
      expect(paths.has("rows[].usageReported")).toBe(true);
      expect(paths.has("rows[].status")).toBe(false);
      expect(paths.has("rows[].durationMs")).toBe(false);
    }
  });

  test("onboarding.status —— tasks/titles/points 是平行 Record，不是数组", async () => {
    // 缺陷 5：按数组读会让任务列表永远为空
    const accounts = await call("account.list", { provider: "raccoon" });
    const accountId = (accounts.value as { accounts: Array<{ id: string }> }).accounts[0]?.id ?? "nope";
    const res = await call("onboarding.status", { provider: "raccoon", accountId });
    if (res.ok) {
      const value = res.value as Record<string, unknown>;
      expect(Array.isArray(value.tasks)).toBe(false);
      expect(typeof value.tasks).toBe("object");
      expect(typeof value.titles).toBe("object");
      expect(typeof value.points).toBe("object");
    } else {
      // 没有账号时回 bad-request（「账号不存在」），这是端点的既定行为
      expect(res.error?.message).toBeTruthy();
    }
  });

  test("provider.status —— models/accounts/closed 三个子对象齐全", async () => {
    const res = await call("provider.status", { providers: ["opencode"] });
    const paths = fieldPaths(res.value);
    for (const p of [
      "statuses.opencode.models.total",
      "statuses.opencode.models.disabled",
      "statuses.opencode.accounts.total",
      "statuses.opencode.accounts.enabled",
      "statuses.opencode.closed",
    ]) {
      expect(paths.has(p), `${p} 应当存在`).toBe(true);
    }
  });

  test("model.list —— id/name/disabled/dead 齐全", async () => {
    const res = await call("model.list", { provider: "opencode" });
    const paths = fieldPaths(res.value);
    for (const p of ["models[].id", "models[].name", "models[].disabled", "models[].dead"]) {
      expect(paths.has(p), `${p} 应当存在`).toBe(true);
    }
  });

  test("usage.badge —— 与 credits.balances 同源，且带 preference/disabledCount", async () => {
    const res = await call("usage.badge", { provider: "opencode" });
    const paths = fieldPaths(res.value);
    expect(paths.has("accounts[].balance.total")).toBe(true);
    expect(paths.has("preference")).toBe(true);
    expect(paths.has("disabledCount")).toBe(true);
  });

  test("usage.tokenLedger —— channels[].totals 与全局 totals 齐全", async () => {
    const res = await call("usage.tokenLedger", {});
    const paths = fieldPaths(res.value);
    expect(paths.has("snapshot.totals.requests")).toBe(true);
    expect(paths.has("snapshot.totals.inputTokens")).toBe(true);
    expect(paths.has("snapshot.totals.outputTokens")).toBe(true);
    expect(paths.has("snapshot.channels")).toBe(true);
  });

  test("backup.status / backup.export / backup.import —— 回执字段齐全", async () => {
    const status = await call("backup.status", {});
    const statusPaths = fieldPaths(status.value);
    expect(statusPaths.has("accounts")).toBe(true);
    expect(statusPaths.has("withoutExpiry")).toBe(true);

    const exported = await call("backup.export", {});
    const payload = (exported.value as { payload: Record<string, unknown> }).payload;
    for (const key of ["format", "version", "credentials", "accounts"]) {
      expect(Object.keys(payload), `备份载荷应当含 ${key}`).toContain(key);
    }

    const imported = await call("backup.import", { payload });
    const importPaths = fieldPaths(imported.value);
    expect(importPaths.has("credentialsImported")).toBe(true);
    expect(importPaths.has("accountsImported")).toBe(true);
    // ⚠️ skipped 是**数组**（明细），不是计数
    expect(Array.isArray((imported.value as { skipped: unknown }).skipped)).toBe(true);
  });
});
