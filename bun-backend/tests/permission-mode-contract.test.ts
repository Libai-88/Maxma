/**
 * tests/permission-mode-contract.test.ts — 会话权限模式 REST 契约与实时生效链。
 *
 * ## 这里锁住的是什么事故
 *
 * `routes/sessions.ts` 的 GET/PUT 回的是 `{session_id, permission_mode, enabled}`，
 * 而前端 `SessionPermissionModeControl.vue` 读的是 `permission_modes_enabled`
 * ——全仓没有任何后端生产者产出这个字段。于是 `enabled.value` 恒为 undefined，
 * `updateMode()` 第一行 `if (!enabled.value) return` 把用户的每一次切换静默吞掉：
 * UI 看着能点，点了什么都没发生，而且四处全绿（后端 200、kernel 正常、前端不报错）。
 * 四档本身在 kernel 里一直是真实生效的，断的只有这条 UI 链。
 *
 * ## 三条判据（缺一不可）
 *
 * 1. **响应字段名 = 前端类型声明的字段名**（双向集合相等）。字段名是跨 workspace 的
 *    字符串契约，tsc 看不见：只有把两边的定义放在一起对账才会红。
 * 2. **档位清单四处同源**：kernel 联合类型 / bridge-pi 的 PI_PERMISSION_MODES /
 *    前端 PermissionMode 联合 / REST 实际返回值。新增或改名一档，四处必须一起动。
 * 3. **PUT 真的改变运行中会话的审批行为**（PERM-LIVE-001）：不是"mock 回了个字符串"，
 *    而是 hub 记录的 permissionMode 变了、审批门对同一个工具的判定跟着翻转。
 *
 * 装配方式与 tests/chat-ws-2.3.test.ts 一致：kernel in-process 直调 + 本地 hub Map，
 * 不 import server.ts（那个模块的 hubSessions 是私有的，且 createApp() 会 initializeDatabase()）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hono } from "hono";

import {
  handlePiCreateSession,
  type PiBridgeIo,
  type PiPendingPlan,
  type PiSessionRecord,
} from "../../bun-sidecar/src/kernel/bridge-pi";
import { createSessionsRoutes } from "../src/routes/sessions";
import type { ToolAnnotations } from "../../bun-sidecar/src/kernel/types";

const REPO = path.resolve(import.meta.dir, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

// 会话创建会读人设/贴纸/技能等数据目录内容；不隔离就会碰到仓库根目录的真数据。
let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-perm-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/**
 * 剥掉块注释与 `//` 行注释——沿用 web/tests/agentTasksGating.spec.ts 的做法：
 * 只在注释里提到的字段名不算声明，否则"把契约写进注释"就能骗过这条对账。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 抠出 `export type X = "a" | "b"` 的成员（引号样式由 quote 指定）。 */
function unionMembers(src: string, name: string, quote: "'" | '"'): string[] {
  const decl = src.match(new RegExp(`export type ${name}\\s*=\\s*([^;\\n]+)`));
  expect(decl, `找不到 ${name} 联合类型（结构变了请同步本测试）`).not.toBeNull();
  return [...decl![1]!.matchAll(new RegExp(`${quote}([a-z_]+)${quote}`, "g"))].map((m) => m[1]!);
}

/** 从 web/src/types/session.ts 抠出 SessionPermissionModeResponse 的字段名。 */
function frontendResponseFields(): string[] {
  const src = stripComments(read("web/src/types/session.ts"));
  const block = src.match(/export interface SessionPermissionModeResponse\s*\{([\s\S]*?)\n\}/);
  expect(block, "web/src/types/session.ts 里找不到 SessionPermissionModeResponse").not.toBeNull();
  return [...block![1]!.matchAll(/^\s*([a-z_]+)\??\s*:/gm)].map((m) => m[1]!);
}

/** 后端 hub + 路由 + 一个真实 pi 会话（in-memory，不落盘）。 */
async function makeHub(): Promise<{ app: Hono; sessions: Map<string, PiSessionRecord>; sid: string }> {
  const sessions = new Map<string, PiSessionRecord>();
  const pendingPlans = new Map<string, PiPendingPlan>();
  const io: PiBridgeIo = { send: () => {}, sendError: () => {}, sendEvent: () => {} };
  await handlePiCreateSession(
    { io, sessions, pendingPlans },
    { cwd: import.meta.dir, in_memory: true },
    1,
  );
  const sid = [...sessions.keys()][0]!;
  const app = createSessionsRoutes({
    hub: { io, sessions, pendingPlans },
    version: "test",
  });
  return { app, sessions, sid };
}

