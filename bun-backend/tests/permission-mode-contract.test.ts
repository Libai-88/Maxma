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
 * ## 判据（缺一不可）
 *
 * 1. **响应字段名 = 前端类型声明的字段名**（双向集合相等）。字段名是跨 workspace 的
 *    字符串契约，tsc 看不见：只有把两边的定义放在一起对账才会红。
 * 2. **档位清单单源**：唯一的字面量清单是 `bun-sidecar/src/kernel/pi-contract.ts` 的
 *    `MAXMA_PERMISSION_MODES`，档位类型由它**派生**，`bridge-pi.ts`（RPC 入参校验）
 *    与 `routes/sessions.ts`（REST 返回值）运行时 import 同一份。本条同时是**反副本**
 *    判据：Bun 两侧源码里再出现第二份档位清单（≥3 个档位名的字面量）当场红。
 *    以前这里是"四处各写各的 + 一张四方 diff"，diff 只是止痛药——它证明四份恰好
 *    一致，却不禁止第五份出现，也看不见"新增一档只加在清单里"。
 * 3. **跨不过去的边界靠逐字对账**：`engine-boundary.test.ts` 的纪律是"前端只认
 *    Maxma REST/WS 契约"，`web/src` 不许 import kernel 源码，所以前端仍是副本
 *    （联合类型 + 控件里的 prop 默认值 / 文案表 / modeRank 共四处）。这四处的
 *    档位集合必须与单源清单**双向**相等：前端少一档 = 选项渲染不出来或排序为
 *    undefined；前端多一档 = 用户选得到但 kernel 判非法，PUT 必 422。
 * 4. **审批门按同一份档位分支**：`needsApprovalForMode` 实际比较的档位集合 = 清单
 *    （双向）。清单里新增一档而门里没分支，会落进函数末尾的兜底 `return true`
 *    ——档位名收下了、语义却是"什么都审批"，只有把两边的名字放在一起才看得见。
 * 5. **PUT/create_session 真的按清单生效**（PERM-LIVE-001）：不是"mock 回了个
 *    字符串"，而是 hub 记录的 permissionMode 变了、审批门对同一个工具的判定跟着翻转。
 * 6. **写入方必须自己广播**（PERM-ANNOUNCE-001）：`record.permissionMode` 有两个写入方
 *    （`set_permission_mode` 四档 / WS「自动执行」开关的 `set_auto_approve` 两态），
 *    单写者是 kernel，所以收敛机制只能是"每次写入广播 `permission_mode_updated`"。
 *    判据是行为：真跑 in-process kernel，比对 record 与广播序列（两种顺序都测、
 *    被拒的写入不许出声），再逐字对账事件名/载荷字段名在 kernel、前端类型、
 *    `useChat.ts` 分支三侧一致。以前两侧各存一份本地档位、谁都不通知谁，
 *    「拨完开关选择器显示内核并不在的档位」就是全绿通过的。
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
  handlePiSessionRpc,
  type PiBridgeIo,
  type PiPendingPlan,
  type PiSessionRecord,
} from "../../bun-sidecar/src/kernel/bridge-pi";
import { MAXMA_PERMISSION_MODES } from "../../bun-sidecar/src/kernel/pi-contract";
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

/** 递归收集 .ts/.tsx/.vue（相对仓库根；跳过 node_modules / dist）。 */
function sourceFiles(dirRel: string): string[] {
  const abs = path.join(REPO, dirRel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const rel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".vue")) out.push(rel);
  }
  return out;
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

/** 内核广播出去的事件（sendEvent 出口），用于对账"写了就必须 announce"。 */
interface EmittedEvent {
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
}

