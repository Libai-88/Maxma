/**
 * tests/engine-boundary.test.ts — 引擎边界与跨侧一致性回归锁。
 *
 * 与 pi-contract.test.ts 的分工：那边对账"Maxma 向引擎借用的名字是否真实存在"，
 * 这边对账"边界本身有没有被绕开、三侧清单有没有各写各的、依赖树是否可复现"。
 *
 * 本文件的每一条都对应一次已经发生过的事故，不是假想风险：
 *   - 引擎换代后 `deferred_subagent_submitted` 无人发射，前端入口照常渲染 → 空页面；
 *   - `bun-backend/bun.lock` 被 `.gitignore` 的 `*.lock` 通配吞掉 → CI 无锁可冻，
 *     两 workspace 家族包漂出两个版本；
 *   - 面板写 22 个无人消费的键照样返回成功；
 *   - 引擎版本号被展示成 sidecar 的产品版本。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED,
  BACKEND_SYNTHESIZED_EVENTS,
  MAXMA_COMPACTION_ACTION_WS,
  MAXMA_COMPACTION_REASONS_WS,
  MAXMA_CUSTOM_TOOLS,
  MAXMA_CONDITIONAL_TOOLS,
  MAXMA_ENGINE_TOOL_EXTRAS,
  MAXMA_GOAL_STATUSES_ENGINE,
  MAXMA_GOAL_STATUSES_WS_SUPERSET,
  MAXMA_SETTINGS_KEYS,
  PI_BUILTIN_TOOLS,
  MAXMA_ENABLED_DEFAULT_TOOLS,
  PI_PACKAGES,
  PI_ENGINE_VERSION,
  PI_RPC_METHODS,
  PI_THINKING_LEVELS,
  MAXMA_ENGINE_WS_EVENTS,
} from "../src/kernel/pi-contract";

const REPO = path.resolve(import.meta.dir, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel: string): boolean => fs.existsSync(path.join(REPO, rel));

/** 递归收集某目录下的 .ts 文件（相对仓库根；跳过 node_modules / dist）。 */
function tsFiles(dirRel: string): string[] {
  const abs = path.join(REPO, dirRel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  walk(abs);
  return out;
}

/** 只看真实 import 语句，不被注释里的包名骗到。返回相对仓库根的路径。 */
function filesImportingPi(dirRel: string): string[] {
  // m 标志不可少：`^` 若只锚定文件首行，则"第一句不是 pi import"的文件会被整体漏检。
  const re = /^[ \t]*import\s+(?:type\s+)?[\s\S]{0,600}?from\s+["']@earendil-works\//m;
  return tsFiles(dirRel)
    .filter((f) => re.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO, f).replace(/\\/g, "/"));
}

/**
 * 扫出指定目录里**真实会发出去的 WS 事件名**（相对仓库根 → 发射点列表）。
 * 默认整个 `bun-backend/src`；参数是给"机制锁"用的（见下面"发射点扫描必须跨文件"
 * 那条用例），不是可选装饰。
 *
 * 为什么必须**按目录**扫、不能只正则扫 `chat-ws.ts`（旧判据就是这么写的）：后端不只有
 * 一个事件出口。`routes/workflows.ts` 当年经 `server.ts` 注入的 sink 直接广播
 * `workflow_completed`，那份文件对旧判据完全隐形——"事件谁在发"与"清单登记了什么"
 * 之间的差集永远查不到它，`MAXMA_ENGINE_WS_EVENTS` 少登记一条也没人红。
 * 那条死的 REST 工作流面已于 2026-11-02 整体删除（空 deps 挂载 → sidecar 分支永不可达），
 * 现在真实树里只剩 `chat-ws.ts` 一个发射文件。判据不能因此退化成"扫一个文件也算扫"：
 * 跨文件发现能力由**临时 fixture** 现场自证，扫描范围一缩回单文件就红。
 *
 * 认得的发射形状（覆盖后端现存的每一类出口）：
 *   - `send("token", …)` / `sendEvent(sessionId, …)`（chat-ws 的 WS 写封装）
 *   - `hub.broadcast(sessionId, { type: "memory_start", … })`
 *   - `broadcastEvent(sessionId, { type: … })`（server.ts）
 *   - `ws.send(JSON.stringify({ type: "hello", … }))`
 *   - `eventSink(sessionId, EV_XXX, …)`：常量名回查同文件的
 *     `const EV_XXX = "xxx_completed"`（就是当年 `EV_COMPLETED` 那个形状），不猜命名规则。
 *
 * 刻意**不**认的形状：`recordActivity("turn", "turn_start", …)` 的第二个参数是
 * 活动埋点的 `event_type`（`activity-hub.ts`），不进 WS 帧；入站客户端消息类型
 * （`task_review`）也不是服务端事件。旧清单把这两个当成"后端合成事件"登记过，
 * 那是给对账测试开的永不命中的口子。
 */
function backendWsEmittedEvents(dirRel = "bun-backend/src"): Map<string, string[]> {
  const EMITTERS = "send|sendEvent|emit|eventSink|broadcast|broadcastEvent";
  const PATTERNS = [
    // send("token", …) —— 第一个参数就是事件名
    new RegExp(`\\b(?:${EMITTERS})\\s*\\(\\s*"([a-z_]+)"`, "g"),
    // sendEvent(sessionId, "x") / eventSink(sessionId, EV_X, …)
    new RegExp(`\\b(?:${EMITTERS})\\s*\\(\\s*[\\w.]+\\s*,\\s*(?:"([a-z_]+)"|([A-Z][A-Z0-9_$]*)\\s*[,)])`, "g"),
    // broadcast(id, { type: "x" … }) / broadcastEvent(id, { type: "x" … })
    new RegExp(`\\b(?:${EMITTERS})\\s*\\(\\s*[\\w.]+\\s*,\\s*\\{\\s*type\\s*:\\s*"([a-z_]+)"`, "g"),
    // ws.send(JSON.stringify({ type: "hello" … }))
    new RegExp(`\\bws\\s*\\.\\s*send\\s*\\(\\s*(?:JSON\\s*\\.\\s*stringify\\s*\\(\\s*)?\\{\\s*type\\s*:\\s*"([a-z_]+)"`, "g"),
  ];
  const emitted = new Map<string, string[]>();
  for (const abs of tsFiles(dirRel)) {
    const rel = path.relative(REPO, abs).replace(/\\/g, "/");
    const src = fs.readFileSync(abs, "utf8");
    // 事件名常量表：`const EV_COMPLETED = "workflow_completed";`
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_$]*)\s*(?::\s*[^=]+)?=\s*"([a-z_]+)"\s*;/gm)) {
      consts.set(m[1]!, m[2]!);
    }
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const event = m[1] ?? consts.get(m[2] ?? "");
        if (!event) continue; // 大写常量指向的不是字符串字面量事件名
        const at = `${rel}:${src.slice(0, m.index).split("\n").length}`;
        const list = emitted.get(event) ?? [];
        if (!list.includes(at)) list.push(at);
        emitted.set(event, list);
      }
    }
  }
  return emitted;
}

