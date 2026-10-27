/**
 * tests/settings-contract.test.ts — 全局设置读写的真实语义（2026-10-27 重做）。
 *
 * 修的是这样一件事：旧 `PUT /api/settings` 对**任何**字符串路径都
 * `SettingsManager.inMemory().applyOverrides()` 然后回 `{ok:true}`。
 * 后果两层：
 *   1. 键不存在于引擎 settings 树时，applyOverrides 宽容跳过 → 用户拨完"保存成功"，
 *      实际什么都没发生（面板上有 22 个这样的死开关）；
 *   2. 那个单例是 **in-memory**，既不落盘也不进会话 → 真存在的键改了也活不过重启，
 *      且对实际运行无影响。
 *
 * 现在：显式改动落 `api/data/settings_overrides.json`；键必须先在
 * `bun-sidecar/src/kernel/pi-contract.ts` 的 MAXMA_SETTINGS_KEYS 登记；
 * `consumer:"none"` 直接 409 并说明原因；归引擎消费的键经 create_session 下发。
 * 这些行为全部由本文件锁住。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-settings-"));
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
  // 类型桩必须声明 close：否则 finally 里的 db.close() 是 TS2339。
  // （抄自 panels-2.2g.test.ts 的同一段，那里同样漏了——它已在 HEAD 的错误基线里。）
  const { Database } = require("bun:sqlite") as {
    Database: new (p: string, o?: object) => {
      query: (s: string) => { get: () => { token: string } | null };
      close: () => void;
    };
  };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

function overridesPath(): string {
  return path.join(dataDir, "api", "data", "settings_overrides.json");
}

async function putSetting(app: Awaited<ReturnType<typeof makeApp>>, path_: string, value: unknown) {
  return app.request("/api/settings", {
    method: "PUT",
    headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ path: path_, value }),
  });
}

describe("全局设置：显式改动必须落盘并真的生效", () => {
  test("PUT 引擎真实键 → 200 + consumer=pi + 写进覆盖文件", async () => {
    const app = await makeApp();
    const res = await putSetting(app, "compaction.enabled", false);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.consumer).toBe("pi");
    expect(body.engine_real).toBe(true);

    const stored = JSON.parse(fs.readFileSync(overridesPath(), "utf8")) as Record<string, unknown>;
    expect(stored["compaction.enabled"]).toBe(false);
  });

  test("GET 读回显式值；未显式设置的键读引擎默认值", async () => {
    const app = await makeApp();
    await putSetting(app, "retry.maxRetries", 7);
    const res = await app.request("/api/settings?paths=retry.maxRetries,skills.enabled", {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["retry.maxRetries"]).toBe(7);
    // skills.enabled 的既有语义：缺省视为开启（旧配置文件可能没有该节点）
    expect(body["skills.enabled"]).toBe(true);
  });

  test("归引擎消费的显式改动会被下发给新会话（consumer=pi 才算）", async () => {
    const app = await makeApp();
    await putSetting(app, "compaction.enabled", false);
    await putSetting(app, "thinkingBudgets.low", 1200);
    // skills.enabled 是 consumer=maxma：它经 create_session 的 skills_enabled 走，
    // 不属于"引擎 settings"，不该混进来。
    await putSetting(app, "skills.enabled", false);

    const { engineSettingsForNewSession } = await import("../src/settings-global");
    const nested = engineSettingsForNewSession() as Record<string, Record<string, unknown>>;
    expect(nested.compaction?.enabled).toBe(false);
    expect(nested.thinkingBudgets?.low).toBe(1200);
    expect(nested.skills).toBeUndefined();
  });

  test("跨进程可恢复：覆盖文件在，重启后仍读得到（旧实现是纯内存，重启即失忆）", async () => {
    const app = await makeApp();
    await putSetting(app, "steeringMode", "one-at-a-time");
    expect(fs.existsSync(overridesPath())).toBe(true);

    // 模拟"另一个进程"：直接经 settings-global 的读函数取，不经刚才那次写入的内存态。
    const { getSettingValue } = await import("../src/settings-global");
    expect(getSettingValue("steeringMode")).toBe("one-at-a-time");
  });
});

describe("全局设置：不许再假装保存成功", () => {
  test("未登记的键 → 422，且不写文件", async () => {
    const app = await makeApp();
    const res = await putSetting(app, "totally.made.up", true);
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("unregistered");
    expect(String(body.detail)).toContain("pi-contract.ts");
    expect(fs.existsSync(overridesPath())).toBe(false);
  });

  test("登记为 consumer=none 的遗留键 → 409 并带原因，且不写文件", async () => {
    const app = await makeApp();
    const res = await putSetting(app, "compaction.strategy", "handoff");
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("no_consumer");
    // 原因里要说清"这是遗留/无人消费"，用户才知道不是服务坏了
    expect(String(body.detail)).toContain("没有任何实现方");
    expect(fs.existsSync(overridesPath())).toBe(false);
  });

  test("面板遗留键的 GET 不再返回幽灵值", async () => {
    const app = await makeApp();
    const res = await app.request("/api/settings?paths=tools.approvalMode,interruptMode", {
      headers: authHeader(),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["tools.approvalMode"]).toBeUndefined();
    expect(body["interruptMode"]).toBeUndefined();
  });

  test("schema 端点把每一项的归属与可写性讲清楚（前端据此决定摆不摆开关）", async () => {
    const app = await makeApp();
    const res = await app.request("/api/settings/schema", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: Array<Record<string, unknown>> };
    expect(Array.isArray(body.settings)).toBe(true);
    const none = body.settings.filter((s) => s.consumer === "none");
    expect(none.length).toBeGreaterThan(0);
    for (const s of none) {
      expect(s.supported).toBe(false);
      expect(typeof s.reason).toBe("string");
      expect((s.reason as string).length).toBeGreaterThan(0);
    }
    // 不变量：engineReal=false 却 consumer=pi 的项不许存在
    expect(body.settings.filter((s) => s.consumer === "pi" && s.engineReal !== true)).toEqual([]);
  });

  test("缺 path → 422", async () => {
    const app = await makeApp();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { ...authHeader(), "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(422);
  });
});