/** 后端 hub + 路由 + 一个真实 pi 会话（in-memory，不落盘）。 */
async function makeHub(
  permissionMode?: string,
): Promise<{
  app: Hono;
  sessions: Map<string, PiSessionRecord>;
  sid: string;
  events: EmittedEvent[];
  callRpc: (method: string, params: Record<string, unknown>) => Promise<void>;
}> {
  const sessions = new Map<string, PiSessionRecord>();
  const pendingPlans = new Map<string, PiPendingPlan>();
  const events: EmittedEvent[] = [];
  const io: PiBridgeIo = {
    send: () => {},
    sendError: () => {},
    sendEvent: (sessionId, event) => {
      events.push({ sessionId, type: event.type, payload: event.payload });
    },
  };
  await handlePiCreateSession(
    { io, sessions, pendingPlans },
    { cwd: import.meta.dir, in_memory: true, permission_mode: permissionMode },
    1,
  );
  const sid = [...sessions.keys()][0]!;
  const app = createSessionsRoutes({
    hub: { io, sessions, pendingPlans },
    version: "test",
  });
  return {
    app,
    sessions,
    sid,
    events,
    callRpc: (method, params) =>
      handlePiSessionRpc({ io, sessions, pendingPlans }, method, sid, { session_id: sid, ...params }, 1),
  };
}

/** 只取档位广播，按顺序给出广播值。 */
function announcedModes(events: EmittedEvent[]): unknown[] {
  return events
    .filter((e) => e.type === "permission_mode_updated")
    .map((e) => e.payload.permission_mode);
}