describe("权限模式 REST 契约（AG-PERM-001 / PERM-LIVE-001）", () => {
  test("GET 响应的字段名与前端类型声明逐字相等（双向）", async () => {
    const { app, sid } = await makeHub();
    const res = await app.request(`/api/sessions/${sid}/permission-mode`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    const declared = frontendResponseFields();
    expect(declared.length, "前端类型解析为空，正则失效").toBeGreaterThan(0);
    const actual = Object.keys(body).sort();
    // 集合必须严格相等：少一个字段 = 前端读到 undefined（就是 permission_modes_enabled
    // 那个 bug 的形状）；多一个字段 = 前端类型里没有它，契约在撒谎。
    expect(actual).toEqual([...declared].sort());

    // 那个死字段不许以任何形式回来：没有 feature flag，四档恒生效。
    expect(actual).not.toContain("enabled");
    expect(actual).not.toContain("permission_modes_enabled");
  });

  test("GET 的 available_permission_modes 非空且等于 kernel 四档（前端据此判定可交互）", async () => {
    const { app, sid } = await makeHub();
    const body = (await (await app.request(`/api/sessions/${sid}/permission-mode`)).json()) as {
      session_id: string;
      permission_mode: string;
      available_permission_modes: string[];
    };

    expect(body.session_id).toBe(sid);
    expect(body.available_permission_modes.length, "清单为空 → 前端控件恒禁用（原 bug 的形状）").toBeGreaterThan(0);
    expect(body.available_permission_modes).toEqual(
      unionMembers(stripComments(read("bun-sidecar/src/kernel/types.ts")), "MaxmaPermissionMode", '"'),
    );
    expect(body.permission_mode).toBe("ask"); // bridge-pi 的回落默认档
  });

  test("档位清单四处同源：kernel 联合 / bridge-pi 校验表 / 前端联合 / REST 返回", async () => {
    const kernel = unionMembers(stripComments(read("bun-sidecar/src/kernel/types.ts")), "MaxmaPermissionMode", '"');
    expect(kernel, "kernel 联合解析为空").toEqual(["read_only", "ask", "operate", "auto"]);

    // bridge-pi 用它校验 set_permission_mode 入参；不一致就意味着"REST 说可用、kernel 说非法"
    // 或者反过来（用户选了个必 422 的档位）。
    const bridgeSrc = stripComments(read("bun-sidecar/src/kernel/bridge-pi.ts"));
    const bridgeList = bridgeSrc.match(/const PI_PERMISSION_MODES[^=]*=\s*\[([\s\S]*?)\]/);
    expect(bridgeList, "bridge-pi.ts 里找不到 PI_PERMISSION_MODES 清单").not.toBeNull();
    expect([...bridgeList![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!), "bridge-pi 的校验清单与 kernel 联合不一致").toEqual(
      kernel,
    );

    // 前端联合是跨 workspace 的字符串副本，tsc 看不见它漂。
    expect(
      unionMembers(stripComments(read("web/src/types/session.ts")), "PermissionMode", "'"),
      "前端 PermissionMode 联合与 kernel 不一致",
    ).toEqual(kernel);

    // REST 实际返回的也必须是同一份（顺序即 UI 顺序）。
    const { app, sid } = await makeHub();
    const body = (await (await app.request(`/api/sessions/${sid}/permission-mode`)).json()) as {
      available_permission_modes: string[];
    };
    expect(body.available_permission_modes).toEqual(kernel);
  });

  test("PUT 改的是运行中会话的审批行为，不是只回显字符串（PERM-LIVE-001）", async () => {
    const { app, sessions, sid } = await makeHub();
    const record = sessions.get(sid);
    expect(record, "hub 里找不到刚建的会话").not.toBeUndefined();

    // 审批门按闭包读 record.permissionMode —— 这就是"即时生效"的机制本体。
    // 写入类工具（非只读注解）在 ask 档必须触发审批。
    const writeTool: { toolName: string; annotations?: ToolAnnotations } = {
      toolName: "write",
      annotations: { readOnlyHint: false },
    };
    expect(record!.approvalGate.needsApproval(writeTool), "ask 档下写入必须审批").toBe(true);

    const put = await app.request(`/api/sessions/${sid}/permission-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "operate" }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as Record<string, unknown>;
    expect(body.permission_mode).toBe("operate");
    expect(Object.keys(body).sort()).toEqual([...frontendResponseFields()].sort());

    expect(record!.permissionMode, "PUT 之后 hub 记录的档位没变——REST 面是空转").toBe("operate");
    expect(record!.approvalGate.needsApproval(writeTool), "operate 档下写入必须放行").toBe(false);
    // 执行类仍需审批：证明改的是档位语义，不是"一刀切放行"。
    expect(record!.approvalGate.needsApproval({ toolName: "bash", annotations: {} })).toBe(true);

    // 收紧回去也必须立刻生效（同一个会话实例，不是新建）
    const back = await app.request(`/api/sessions/${sid}/permission-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "read_only" }),
    });
    expect(back.status).toBe(200);
    expect(record!.permissionMode).toBe("read_only");
    expect(record!.approvalGate.needsApproval(writeTool)).toBe(true);
  });

  test("PUT 非法档位 422；未知会话 GET/PUT 404", async () => {
    const { app, sid } = await makeHub();

    const bad = await app.request(`/api/sessions/${sid}/permission-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "god" }),
    });
    expect(bad.status).toBe(422);

    const missingPut = await app.request("/api/sessions/deadbeef/permission-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "ask" }),
    });
    expect(missingPut.status).toBe(404);

    const missingGet = await app.request("/api/sessions/deadbeef/permission-mode");
    expect(missingGet.status).toBe(404);
  });
});