// ─────────────────────────────────────────────────────────────
describe("依赖树可复现性", () => {
  test("两个 workspace 的 pi 直接依赖必须逐包同版本", () => {
    const back = JSON.parse(read("bun-backend/package.json")).dependencies as Record<string, string>;
    const side = JSON.parse(read("bun-sidecar/package.json")).dependencies as Record<string, string>;
    const drift: string[] = [];
    for (const pkg of PI_PACKAGES) {
      if (!back[pkg]) drift.push(`${pkg} 未在 bun-backend/package.json 声明`);
      if (!side[pkg]) drift.push(`${pkg} 未在 bun-sidecar/package.json 声明`);
      if (back[pkg] && side[pkg] && back[pkg] !== side[pkg]) {
        drift.push(`${pkg}: backend=${back[pkg]} / sidecar=${side[pkg]}`);
      }
      if (back[pkg] && /[\^~]/.test(back[pkg])) drift.push(`${pkg} 不是精确锁定：${back[pkg]}`);
      // 声明版本必须等于契约里的 PI_ENGINE_VERSION —— 便携包读不到 pi 的
      // package.json（pi 被内联进 server.js），capabilities 展示的引擎版本
      // 就靠这个常量兜底；它和真实锁定值漂移 = 界面上报假版本。
      if (back[pkg] && back[pkg] !== PI_ENGINE_VERSION) {
        drift.push(`${pkg}: package.json=${back[pkg]} 但 PI_ENGINE_VERSION=${PI_ENGINE_VERSION}`);
      }
    }
    expect(drift, `pi 依赖版本不一致：\n  ${drift.join("\n  ")}`).toEqual([]);
  });

  test("两把 bun.lock 解析出的 @earendil-works/* 版本必须完全一致", () => {
    /**
     * bun.lock 是 **JSONC**（属性名可无引号、允许注释），`JSON.parse` 会直接抛
     * "Property name must be a string literal"。这里只按行取需要的键，不做全量解析。
     * 每条形如：`"@earendil-works/chord": ["@earendil-works/chord@0.99.1", "", {...}, "sha512-…"]`
     */
    const resolveSet = (lockRel: string): Map<string, string> => {
      const map = new Map<string, string>();
      const re = /"(@earendil-works\/[^"]+)"\s*:\s*\[\s*"\1@([^"]+)"/g;
      for (const m of read(lockRel).matchAll(re)) map.set(m[1]!, m[2]!);
      return map;
    };

    const backend = resolveSet("bun-backend/bun.lock");
    const sidecar = resolveSet("bun-sidecar/bun.lock");
    const names = [...new Set([...backend.keys(), ...sidecar.keys()])].sort();
    const drift: string[] = [];
    for (const n of names) {
      const b = backend.get(n);
      const s = sidecar.get(n);
      if (b !== s) drift.push(`${n}: backend=${b ?? "(缺)"} / sidecar=${s ?? "(缺)"}`);
    }
    expect(
      drift,
      `引擎家族包在两 workspace 解析成不同版本——"精确锁定 0.99.0"只对 3 个直接包成立，` +
        `家族包走 ^ 范围时两棵树会各装一套：\n  ${drift.join("\n  ")}`,
    ).toEqual([]);
  });

  test("两把依赖锁都必须被版本控制跟踪（.gitignore 不许吞掉任何一把）", () => {
    const gitignore = read(".gitignore");
    const missing: string[] = [];
    for (const rel of ["bun-sidecar/bun.lock", "bun-backend/bun.lock"]) {
      const negation = `!${rel}`;
      if (!gitignore.split("\n").some((line) => line.trim() === negation)) missing.push(rel);
      if (!exists(rel)) missing.push(`${rel}（文件不存在）`);
    }
    expect(
      missing,
      `依赖锁没被显式白名单收编——*.lock 这条通配的本意是忽略运行时文件锁，` +
        `不是忽略依赖锁。漏一把的后果是 CI 的 --frozen-lockfile 无锁可冻、每次现解析：\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("引擎边界纪律", () => {
  /**
   * kernel 之外直接 import pi 的文件登记表（与 kernel/types.ts:5-9 的纪律配套）。
   * 每一条都必须写清"为什么必须在 kernel 外"，否则就地收进 kernel。
   */
  const PI_IMPORT_ALLOWLIST: Record<string, string> = {
    "bun-backend/src/settings-global.ts":
      "全局设置语义本体就是引擎的 SettingsManager；被 settings/settings-panels/sessions/capabilities 共用。收进 kernel 会让后端反向依赖引擎适配层。",
    "bun-backend/src/plugins/dsh/pi-bridge.ts":
      "把 DSH/Jet Hub 插件的渠道模型翻译成引擎 StreamFunction；是插件↔引擎的专用桥，放 kernel 会把插件依赖带进引擎适配层。",
    "bun-backend/src/plugins/dsh/pi-providers.ts":
      "插件渠道按路由懒注册进引擎 ModelRuntime，同上。",
    "bun-backend/src/plugins/task-brief/index.ts":
      "需求澄清简报直调引擎模型；只用类型 + 一个事件流工厂。",
  };

  test("kernel 之外不得有未登记的 @earendil-works import", () => {
    const found = [
      ...filesImportingPi("bun-backend/src"),
      ...filesImportingPi("bun-sidecar/src").filter((f) => !f.includes("/kernel/")),
      ...filesImportingPi("web/src"),
    ];
    const unregistered = found.filter((f) => !PI_IMPORT_ALLOWLIST[f]);
    expect(
      unregistered,
      `出现未在 kernel 之外登记的文件 import pi（"kernel 是唯一允许 import @earendil-works 的地方"` +
        `这条纪律的例外必须登记理由）：\n  ${unregistered.join("\n  ")}`,
    ).toEqual([]);

    const stale = Object.keys(PI_IMPORT_ALLOWLIST).filter((f) => !found.includes(f));
    expect(
      stale,
      `allowlist 里有已经不存在的文件——清单不许骗人，请删除或重新引入：\n  ${stale.join("\n  ")}`,
    ).toEqual([]);

    // web 层必须彻底不认识引擎：出现任何一条都是解耦失败
    expect(
      filesImportingPi("web/src"),
      "前端出现引擎 import，违反「前端只认 Maxma REST/WS 契约」这条边界",
    ).toEqual([]);
  });

  test("契约声明的引擎事件必须逐个有生产者，或在未生产登记表里有原因（双向）", () => {
    const kernelSrc = tsFiles("bun-sidecar/src/kernel")
      .map((f) => read(path.relative(REPO, f).replace(/\\/g, "/")))
      .join("\n");

    const registeredUnproduced = new Set(ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED.map((e) => e.event));
    const missing: string[] = [];
    for (const event of MAXMA_ENGINE_WS_EVENTS) {
      // 注意：这里**不再**用"后端也发过这个事件"来豁免引擎生产者检查。
      // 旧写法把 `chat-ws.ts` 正则扫出来的名字当作豁免集，而 chat-ws 会原样转发
      // token/answer/done/error/tool_* 等引擎事件——于是 kernel 里删掉某个生产者
      // 也不会红（转发层还在发，只是永远等不到）。清单说"引擎产出"，就只认 kernel。
      if (registeredUnproduced.has(event)) continue;
      if (!kernelSrc.includes(`type: "${event}"`)) missing.push(event);
    }
    expect(
      missing,
      `契约声明为"引擎产出"的事件在 kernel 里没有生产者——就是 Agent 任务中心那种` +
        `"全绿但页面永远空"的形状。要么实现，要么在 ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED 登记原因：\n  ` +
        missing.join("\n  "),
    ).toEqual([]);

    // 反向：登记了"引擎不发"却其实有生产者 → 清单过期
    const staleRegistrations = ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED
      .filter((e) => kernelSrc.includes(`type: "${e.event}"`))
      .map((e) => e.event);
    expect(
      staleRegistrations,
      `这些事件已登记为"引擎不产出"，但 kernel 里现在有生产者，请撤掉登记：\n  ${staleRegistrations.join("\n  ")}`,
    ).toEqual([]);

    // 每条登记必须有原因与处置，不许空转
    for (const entry of ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED) {
      expect(entry.reason, `${entry.event} 的登记缺原因`).toBeTruthy();
      expect(entry.handling, `${entry.event} 的登记缺处置说明`).toBeTruthy();
    }
  });

  test("后端路由发出的每个事件都必须登记归属；登记的合成事件必须真有发射点（双向）", () => {
    // 这条补的是旧判据的**结构性盲区**：`backendSynthesized` 只正则扫 `chat-ws.ts`，
    // 从别的后端路由（当年的 `workflows.ts` 经 server.ts 注入的 sink）发出去的事件
    // 对判据完全隐形——三张清单一张都不在，照样全绿。跨文件发现能力由下一条用例
    // （临时 fixture）自证；这里查的是真实树的三向归属对账。
    const emitted = backendWsEmittedEvents();
    expect(
      [...emitted.keys()].length,
      `只扫到 ${emitted.size} 个后端 WS 发射点——发射形状变了或目录扫空了，` +
        `判据会退化成"什么都不查"，请先修本文件的正则，别删这条检查`,
    ).toBeGreaterThan(10);

    const engine = new Set<string>(MAXMA_ENGINE_WS_EVENTS);
    const synthesized = new Set<string>(BACKEND_SYNTHESIZED_EVENTS);
    const unproduced = new Set(ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED.map((e) => e.event));

    // 1) 发得出 → 必须有归属（三张清单之一）。未登记 = 没人对这个事件负责，
    //    前端接不接、引擎要不要产出、文档说不说，全都没有对账点。
    const homeless = [...emitted.keys()].filter(
      (e) => !engine.has(e) && !synthesized.has(e) && !unproduced.has(e),
    );
    expect(
      homeless,
      `后端在发这些事件，但没有一张清单认领它们（引擎产出 / 后端合成 / 已登记不产出）：\n  ` +
        homeless.map((e) => `${e} ← ${emitted.get(e)!.join(", ")}`).join("\n  "),
    ).toEqual([]);

    // 2) 登记为"后端合成" → 必须查得到发射点。清单不许骗人：
    //    `turn_start` 只是活动埋点的 event_type、`task_review` 是入站消息类型，
    //    两个都不进 WS 下行帧，此前却被登记成后端合成事件（对账测试永远命不中）。
    const phantom = BACKEND_SYNTHESIZED_EVENTS.filter((e) => !emitted.has(e));
    expect(
      phantom,
      `BACKEND_SYNTHESIZED_EVENTS 里这些事件在 bun-backend 查不到任何 WS 发射点，` +
        `请撤掉登记或补上发射方：\n  ${phantom.join("\n  ")}`,
    ).toEqual([]);

    // 3) 归属互斥：说"引擎产出"又说"后端合成"，等于两条对账各查各的、谁都查不住。
    const doubleClaimed = BACKEND_SYNTHESIZED_EVENTS.filter(
      (e) => engine.has(e) || unproduced.has(e),
    );
    expect(
      doubleClaimed,
      `这些事件同时被登记成"后端合成"和"引擎产出/引擎不产出"，归属必须唯一：\n  ` +
        doubleClaimed.join("\n  "),
    ).toEqual([]);

  });

  test("发射点扫描必须跨文件：喂给它一个 chat-ws 之外的路由，照样得看见（机制锁）", () => {
    // 本条替代的是原先"workflow_completed 必须来自 routes/workflows.ts"那条形状锁。
    // 那条死的 REST 工作流面 2026-11-02 整体删除后，真实树里只剩 `chat-ws.ts` 一个
    // 发射文件——继续断言"扫描器看得见某个非 chat-ws 的文件"会退化成空断言
    // （没有主体，怎么改判据都绿）。所以这里自己造主体：把当年那个缺陷的形状
    // （路由文件 + `const EV_*` 常量 + 经注入的 sink 广播）写成临时 fixture，
    // 要求扫描器**跨目录**发现它——扫描面一旦缩回 `chat-ws.ts` 那个单文件，
    // fixture 就扫不出任何东西，本条当场红。再加一个干扰项，锁住"不许把
    // 活动埋点/入站消息也算成 WS 事件"。
    const fixtureRel = `.tmp-boundary-fixture-${process.pid}`;
    const fixtureAbs = path.join(REPO, fixtureRel);
    // 复刻 `routes/workflows.ts` 当年的两类出口形状：
    //   1) 常量名 → 经注入的 sink 发出（`eventSink(sessionId, EV_COMPLETED, …)`）
    //   2) 字面量 → 经 server.ts 的 broadcastEvent 发出
    // 两者都不在 chat-ws.ts 里，正是旧判据漏掉的那一类。
    const files: Record<string, string> = {
      "routes/synthetic-autoruns.ts": [
        'const EV_SYNTH_RUN = "synthetic_run_done";',
        "type Sink = (sid: string, type: string, payload: Record<string, unknown>) => void;",
        "let eventSink: Sink = () => {};",
        'export function setSyntheticSink(sink: Sink): void { eventSink = sink; }',
        "export function finish(sid: string): void {",
        "  eventSink(sid, EV_SYNTH_RUN, {});",
        "}",
      ].join("\n"),
      "routes/synthetic-deferred.ts": [
        'export function emit(sid: string, broadcastEvent: (s: string, e: { type: string }) => void): void {',
        '  broadcastEvent(sid, { type: "synthetic_step_start" });',
        "}",
      ].join("\n"),
      // 干扰项：活动埋点的 event_type 与入站消息类型都不算下行 WS 事件，
      // 扫描器把它们认成事件的话，等于又开一个永不命中的登记口子。
      "routes/synthetic-noise.ts": [
        'import { record as recordActivity } from "../activity-hub";',
        'export function noise(sid: string): void {',
        '  recordActivity("turn", "synthetic_turn_start", { session_id: sid });',
        '}',
      ].join("\n"),
    };
    fs.mkdirSync(path.join(fixtureAbs, "routes"), { recursive: true });
    for (const [rel, src] of Object.entries(files)) {
      fs.writeFileSync(path.join(fixtureAbs, rel), src, "utf8");
    }
    try {
      const found = backendWsEmittedEvents(fixtureRel);
      // 1) 常量回查：`EV_SYNTH_RUN` → "synthetic_run_done"，发射点必须落在那个 fixture 文件
      const runSites = found.get("synthetic_run_done") ?? [];
      expect(
        runSites.some((s) => s.startsWith(`${fixtureRel}/routes/synthetic-autoruns.ts:`)),
        `扫描器看不见注入型 sink 发出的事件（常量名没回查成字符串字面量）——` +
          `这正是当年 workflow_completed 隐形的机制，现扫到：${runSites.join(", ") || "无"}`,
      ).toBe(true);
      // 2) 第二种出口形状（broadcastEvent + 字面量）同样要跨文件看见
      const stepSites = found.get("synthetic_step_start") ?? [];
      expect(
        stepSites.some((s) => s.startsWith(`${fixtureRel}/routes/synthetic-deferred.ts:`)),
        `扫描器看不见 broadcastEvent 字面量发射点，现扫到：${stepSites.join(", ") || "无"}`,
      ).toBe(true);
      // 3) 干扰项不许被当成 WS 事件（否则清单能登记一个永远命不中的事件）
      expect(
        found.has("synthetic_turn_start"),
        "活动埋点的 event_type 被扫成 WS 事件了——那是给对账测试开的空口子",
      ).toBe(false);

      // 4) fixture 的扫描结果必须**恰好**是那两个事件（多一个说明判据开始把
      //    埋点/入站消息也算成 WS 事件，少一个说明发射形状没被认出来）。
      expect(
        [...found.keys()].sort(),
        `fixture 扫出的事件集合不该是：${[...found.keys()].sort().join(", ")}`,
      ).toEqual(["synthetic_run_done", "synthetic_step_start"]);

      // 5) 真实树的发射点必须来自**目录遍历**：每一个所在文件都要在
      //    `tsFiles("bun-backend/src")` 数出来的清单里，而那份清单本身必须是非平凡的。
      //    （把遍历换成写死的 `chat-ws.ts` 时，上面 fixture 那几条先红；
      //    这条兜的是"扫描面被偷偷挪到别的目录"。）
      const scanned = tsFiles("bun-backend/src").map((abs) =>
        path.relative(REPO, abs).replace(/\\/g, "/"),
      );
      expect(scanned.length, `bun-backend/src 只数出 ${scanned.length} 个 .ts——遍历被改窄了`).toBeGreaterThan(20);
      const realFiles = new Set(
        [...backendWsEmittedEvents().values()]
          .flat()
          .map((site) => site.slice(0, site.lastIndexOf(":"))),
      );
      const offList = [...realFiles].filter((f) => !scanned.includes(f));
      expect(
        offList,
        `这些发射点不在目录遍历的清单里，扫描面被动过手脚：\n  ${offList.join("\n  ")}`,
      ).toEqual([]);
    } finally {
      fs.rmSync(fixtureAbs, { recursive: true, force: true });
    }
  });

  test("死的 REST 工作流面已整体移除：不许留下半个表面（干净切换锁）", () => {
    // 2026-11-02 的处置：`routes/workflows.ts`（空 deps 挂载，sidecar 分支永不可达，
    // 只能回报失败）连同 kernel 的 `execute_workflow_step`、四处事件/方法登记、
    // 前端 `types/workflow.ts` 一起删除。这里锁"删干净"——半个删除比不删更坏：
    // 清单里留一条没人产出的事件，就是下一次 Agent 任务中心那种"全绿但永远收不到"。
    expect(exists("bun-backend/src/routes/workflows.ts")).toBe(false);
    expect(exists("web/src/types/workflow.ts")).toBe(false);

    const workflowish = [
      ...MAXMA_ENGINE_WS_EVENTS,
      ...BACKEND_SYNTHESIZED_EVENTS,
      ...PI_RPC_METHODS,
    ].filter((name) => name.includes("workflow"));
    expect(
      workflowish,
      `这些工作流残留还挂在清单上，可生产它的代码已删除：\n  ${workflowish.join("\n  ")}`,
    ).toEqual([]);
    for (const entry of ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED) {
      expect(entry.event, "工作流事件不许改头换面登记成\u201c引擎不产出\u201d").not.toMatch(/workflow/);
    }

    // 两侧源码剥注释后不得再出现工作流标识符（发射点、RPC 分支、前端类型都算）
    const leftovers: string[] = [];
    for (const rel of [
      ...tsFiles("bun-backend/src"),
      ...tsFiles("bun-sidecar/src"),
      ...tsFiles("web/src"),
    ]) {
      const relPath = path.relative(REPO, rel).replace(/\\/g, "/");
      const src = fs
        .readFileSync(rel, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (/workflow/i.test(src)) leftovers.push(relPath);
    }
    expect(
      leftovers,
      `这些地方还留着 workflow 标识符（.github/workflows 属 CI，不在扫描面内）：\n  ${leftovers.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("RPC 方法清单与实现必须一致", () => {
  test("pi-contract 登记的方法 = bridge-pi 实际分支（双向）", () => {
    const bridge = read("bun-sidecar/src/kernel/bridge-pi.ts");
    const implemented = new Set<string>();
    for (const m of bridge.matchAll(/method === "([a-z_]+)"/g)) implemented.add(m[1]!);

    const declaredOnly = PI_RPC_METHODS.filter((m) => !implemented.has(m));
    expect(
      declaredOnly,
      `清单里有 bridge-pi 未实现的方法（dispatcher 会把它说成 Unknown method）：\n  ${declaredOnly.join("\n  ")}`,
    ).toEqual([]);

    const implementedOnly = [...implemented].filter(
      (m) => m !== "create_session" && !(PI_RPC_METHODS as readonly string[]).includes(m),
    );
    expect(
      implementedOnly,
      `bridge-pi 新增了方法却没登记进 PI_RPC_METHODS（session-bridge 的 Session not found 判定会漏）：\n  ${implementedOnly.join("\n  ")}`,
    ).toEqual([]);

    // stdio 入口不得再手抄清单
    const entry = read("bun-sidecar/src/session-bridge.ts");
    expect(entry, "session-bridge.ts 应改用 PI_RPC_METHODS，不要手抄方法表").toContain("PI_RPC_METHODS");

    // provider api 白名单同理：model.ts 必须经 `engineApiNames()` 从契约+引擎版本取，
    // 不得自带一份字面量清单，也不得"新旧名字都收"（后者会让当前引擎接受它不认识
    // 的 api，把一个回落变成用户可见的发送报错）。
    const model = read("bun-sidecar/src/kernel/model.ts");
    expect(model, "model.ts 的 PI_APIS 必须来自 engineApiNames()").toContain("engineApiNames()");
    expect(
      /const PI_APIS = new Set[^\n]*\[\s*"/.test(model),
      "model.ts 又出现了手抄的 api 字面量清单，请改回 engineApiNames()",
    ).toBe(false);
  });

  test("桌面壳注入引擎 env 的地方，必须同时校验注入是否生效", () => {
    /**
     * `PI_CODING_AGENT_DIR` 是 pi 自己按 `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`
     * 拼出来的内部变量名（config.js:432）。壳里写的是**字面量**，上游改命名后
     * 注入会静默失效：便携/桌面包把会话、设置、凭据写进用户主目录，不迁移也不报错。
     * 判据不比字符串——验结果：`/api/health` 的 `engine.agent_dir_inside_expected`
     * 由 `getAgentDir()` 现算（见 kernel/engine-info.ts）。
     * 这条断言防止"以后有人把校验当多余代码删掉"，让注入与校验成对存在。
     */
    const main = read("desktop/electron/main.cjs");
    expect(main, "桌面壳应注入 PI_CODING_AGENT_DIR 以把引擎数据搬进包内").toContain("PI_CODING_AGENT_DIR");
    expect(
      main.includes("agent_dir_inside_expected"),
      "桌面壳注入了 PI_CODING_AGENT_DIR 却没有校验注入是否生效——静默失效时数据会写进用户主目录",
    ).toBe(true);
    expect(main, "校验必须真的在启动路径上被调用").toMatch(/await checkEngineAgentDir\(/);

    // 跨边界读字段最容易出的错：写的人改了键名，读的人还按旧名读，于是永远拿到
    // undefined —— **"校验存在"但永不生效**。本次就发生了两次：
    //   ① desktop 读 agent_dir_inside_expected，而 kernel 当时返回 inside_expected；
    //   ② 把字段改名后，bun-backend/src/server.ts 的两处读取没跟着改，启动自检
    //      再次静默失效（日志里那行 [engine] 干脆不打印）。
    // 只扫桌面壳是不够的（第一次的测试就只扫了它，才漏掉②）。这里改为扫**所有**
    // 消费方：只要文件里出现 "<对象>.<字段>" 且字段名属于本诊断的形状族，
    // 就必须是 kernel 真正产出的键。
    const info = read("bun-sidecar/src/kernel/engine-info.ts");
    const fnBody = info.slice(info.indexOf("export function agentDirDiagnostics"));
    const producedKeys = new Set<string>();
    for (const m of fnBody.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)) producedKeys.add(m[1]!);
    expect(producedKeys.size, "解析不到 agentDirDiagnostics 的返回字段").toBeGreaterThan(2);

    /** 诊断形状族的候选字段名（含历史名）：读到它们就必须是产出键。 */
    const FAMILY = [
      "inside_expected",
      "agent_dir_inside_expected",
      "agent_dir",
      "expected_root",
    ];
    const consumers = [
      "desktop/electron/main.cjs",
      "bun-backend/src/server.ts",
      "bun-backend/src/routes/capabilities.ts",
      "bun-backend/src/health.ts",
    ];
    const ghosts: string[] = [];
    for (const rel of consumers) {
      if (!exists(rel)) continue;
      const text = read(rel);
      for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\.([a-z_]+)\b/g)) {
        const field = m[2]!;
        if (!FAMILY.includes(field)) continue;
        if (!producedKeys.has(field)) ghosts.push(`${rel}: ${m[1]}.${field}`);
      }
    }
    expect(
      [...new Set(ghosts)],
      `这些地方读了 kernel 不产出的字段，校验会静默失效（拿到 undefined）：\n  ${[...new Set(ghosts)].join("\n  ")}`,
    ).toEqual([]);

    // 产物形态下必然为 true 的键，必须至少被一个**在启动路径上**的消费方检查，
    // 否则"注入失效"只写进了响应体、没人报警。
    const serverSrc = read("bun-backend/src/server.ts");
    expect(
      serverSrc.includes("agent_dir_inside_expected"),
      "后端启动自检没读新字段名 —— 注入失效时不会打印任何告警",
    ).toBe(true);
  });
});

describe("跨侧清单一致性（同一件事不许三处各写各的）", () => {
  test("面板 CORE_PATHS 与面板内每个 set/toggle 的键都必须已登记", () => {
    const registered = new Set(MAXMA_SETTINGS_KEYS.map((k) => k.path));
    const view = read("web/src/views/SettingsView.tsx");

    // 前端重写后不再有 CORE_PATHS 清单（旧架构的 4 份副本之一），改为直接对账
    // 面板里**实际读写**的每个键：GET 会跳过未登记键、PUT 回 422，静默丢失。
    // 读取点：set('a.b', …) / toggle('a.b') / settings['a.b'] / num('a.b')
    const written = new Set<string>();
    for (const m of view.matchAll(/(?:set|toggle|num)\(\s*['"]([^'"]+)['"]/g)) written.add(m[1]!);
    for (const m of view.matchAll(/settings\[\s*['"]([^'"]+)['"]\s*\]/g)) written.add(m[1]!);
    for (const m of view.matchAll(/k=\{?["']([a-z][a-zA-Z0-9_.]+)["']/g)) written.add(m[1]!);
    const unregisteredWrites = [...written].filter((p) => p.includes(".") && !registered.has(p));
    expect(
      unregisteredWrites,
      `面板在读写登记表之外的键：\n  ${unregisteredWrites.join("\n  ")}`,
    ).toEqual([]);

    // 3) 后端键全集必须来自登记表，不许再手抄一份
    const backendRoutes = read("bun-backend/src/routes/settings.ts");
    expect(backendRoutes, "settings.ts 必须从登记表取键全集，不再手抄").toContain("MAXMA_SETTINGS_KEYS");

    // 4) 无人消费的键不许留在面板上：拨一下就是 409，等于摆了个坏开关
    const dead = MAXMA_SETTINGS_KEYS.filter((k) => k.consumer === "none" && written.has(k.path));
    expect(
      dead.map((k) => k.path),
      `这些键登记为 consumer:"none"（无实现方）却还在面板上，应删掉开关本身：\n  ${dead
        .map((k) => k.path)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  test("pi 明确有默认值的键不许漏登记（SETTINGS-VIS-001）", () => {
    // 事故形状：`compaction.reserveTokens` / `keepRecentTokens` / `cacheWarming` /
    // `defaultThinkingLevel` / `images.*` 等 pi 真实存在的键，在 Maxma 全仓零引用——
    // 用户想调只能手改 settings.json，而界面上的「上下文管理」只给了个开关。
    //
    // 判据：直接读 pi 的 settings-schema.d.ts（**权威**，不是文档），
    // 取其中带默认值/常用键，逐个要求在登记表里出现。pi 新增一个键而 Maxma 没跟，
    // 这条会红——提醒决定"要不要暴露给用户"，而不是静默缺失。
    const registered = new Set(MAXMA_SETTINGS_KEYS.map((k) => k.path));
    const schema = read("bun-sidecar/node_modules/@earendil-works/pi-coding-agent/dist/core/settings-schema.d.ts");

    // 只锁**面向宿主调优**的键。刻意排除：终端/TUI 专属（theme/tuiMode/terminal.*/
    // fullscreen*/keybindings）、纯显示微调（editorPaddingX/outputPad/…）、
    // 以及 Maxma 自己另有实现路径的（skills/packages/extensions 资源清单）。
    const mustExpose = [
      "compaction.enabled",
      "compaction.reserveTokens",
      "compaction.keepRecentTokens",
      "branchSummary.reserveTokens",
      "branchSummary.skipPrompt",
      "cacheWarming",
      "defaultThinkingLevel",
      "enabledModels",
      "hideThinkingBlock",
      "images.autoResize",
      "images.blockImages",
      "steeringMode",
      "followUpMode",
      "retry.enabled",
      "retry.maxRetries",
      "retry.baseDelayMs",
    ];

    const missingInRegistry = mustExpose.filter((p) => !registered.has(p));
    expect(
      missingInRegistry,
      `这些键在 pi 的 settings-schema 里真实存在，但 Maxma 登记表没有——用户无法调节：\n  ` +
        missingInRegistry.join("\n  "),
    ).toEqual([]);

    // 反向自检：schema 里确实还有这些名字（防 pi 改名后本锁变成空断言）。
    const absentInPi = mustExpose.filter((p) => {
      const leaf = p.split(".").pop()!;
      return !new RegExp(`\\b${leaf}\\b`).test(schema);
    });
    expect(
      absentInPi,
      `pi 的 settings-schema 里已经找不到这些键（可能改名了），请同步登记表与面板：\n  ` +
        absentInPi.join("\n  "),
    ).toEqual([]);
  });

  test("登记表不变量：consumer 与 engineReal 不许自相矛盾，消费者必须真实存在", () => {
    const problems: string[] = [];
    for (const k of MAXMA_SETTINGS_KEYS) {
      if (k.consumer === "pi" && !k.engineReal) {
        problems.push(`${k.path}: consumer=pi 但引擎没有这个键`);
      }
      if (k.consumer !== "none") {
        // note 里提到的仓库内路径必须真实存在（防止编造一个消费者）
        for (const m of k.note.matchAll(/((?:bun-backend|bun-sidecar|web|docs|dev_docs)\/[A-Za-z0-9_./-]+)/g)) {
          if (!exists(m[1]!)) problems.push(`${k.path}: note 指向不存在的文件 ${m[1]}`);
        }
      }
      if (!k.note) problems.push(`${k.path}: 缺依据说明`);
    }
    expect(problems, `设置登记表自相矛盾：\n  ${problems.join("\n  ")}`).toEqual([]);
  });

  test("前端词表必须与契约同源：thinking 档位、compaction reason、goal 状态、工具展示名", () => {
    // 1) thinking level：前端标签表里的档位必须都在引擎档位内
    const view = read("web/src/views/SettingsView.tsx");
    const uiLevels = new Set<string>();
    // 档位表现在是 `{ value: 'off', label: '关闭' }` 的对象数组
    for (const m of view.matchAll(/value:\s*'(off|minimal|low|medium|high|xhigh|max)'/g)) uiLevels.add(m[1]!);
    const unknownLevels = [...uiLevels].filter((l) => !(PI_THINKING_LEVELS as readonly string[]).includes(l));
    expect(unknownLevels, `UI 出现引擎不认识的 thinking 档位：${unknownLevels.join(", ")}`).toEqual([]);

    // 2) compaction reason：前端联合必须等于 WS 契约域
    const types = read("web/src/types/index.ts");
    const m = types.match(/export type CompactionReason = ([^;\n]+)/);
    expect(m, "web 里找不到 CompactionReason 联合类型").not.toBeNull();
    const webReasons = (m![1]!.match(/'[a-z_]+'/g) ?? []).map((s) => s.replace(/'/g, "")).sort();
    expect(
      webReasons,
      `前端 CompactionReason 与契约域不一致（引擎新增 reason 时会在这里露出来）`,
    ).toEqual([...MAXMA_COMPACTION_REASONS_WS].sort());

    // 2b) sidecar 的 payload 类型必须与前端联合逐字相等。
    //     reason 是**派生**的（由 pi-contract.test.ts 锁死派生形状），这里只查结果；
    //     action 是"引擎真实值 + 显式登记的上一代遗留值"的超集，两处各写一份就
    //     会各漂各的（前端按 union 分支渲染文案，sidecar 按 union 收窄实发值）。
    const rpcTypes = read("bun-sidecar/src/rpc-types.ts");
    const sideReason = rpcTypes.match(/type:\s*"context_compressing"[\s\S]*?reason:\s*([^;]+);/);
    expect(sideReason, "sidecar 的 context_compressing.payload.reason 形状变了，请同步本校验").not.toBeNull();
    expect(sideReason![1]!.trim(), "sidecar 的 reason 又不再是派生别名了").toBe("MaxmaCompactionReason");

    const sideAction = rpcTypes.match(/export type MaxmaCompactionAction =([\s\S]*?);/);
    expect(sideAction, "找不到 MaxmaCompactionAction 别名").not.toBeNull();
    const sideActionValues = [
      ...MAXMA_COMPACTION_ACTION_WS,
      ...(sideAction![1]!.match(/"([a-z_-]+)"/g) ?? []).map((s) => s.replace(/"/g, "")),
    ].sort();
    const webAction = types.match(/export type CompactionAction = ([^;\n]+)/);
    expect(webAction, "web 里找不到 CompactionAction 联合类型").not.toBeNull();
    const webActionValues = (webAction![1]!.match(/'[a-z_-]+'/g) ?? []).map((s) => s.replace(/'/g, "")).sort();
    expect(
      webActionValues,
      `前端 CompactionAction 与 sidecar 的 action 取值域不一致（上一代遗留值增减时必须同步两侧）`,
    ).toEqual(sideActionValues);

    // 3) goal 状态：引擎产出的必须是前端域的超集之内。
    //    按 budget-limited 这个前端独有值锚定——文件里还有别的 `status:` 联合，
    //    先命中的可能不是 goal 那一行。
    const chat = read("web/src/stores/chat.ts");
    const goalLine = chat.split("\n").find((l) => l.includes("'budget-limited'"));
    expect(goalLine, "web/src/stores/chat.ts 里找不到 goal status 声明行").toBeTruthy();
    const webGoals = (goalLine!.match(/'[a-z-]+'/g) ?? []).map((s) => s.replace(/'/g, ""));
    const engineOnly = MAXMA_GOAL_STATUSES_ENGINE.filter((s) => !webGoals.includes(s));
    expect(engineOnly, `引擎会发这些 goal 状态，但前端类型没有它：${engineOnly.join(", ")}`).toEqual([]);
    const declaredExtra = MAXMA_GOAL_STATUSES_WS_SUPERSET.filter((s) => !webGoals.includes(s));
    expect(
      declaredExtra,
      `契约登记的前端 goal 状态超集与实际不符：${declaredExtra.join(", ")}`,
    ).toEqual([]);

    // 4) 工具展示名：引擎内置 + Maxma 自定义 + submit_plan 都必须有中文映射
    const display = read("web/src/components/tools/_shared/displayNames.ts");
    const required = [
      ...PI_BUILTIN_TOOLS,
      ...MAXMA_CUSTOM_TOOLS,
      "submit_plan",
    ];
    const unmapped = required.filter((t) => !new RegExp(`['"]?${t}['"]?\\s*:`).test(display));
    expect(
      unmapped,
      `这些当前会被调用的工具在展示字典里没有映射（气泡标题会退回英文）：\n  ${unmapped.join("\n  ")}`,
    ).toEqual([]);

    // 5) 前端测试套件随 React 重写退役（旧断言绑定在已删除的 Vue 组件 DOM 上），
    //    原先「前端测试别手抄内置清单」的对账已无对象。保留真正在乎的不变量：
    //    Maxma 默认启用集必须是引擎内置集的子集（引擎改名/删名时约束仍生效）。
    expect(
      MAXMA_ENABLED_DEFAULT_TOOLS.filter((t) => !(PI_BUILTIN_TOOLS as readonly string[]).includes(t)),
      "默认启用集里出现引擎不认识的工具名",
    ).toEqual([]);
  });

  test("前端标 UNIMPLEMENTED 的事件类型，后端必须真的没有发射点（注释不许与代码相反）", () => {
    // 事故形状：`web/src/types/index.ts` 把 5 个 memory_* 事件标成
    // `UNIMPLEMENTED (B4): 无发射端/无订阅`，而 bun-backend 的 chat-ws.ts 在
    // `finishTurn` 里确实合成并广播了整套事件流，前端 useChat.ts 也在消费。
    // 注释与代码相反比没有注释更糟——接手者据此会把活代码当死代码删掉。
    //
    // 判据：按「`UNIMPLEMENTED` 注释块 + 紧随其后的 `export interface X`」配对，
    // 从**接口体内**取它真正的 `type: '...'` 字面量，再拿去 bun-backend/src 找发射点。
    // 找得到 = 注释过期，红。
    //
    // 为什么必须这么配对（第一版是错的，写在这里防退化）：第一版把注释块里所有
    // snake_case 词当事件名去搜。实测变异——把 MemoryDoneEvent 的注释改回
    // 「无发射端」后测试仍然全绿，因为那条注释里只写了 `MemoryToolStartEvent`
    // 这个**接口名**，而 `memory_done` 这个事件名只出现在接口体的 `type:` 行里。
    // 判据取错了来源，就成了会发绿灯的死检查。
    const webTypes = read("web/src/types/index.ts");
    const claims: Array<{ event: string; iface: string }> = [];
    // 标记必须出现在注释**开头**（约定格式 `/** UNIMPLEMENTED (B4): …`）。
    // 不能全文搜关键词：修好之后我在同一块注释里写了「此前被标成 UNIMPLEMENTED」
    // 的历史说明，全文匹配会把这段自述当成新的谎话（实测红过一次）。
    const pattern = /\/\*\*\s*UNIMPLEMENTED(?:(?!\*\/)[\s\S])*?\*\/\s*export interface (\w+)[^{]*\{([\s\S]*?)\n\}/g;
    for (const m of webTypes.matchAll(pattern)) {
      const iface = m[1]!;
      const body = m[2]!;
      const typeMatch = body.match(/type:\s*['"]([a-z0-9_]+)['"]/);
      if (typeMatch) claims.push({ event: typeMatch[1]!, iface });
    }
    // 自检：当前树里没有 UNIMPLEMENTED 事件类型 → 本锁是空断言，必须红。
    // （这条防的是"判据失效后静默通过"，与本文件其他机制锁同一纪律。）
    const anyUnimplemented = /^\/\*\*\s*UNIMPLEMENTED/m.test(webTypes);

    const backendSrc = tsFiles("bun-backend/src")
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");

    const liars = claims.filter((c) =>
      backendSrc.includes(`type: "${c.event}"`) || backendSrc.includes(`type: '${c.event}'`),
    );
    expect(
      liars.map((c) => `${c.event}（${c.iface}）`),
      "前端把这些事件标成 UNIMPLEMENTED，但后端确实在发它们——注释已过期，请改成事实描述：\n  " +
        liars.map((c) => `${c.event} ← ${c.iface}`).join("\n  "),
    ).toEqual([]);
    if (!anyUnimplemented) {
      // 没有标记时不空转：确认扫描器本身仍能配对（用一条合成样本自证）。
      const sample = "/** UNIMPLEMENTED (X): 无发射端 */\nexport interface Foo {\n  type: 'sample_evt'\n  payload: {}\n}";
      const mm = sample.match(pattern);
      expect(mm, "UNIMPLEMENTED 扫描器无法配对注释与接口，判据已失效").not.toBeNull();
    }
  });

  test("随包分发的 AGENTS.md 只许点名真实存在的工具", () => {
    // 事故形状：`config/personas/AGENTS.md` 随两种便携包分发，整篇却写着
    // `task_tracker` / `call_sub_agent` / `run_python` / `git_status` /
    // `browser_browse` / `tavily_search` / `ask_user_qa` —— 全是上一代引擎的工具，
    // 在 pi 下一个都不存在。它当时还有个更严重的问题：**没有任何代码读它**，
    // 所以这堆错误词汇从不会被校验，也没人发现（迁移时注入代码丢了）。
    //
    // 现在它真的进了系统提示词（persona-prompt.ts），所以必须锁住：
    // 文档里用反引号点名的工具，必须是引擎内置 ∪ Maxma 自定义 ∪ 条件装配之一。
    const doc = read("config/personas/AGENTS.md");
    const known = new Set<string>([
      ...PI_BUILTIN_TOOLS,
      ...MAXMA_CUSTOM_TOOLS,
      ...MAXMA_CONDITIONAL_TOOLS,
      ...MAXMA_ENGINE_TOOL_EXTRAS,
    ]);

    // 只认反引号里的裸标识符（形如 `read` / `submit_plan`），跳过带参数或空格的。
    const mentioned = new Set<string>();
    for (const m of doc.matchAll(/`([a-z][a-z0-9_]{2,})`/g)) mentioned.add(m[1]!);

    // 允许的例外：这些反引号内容是**机制名/路径/格式**，不是工具名。
    const NOT_TOOLS = new Set([
      "location", "description", "name", "skill", "skills", "agents", "maxma",
      "config", "personas", "available_skills", "powershell",
    ]);

    const ghosts = [...mentioned].filter((t) => !known.has(t) && !NOT_TOOLS.has(t));
    expect(
      ghosts,
      "config/personas/AGENTS.md 点名了不存在的工具——它现在真的会进系统提示词，" +
        `模型会照着去调，然后撞墙。真实工具面：${[...known].join(", ")}\n  幽灵工具：\n  ` +
        ghosts.join("\n  "),
    ).toEqual([]);

    // 反向自检：文档必须真的点到几个真实工具，否则上面那条是空断言。
    const realHits = [...mentioned].filter((t) => known.has(t));
    expect(realHits.length, "AGENTS.md 里没有点名任何真实工具，工具面一节可能被删空了").toBeGreaterThan(2);
  });
});