/** GET /api/sessions/:id/permission-mode 的响应体。 */
async function getPermissionMode(app: Hono, sid: string): Promise<Record<string, unknown>> {
  const res = await app.request(`/api/sessions/${sid}/permission-mode`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const singleSource = [...MAXMA_PERMISSION_MODES];

describe("权限模式 REST 契约（AG-PERM-001 / PERM-LIVE-001）", () => {
  test("GET 响应的字段名与前端类型声明逐字相等（双向）", async () => {
    const { app, sid } = await makeHub();
    const body = await getPermissionMode(app, sid);

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

  test("档位清单单源：Bun 两侧不许存在第二份字面量清单", () => {
    // 1) 单源本身：字面量清单在 pi-contract.ts，且类型由它派生（不是第二个联合）。
    const contract = stripComments(read("bun-sidecar/src/kernel/pi-contract.ts"));
    const decl = contract.match(
      /export const MAXMA_PERMISSION_MODES\s*=\s*\[([^\]]*)\]\s*as const/,
    );
    expect(decl, "pi-contract.ts 里找不到 MAXMA_PERMISSION_MODES 清单").not.toBeNull();
    expect(
      [...decl![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!),
      "运行时 import 的清单与 pi-contract.ts 的字面量不一致",
    ).toEqual(singleSource);
    expect(
      contract,
      "档位类型必须由清单派生（typeof MAXMA_PERMISSION_MODES[number]），否则类型与清单会各漂各的",
    ).toMatch(/export type MaxmaPermissionMode\s*=\s*\(typeof MAXMA_PERMISSION_MODES\)\[number\]/);

    // 2) kernel/types.ts 只许再导出，不许留字面量副本。
    const kernelTypes = stripComments(read("bun-sidecar/src/kernel/types.ts"));
    expect(
      singleSource.filter((mode) => kernelTypes.includes(`"${mode}"`)),
      "kernel/types.ts 里仍有档位字面量——类型应派生自 pi-contract 的清单",
    ).toEqual([]);
    expect(kernelTypes, "kernel/types.ts 必须由 pi-contract 供给档位类型（import + 再导出）").toMatch(
      /import type \{[^}]*\bMaxmaPermissionMode\b[^}]*\} from "\.\/pi-contract"/,
    );
    expect(
      kernelTypes,
      "kernel/types.ts 又自己声明档位类型了——单源在 pi-contract.ts，类型必须由清单派生",
    ).not.toMatch(/export type MaxmaPermissionMode\s*=/);

    // 3) 消费方必须运行时 import 单源（拿不到常量 = 只能再抄一份）。
    const consumers: Record<string, string> = {
      "bun-sidecar/src/kernel/bridge-pi.ts": "RPC 入参校验",
      "bun-backend/src/routes/sessions.ts": "REST 返回值",
    };
    for (const [rel, role] of Object.entries(consumers)) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 丢了 MAXMA_PERMISSION_MODES 的 import（${role} 拿不到单源）`).toMatch(
        /import\s*\{[^}]*\bMAXMA_PERMISSION_MODES\b[^}]*\}\s*from/,
      );
    }

    // 4) 旧的两份本地副本——未导出的 PI_PERMISSION_MODES 与 REST 侧的
    //    AVAILABLE_PERMISSION_MODES——不许以任何形式回来。
    const deadCopies = ["PI_PERMISSION_MODES", "AVAILABLE_PERMISSION_MODES"];
    for (const rel of sourceFiles("bun-sidecar/src").concat(sourceFiles("bun-backend/src"))) {
      const src = stripComments(read(rel));
      for (const name of deadCopies) {
        expect(src, `${rel} 复活了本地档位副本 ${name}`).not.toContain(name);
      }
    }

    // 5) 反副本扫描：Bun 两侧源码里出现 ≥3 个档位名的文件，只许是清单本身和审批门
    //    （门按档位名分支，天然逐个提到）。第五份清单——哪怕只是"临时方便一下"——红。
    const mentioning = sourceFiles("bun-sidecar/src")
      .concat(sourceFiles("bun-backend/src"))
      .filter((rel) => {
        const src = stripComments(read(rel));
        return (
          singleSource.filter((mode) => src.includes(`"${mode}"`)).length >= 3 &&
          !rel.endsWith("pi-contract.ts") &&
          !rel.endsWith("approval-gate.ts")
        );
      });
    expect(
      mentioning,
      `这些文件里有第二份档位清单（改名/增删必须同步单源，见 pi-contract.ts）：${mentioning.join(", ")}`,
    ).toEqual([]);
  });

  test("REST 返回的清单等于单源，顺序即 UI 顺序且非空", async () => {
    const { app, sid } = await makeHub();
    const body = await getPermissionMode(app, sid);
    const modes = body.available_permission_modes as string[];

    // 空清单 = 前端控件恒禁用（原 bug 的形状）。
    expect(modes.length, "清单为空 → 前端控件恒禁用（原 bug 的形状）").toBeGreaterThan(0);
    // 顺序即渲染顺序（限制由强到弱），所以是有序相等而非集合相等。
    expect(modes).toEqual(singleSource);
    expect(body.session_id).toBe(sid);
    expect(body.permission_mode).toBe("ask"); // bridge-pi 的回落默认档
  });

  test("审批门分支的档位集合等于单源清单（双向）", () => {
    const gateSrc = stripComments(read("bun-sidecar/src/kernel/approval-gate.ts"));
    const fn = gateSrc.match(/export function needsApprovalForMode\([\s\S]*?\n\}/);
    expect(fn, "approval-gate.ts 里找不到 needsApprovalForMode（结构变了请同步本测试）").not.toBeNull();
    const branched = [...new Set([...fn![0].matchAll(/mode\s*===\s*"([a-z_]+)"/g)].map((m) => m[1]!))].sort();
    expect(
      branched,
      "审批门实际分支的档位与单源清单不一致：清单里有而门里没分支的档位会落进末尾兜底 return true（名收下、语义全错）",
    ).toEqual([...singleSource].sort());
  });

  test("前端单源清单与内核清单逐字相等，且不许出现第二份副本", () => {
    // 前端不许 import kernel 源码（engine-boundary 纪律），只能是副本——
    // 重写后只剩一份真值：types/session.ts 的联合类型 + PermissionModeControl.tsx
    // 的 MODE_ORDER / MODE_LABELS。任何新增副本都会让下面的反向扫描判红。
    const sessionTypes = stripComments(read("web/src/types/session.ts"));
    const controlSrc = stripComments(read("web/src/components/chat/PermissionModeControl.tsx"));

    const union = unionMembers(sessionTypes, "PermissionMode", "'");
    expect(union, "PermissionMode 联合类型与内核清单不一致").toEqual(singleSource);

    // 顺序即 UI 顺序（限制由强到弱）。
    const orderBlock = controlSrc.match(/MODE_ORDER:\s*PermissionMode\[\]\s*=\s*\[([^\]]*)\]/);
    expect(orderBlock, "PermissionModeControl.tsx 里找不到 MODE_ORDER 清单").not.toBeNull();
    const order = [...orderBlock![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(order, "MODE_ORDER 与内核清单不一致（顺序即 UI 顺序）").toEqual(singleSource);

    // 文案表必须覆盖每一档，缺一档 = 选项渲染空白。
    for (const mode of singleSource) {
      expect(
        new RegExp(`\\b${mode}:\\s*'`).test(controlSrc),
        `MODE_LABELS 缺少 ${mode} 的文案`,
      ).toBe(true);
    }

    // 反第二份真值：src 下除这两个文件外，不许再有包含 ≥3 个档位字面量的数组/映射。
    const allowed = new Set([
      "web/src/types/session.ts",
      "web/src/components/chat/PermissionModeControl.tsx",
    ]);
    const offenders: string[] = [];
    for (const rel of sourceFiles("web/src")) {
      if (allowed.has(rel)) continue;
      const src = stripComments(read(rel));
      const hits = singleSource.filter((mode) => new RegExp(`['"]${mode}['"]`).test(src));
      // 单个档位的比较（如 mode === 'auto'）是消费方，不是副本；≥3 个才算第二份清单。
      if (hits.length >= 3) offenders.push(rel);
    }
    expect(offenders, "前端出现了第二份权限档位清单（必须只留单源）").toEqual([]);
  });

  test("清单里每一档 kernel 都收；清单外的档位被拒绝（REST 与 kernel 不许一侧独知）", async () => {
    for (const mode of singleSource) {
      // create_session 入参：kernel 的校验表就是单源，收不下 = REST 宣称可用而实为回落。
      const created = await makeHub(mode);
      expect(created.sessions.get(created.sid)!.permissionMode, `create_session 丢了 ${mode}`).toBe(mode);
      const body = await getPermissionMode(created.app, created.sid);
      expect(body.permission_mode, `GET 回显与 kernel 记录不一致（${mode}）`).toBe(mode);

      // PUT：非法档位必须 422 而不是静默回落（否则前端显示的和内核跑的是两档）。
      const put = await created.app.request(`/api/sessions/${created.sid}/permission-mode`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission_mode: "god_mode_not_in_list" }),
      });
      expect(put.status, `${mode} 会话上 PUT 清单外档位应当 422`).toBe(422);
      expect(created.sessions.get(created.sid)!.permissionMode).toBe(mode);
    }

    // 清单外的档位走 create_session 只能回落到默认档（ask），不许静默收下非法值。
    const fallback = await makeHub("god_mode_not_in_list");
    expect(fallback.sessions.get(fallback.sid)!.permissionMode).toBe("ask");
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

// ── PERM-ANNOUNCE-001：一个字段两个写入方，写入方必须自己广播 ──────────────
//
// 原缺陷的形状：`record.permissionMode` 被两条 RPC 写（`set_permission_mode` 四档、
// WS「自动执行」开关走的 `set_auto_approve` 两态，后者直接把档位覆盖成 auto/ask），
// 谁写完都不出声。前端「自动执行」开关与权限选择器各自维护本地状态，于是
// 「选 operate → 拨开关 → 内核在 auto，选择器仍显示 operate」这种漂移全绿通过：
// 内核、REST、WS 三条链各自都没错，错的只是没有 feedback 边。
//
// 下面的判据都是**行为**判据：真跑 in-process kernel，看 record 与事件序列是否
// 一致（不是"事件名字符串存在于文件里"）。顺序双向都测，因为两条写入路径的
// 覆盖语义不对称。
describe("档位写入必须广播（PERM-ANNOUNCE-001）", () => {
  test("set_auto_approve → set_permission_mode：record 与广播序列逐个相等", async () => {
    const { sessions, sid, events, callRpc } = await makeHub();
    const record = sessions.get(sid)!;
    const base = events.length; // create_session 期间的其它事件不参与对账

    await callRpc("set_auto_approve", { auto_approve: true });
    expect(record.permissionMode).toBe("auto");
    expect(announcedModes(events.slice(base))).toEqual(["auto"]);

    await callRpc("set_permission_mode", { permission_mode: "operate" });
    expect(record.permissionMode).toBe("operate");
    expect(announcedModes(events.slice(base))).toEqual(["auto", "operate"]);

    // 广播值必须就是 record 当前值——UI 据此渲染，差一个就是"显示内核不在的档位"
    expect(announcedModes(events.slice(base)).at(-1)).toBe(record.permissionMode);
    // 审批门按同一份档位分支：证明广播的是真正生效的那个字段，不是另一份影子状态
    expect(record.approvalGate.needsApproval({ toolName: "write", annotations: { readOnlyHint: false } })).toBe(false);

    await callRpc("set_auto_approve", { auto_approve: false });
    expect(record.permissionMode).toBe("ask");
    expect(announcedModes(events.slice(base))).toEqual(["auto", "operate", "ask"]);
    expect(record.approvalGate.needsApproval({ toolName: "write", annotations: { readOnlyHint: false } })).toBe(true);
  });

  test("反序（先四档后开关）同样相等；两态覆盖四档是 record 的真值而非 UI 猜测", async () => {
    const { sessions, sid, events, callRpc } = await makeHub();
    const record = sessions.get(sid)!;
    const base = events.length;

    await callRpc("set_permission_mode", { permission_mode: "operate" });
    await callRpc("set_auto_approve", { auto_approve: true });
    expect(record.permissionMode, "开关把 operate 覆盖成 auto 是既有语义，但必须让 UI 看得见").toBe("auto");
    expect(announcedModes(events.slice(base))).toEqual(["operate", "auto"]);

    // read_only → 关开关：内核落到 ask，不是留在 read_only 的"看起来没变"
    const other = await makeHub();
    const otherBase = other.events.length;
    await other.callRpc("set_permission_mode", { permission_mode: "read_only" });
    await other.callRpc("set_auto_approve", { auto_approve: false });
    expect(other.sessions.get(other.sid)!.permissionMode).toBe("ask");
    expect(announcedModes(other.events.slice(otherBase))).toEqual(["read_only", "ask"]);
  });

  test("非法档位被拒时一条都不广播；REST PUT 走的也是同一个写入口", async () => {
    const { app, sessions, sid, events, callRpc } = await makeHub();
    const record = sessions.get(sid)!;
    const base = events.length;

    await callRpc("set_permission_mode", { permission_mode: "god_mode_not_in_list" });
    expect(announcedModes(events.slice(base)), "写入失败却广播了，等于教 UI 相信一个没发生的档位")
      .toEqual([]);
    expect(record.permissionMode).toBe("ask");

    // REST PUT：同样必须广播（否则在另一个标签页里改档，本端选择器依旧陈旧）
    const put = await app.request(`/api/sessions/${sid}/permission-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "read_only" }),
    });
    expect(put.status).toBe(200);
    expect(announcedModes(events.slice(base))).toEqual(["read_only"]);

    await app.request(`/api/sessions/${sid}/permission-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permission_mode: "god_mode_not_in_list" }),
    });
    expect(announcedModes(events.slice(base)), "422 之后不该再有第二条广播").toEqual(["read_only"]);

    const res = await app.request(`/api/sessions/${sid}/permission-mode`);
    expect(((await res.json()) as Record<string, unknown>).permission_mode).toBe(record.permissionMode);
  });

  test("事件的载荷字段名三侧逐字一致：kernel 广播、前端类型、前端分支", () => {
    // 这条锁的是"跨边界字符串契约"——字段名 tsc 看不见，两侧各写一份就会各漂各的
    // （`permission_modes_enabled` 那次事故就是这个形状：读的人换了个没人产出的键）。
    const kernelSrc = stripComments(read("bun-sidecar/src/kernel/bridge-pi.ts"));
    const emitter = kernelSrc.match(
      /function writePermissionMode\([\s\S]*?io\.sendEvent\(sessionId,\s*\{\s*type:\s*"([a-z_]+)",\s*payload:\s*\{\s*([a-z_]+):\s*mode\s*\}/u,
    );
    expect(emitter, "bridge-pi.ts 的 writePermissionMode 形状变了（事件名/载荷字段名）").not.toBeNull();
    const [eventName, payloadKey] = [emitter![1]!, emitter![2]!];
    expect(eventName).toBe("permission_mode_updated");
    expect(payloadKey, "载荷字段名必须是 permission_mode（与 REST 视图同名）").toBe("permission_mode");

    // 前端类型：接的是同一个事件名、读的是同一个字段名
    const typesSrc = stripComments(read("web/src/types/index.ts"));
    const feEvent = typesSrc.match(
      /export interface PermissionModeUpdatedEvent \{\s*type: '([a-z_]+)'\s*payload: \{\s*([a-z_]+):/u,
    );
    expect(feEvent, "web/src/types/index.ts 里找不到 PermissionModeUpdatedEvent").not.toBeNull();
    expect(feEvent![1]!, "前端事件名与 kernel 广播的不是同一条").toBe(eventName);
    expect(feEvent![2]!, "前端读的字段名与 kernel 广播的不是同一个").toBe(payloadKey);

    // 清单登记：kernel 是生产者，必须归"引擎产出"，不许混进后端合成表
    const contract = stripComments(read("bun-sidecar/src/kernel/pi-contract.ts"));
    expect(
      (contract.match(/export const MAXMA_ENGINE_WS_EVENTS = \[([\s\S]*?)\] as const/)?.[1] ?? "").includes(
        `"${eventName}"`,
      ),
      `${eventName} 必须登记在 MAXMA_ENGINE_WS_EVENTS（kernel 里真有生产者）`,
    ).toBe(true);
    expect(
      (contract.match(/export const BACKEND_SYNTHESIZED_EVENTS = \[([\s\S]*?)\] as const/)?.[1] ?? "").includes(
        `"${eventName}"`,
      ),
      `${eventName} 由 kernel 产出，不许同时被说成后端合成事件`,
    ).toBe(false);

    // 前端必须有真实分支：登记了却没分支正是 WS-EVENT-SINK-001 的原缺陷
    const useChatSrc = stripComments(read("web/src/hooks/useChat.ts"));
    expect(
      useChatSrc.includes(`'${eventName}'`) &&
        new RegExp(`^\\s{2}${eventName}: true,$`, "m").test(useChatSrc),
      `${eventName} 需在 useChat.ts 有处理分支并登记进 SERVER_EVENT_HANDLER_TYPES`,
    ).toBe(true);
  });

  test("反副本：档位广播不许在后端/前端另建第二份状态真值", () => {
    // 只有 kernel 的 writePermissionMode 能写 record.permissionMode；后端路由/前端
    // 若各自缓存一份"当前档位"并据此判断，就是回到本次漂移的老路。
    const backendSrc = stripComments(read("bun-backend/src/routes/sessions.ts"));
    expect(
      backendSrc,
      "sessions.ts 不许自己写 record.permissionMode——单写者在 kernel，否则广播会漏",
    ).not.toMatch(/record\.permissionMode\s*=/);

    const kernelSrc = stripComments(read("bun-sidecar/src/kernel/bridge-pi.ts"));
    const directWrites = [...kernelSrc.matchAll(/record\.permissionMode\s*=/g)].length;
    expect(directWrites, "record.permissionMode 的赋值只许出现在 writePermissionMode 里").toBe(1);
    expect(kernelSrc).toMatch(/function writePermissionMode\(/);
  });
});
