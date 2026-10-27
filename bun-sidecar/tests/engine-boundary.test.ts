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
  MAXMA_COMPACTION_REASONS_WS,
  MAXMA_CUSTOM_TOOLS,
  MAXMA_GOAL_STATUSES_ENGINE,
  MAXMA_GOAL_STATUSES_WS_SUPERSET,
  MAXMA_SETTINGS_KEYS,
  PI_BUILTIN_TOOLS,
  MAXMA_ENABLED_DEFAULT_TOOLS,
  PI_PACKAGES,
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
    // 后端自己合成的事件不参与"引擎生产者"对账
    const backendSynthesized = new Set<string>();
    const chatWs = read("bun-backend/src/routes/chat-ws.ts");
    for (const m of chatWs.matchAll(/sendEvent\(\s*[\w.]+\s*,\s*\{?\s*type:\s*"([a-z_]+)"/g)) {
      backendSynthesized.add(m[1]!);
    }
    for (const m of chatWs.matchAll(/send\(\s*"([a-z_]+)"/g)) backendSynthesized.add(m[1]!);

    const registeredUnproduced = new Set(ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED.map((e) => e.event));
    const missing: string[] = [];
    for (const event of MAXMA_ENGINE_WS_EVENTS) {
      if (registeredUnproduced.has(event) || backendSynthesized.has(event)) continue;
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
});

describe("跨侧清单一致性（同一件事不许三处各写各的）", () => {
  test("面板 CORE_PATHS 与面板内每个 set/toggle 的键都必须已登记", () => {
    const registered = new Set(MAXMA_SETTINGS_KEYS.map((k) => k.path));
    const view = read("web/src/views/SettingsView.vue");

    // 1) 精确解析 CORE_PATHS 数组本体。不靠"像不像配置键"的启发式：上一版用
    //    首段前缀过滤，`vault.enabled` 因为登记表里没有任何 vault.* 而漏检，
    //    那个洞是靠人手工发现的，不该依赖人。
    const block = view.match(/const CORE_PATHS\s*=\s*\[([\s\S]*?)\]/);
    expect(block, "找不到 CORE_PATHS 数组（面板结构变了请同步本测试）").not.toBeNull();
    // 先剥注释：数组里夹着 `// consumer: "pi"` 这类分组注释，不剥会把引号里的
    // 分类名当成配置键（实测误报过 pi / maxma 两条）。
    const blockBody = block![1]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    const corePaths = [...blockBody.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(corePaths.length, "CORE_PATHS 解析为空，正则失效").toBeGreaterThan(0);
    const unregisteredCore = corePaths.filter((p) => !registered.has(p));
    expect(
      unregisteredCore,
      `CORE_PATHS 里有未登记的键（GET 会跳过、PUT 回 422）：\n  ${unregisteredCore.join("\n  ")}`,
    ).toEqual([]);

    // 2) 面板里实际读写的键：set('a.b', …) / toggle('a.b') / settings['a.b']
    const written = new Set<string>();
    for (const m of view.matchAll(/(?:set|toggle)\(\s*['"]([^'"]+)['"]/g)) written.add(m[1]!);
    for (const m of view.matchAll(/settings\[\s*['"]([^'"]+)['"]\s*\]/g)) written.add(m[1]!);
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
    const view = read("web/src/views/SettingsView.vue");
    const uiLevels = new Set<string>();
    for (const m of view.matchAll(/'?(off|minimal|low|medium|high|xhigh|max)'?\s*:/g)) uiLevels.add(m[1]!);
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

    // 5) 前端测试自己抄了一份"引擎内置工具"清单（web/tests/toolRegistry.spec.ts）。
    //    那份清单**只能等于我方的默认启用集**，不许从记忆里的"7 个"手抄——
    //    本仓的引擎工具数已经从 7 变成 8（powershell 存在但未默认启用），
    //    这类数字一旦漂移，前端断言就会悄悄守着一张过期的名单。
    const webTest = read("web/tests/toolRegistry.spec.ts");
    const webBuiltin = webTest.match(/const PI_BUILTIN_TOOLS\s*=\s*\[([^\]]*)\]/);
    expect(webBuiltin, "web/tests/toolRegistry.spec.ts 里的内置工具清单结构变了，请同步本校验").not.toBeNull();
    const listed = [...webBuiltin![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(
      listed,
      `前端测试的内置工具清单与契约的默认启用集不一致（引擎工具数变化时这里必须同步）`,
    ).toEqual([...MAXMA_ENABLED_DEFAULT_TOOLS]);
  });
});
