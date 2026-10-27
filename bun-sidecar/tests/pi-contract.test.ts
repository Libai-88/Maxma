/**
 * tests/pi-contract.test.ts — 引擎消费面对账（把已安装的 pi 包当权威源）。
 *
 * ## 为什么不是又一个快照测试
 *
 * `contract-snapshot.test.ts` 喂给映射层的是**手写的合成 pi 事件对象**。pi 若把
 * `message_update` 改名，映射层会静默丢弃全部事件，而那个快照测试照样全绿——
 * 它守的是"我方映射不回归"，守不住"上游还在发这些东西"。
 *
 * 本文件反过来：**以 node_modules 里实际安装的 pi 包为权威**，逐条核对
 * `kernel/pi-contract.ts` 声明的消费面。判据范式对齐
 * `bun-backend/tests/plugins/jet-hub-coverage.test.ts`（从已安装的包里现读方法名做差集，
 * 上游一变即红）——那个范式此前只用在了 DSH 插件上，引擎侧一直裸奔。
 *
 * 类型符号的搜索范围是三个包的全部 d.ts 文本并集，而不是只看根 index：
 * pi-ai 的根面用了 `export * from "./api/lazy.ts"` 这类通配再导出，只看 index 会误报。
 * 代价是"符号从根面移到子路径"这种迁移不会报错——那是可接受的：本测试要逮的是
 * **名字消失**（改名/删除），不是"换了个更合适的入口"。真正的全量编译断裂由
 * CI 里的 `tsc --noEmit` 兜（见 .github/workflows/sidecar.yml）。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  PI_AI_DEEP_EXPORTS,
  PI_AI_TYPE_EXPORTS,
  PI_AI_VALUE_EXPORTS,
  PI_ASSISTANT_SUBEVENTS_CONSUMED,
  PI_BUILTIN_TOOLS,
  MAXMA_ENABLED_DEFAULT_TOOLS,
  PI_CODING_AGENT_TYPE_EXPORTS,
  PI_CODING_AGENT_VALUE_EXPORTS,
  PI_COMPACTION_REASONS_ENGINE,
  MAXMA_COMPACTION_REASONS_WS,
  PI_PACKAGES,
  PI_PROVIDER_APIS,
  PI_PROVIDER_APIS_FORWARD_COMPAT,
  PI_SESSION_EVENTS_CONSUMED,
  PI_THINKING_LEVELS,
  PI_TURN_TERMINAL_EVENT,
  MAXMA_SETTINGS_KEYS,
} from "../src/kernel/pi-contract";

const PI_ROOT = path.resolve(import.meta.dir, "../node_modules/@earendil-works");

function pkgDir(spec: string): string {
  return path.join(PI_ROOT, spec.split("/")[1]!);
}

function readOrNull(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** 一个包 dist 下全部 .d.ts 的文本并集（类型符号的判据范围）。 */
function allTypeText(spec: string): string {
  const dir = path.join(pkgDir(spec), "dist");
  if (!fs.existsSync(dir)) return "";
  const chunks: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".d.ts")) chunks.push(fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return chunks.join("\n");
}

/** 沿 index.d.ts 的相对再导出链收集根面可 import 的符号名。 */
function rootExportedNames(spec: string): Set<string> {
  const names = new Set<string>();
  const entry = path.join(pkgDir(spec), "dist/index.d.ts");
  const seen = new Set<string>();

  const visit = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    // export { A, type B, C as D } [from "..."]
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["'][^"']+["'])?\s*;?/g)) {
      for (const part of m[1]!.split(",")) {
        const n = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()!
          .trim();
        if (n && /^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
      }
    }
    // export const / function / class / interface / type / enum NAME
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]!);
    }
    // export * from "./x" → 递归（只跟相对路径，不进入第三方包）
    for (const m of text.matchAll(/export\s+\*\s+from\s+["'](\.[^"']+)["']/g)) {
      const target = m[1]!;
      const base = path.resolve(path.dirname(file), target.replace(/\.ts$/, ""));
      for (const cand of [`${base}.d.ts`, `${base}.js`]) visit(cand);
    }
  };

  visit(entry);
  return names;
}

/** 解析 `export interface X { ... }` 的字段名（字段声明里不含嵌套花括号，够用）。 */
function interfaceFields(text: string, name: string): Map<string, string> | null {
  const re = new RegExp(`export\\s+interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = text.match(re);
  if (!m) return null;
  const fields = new Map<string, string>();
  for (const line of m[1]!.split("\n")) {
    const f = line.match(/^\s*([A-Za-z_$][\w$]*)\??\s*:\s*(.+);/);
    if (f) fields.set(f[1]!, f[2]!.trim());
  }
  return fields;
}

// ─────────────────────────────────────────────────────────────

describe("pi 契约对账：安装包必须真实提供 Maxma 声明的消费面", () => {
  test("三个 pi 包都已安装且版本可读（两 workspace 一致性由 engine-boundary 守）", () => {
    for (const spec of PI_PACKAGES) {
      const pkgJson = readOrNull(path.join(pkgDir(spec), "package.json"));
      expect(pkgJson, `${spec} 未安装在 bun-sidecar/node_modules`).not.toBeNull();
      expect(JSON.parse(pkgJson!).version, `${spec} 缺 version`).toBeTruthy();
    }
  });

  test("pi-coding-agent 的**值**导出在运行时真实存在", async () => {
    const mod = (await import("@earendil-works/pi-coding-agent")) as Record<string, unknown>;
    const missing = PI_CODING_AGENT_VALUE_EXPORTS.filter((n) => mod[n] === undefined);
    expect(missing, `pi-coding-agent 根面缺少值导出：${missing.join(", ")}`).toEqual([]);
  });

  test("pi-coding-agent 的**类型**导出在包内 d.ts 里存在", () => {
    const text = allTypeText("@earendil-works/pi-coding-agent");
    const missing = PI_CODING_AGENT_TYPE_EXPORTS.filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
    expect(missing, `pi-coding-agent 类型面缺少：${missing.join(", ")}`).toEqual([]);
  });

  test("pi-ai 的值导出在运行时存在，类型导出在 d.ts 里存在", async () => {
    const mod = (await import("@earendil-works/pi-ai")) as Record<string, unknown>;
    const missingValues = PI_AI_VALUE_EXPORTS.filter((n) => mod[n] === undefined);
    expect(missingValues, `pi-ai 根面缺少值导出：${missingValues.join(", ")}`).toEqual([]);

    const text = allTypeText("@earendil-works/pi-ai");
    const missingTypes = PI_AI_TYPE_EXPORTS.filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
    expect(missingTypes, `pi-ai 类型面缺少：${missingTypes.join(", ")}`).toEqual([]);
  });

  test("深子路径 import 的目标文件必须还在", async () => {
    for (const deep of PI_AI_DEEP_EXPORTS) {
      const rel = deep.specifier.replace("@earendil-works/pi-ai/", "");
      const js = path.join(pkgDir("@earendil-works/pi-ai"), "dist", `${rel}.js`);
      expect(fs.existsSync(js), `深 import 目标不存在：${deep.specifier}`).toBe(true);
      const mod = (await import(deep.specifier)) as Record<string, unknown>;
      const missing = deep.values.filter((n) => mod[n] === undefined);
      expect(missing, `${deep.specifier} 缺少：${missing.join(", ")}`).toEqual([]);
    }
  });

  test("被订阅的 pi 事件名必须仍在引擎类型里（改名 = 事件静默全丢）", () => {
    const text =
      allTypeText("@earendil-works/pi-coding-agent") + allTypeText("@earendil-works/pi-agent-core");
    const missing = PI_SESSION_EVENTS_CONSUMED.filter((n) => !text.includes(`"${n}"`));
    expect(missing, `pi 不再声明这些事件，映射层会静默丢事件：${missing.join(", ")}`).toEqual([]);

    expect(text, `终态事件 ${PI_TURN_TERMINAL_EVENT} 必须存在`).toContain(`"${PI_TURN_TERMINAL_EVENT}"`);
  });

  test("message_update 的 assistant 子事件名必须仍在（流式/思考流的命脉）", () => {
    const text = allTypeText("@earendil-works/pi-ai") + allTypeText("@earendil-works/pi-agent-core");
    const missing = PI_ASSISTANT_SUBEVENTS_CONSUMED.filter((n) => !text.includes(`"${n}"`));
    expect(missing, `pi 不再声明这些 assistant 子事件：${missing.join(", ")}`).toEqual([]);
  });

  test("内置工具清单必须与引擎工具工厂**双向**相等；默认启用集必须是其子集", async () => {
    const mod = (await import("@earendil-works/pi-coding-agent")) as Record<string, unknown>;
    const engineTools = Object.keys(mod)
      .filter((k) => /^create.*Tool$/.test(k) && typeof mod[k] === "function")
      .map((k) => k.replace(/^create/, "").replace(/Tool$/, "").toLowerCase())
      .sort();

    expect(
      engineTools,
      `引擎内置工具与清单不一致（新增=清单落后；消失=会话会静默没工具）。\n  引擎: ${engineTools.join(", ")}\n  清单: ${[...PI_BUILTIN_TOOLS].sort().join(", ")}`,
    ).toEqual([...PI_BUILTIN_TOOLS].sort());

    // 默认启用集：与 kernel 实际使用的常量对账（不许两处各写各的）
    const { MAXMA_DEFAULT_PI_TOOLS } = await import("../src/kernel/pi-session");
    const enabled = [...MAXMA_DEFAULT_PI_TOOLS].sort();
    expect(enabled, "pi-session.ts 的默认工具集与契约表不一致").toEqual(
      [...MAXMA_ENABLED_DEFAULT_TOOLS].sort(),
    );
    const notInEngine = enabled.filter((t) => !(PI_BUILTIN_TOOLS as readonly string[]).includes(t));
    expect(notInEngine, `默认启用了引擎没有的工具：${notInEngine.join(", ")}`).toEqual([]);
  });

  test("ThinkingLevel 档位必须与引擎联合类型逐字相等（双向差集）", () => {
    const text = readOrNull(path.join(pkgDir("@earendil-works/pi-agent-core"), "dist/types.d.ts")) ?? "";
    const m = text.match(/export\s+type\s+ThinkingLevel\s*=\s*([^;]+);/);
    expect(m, "pi-agent-core 里找不到 ThinkingLevel 联合类型").not.toBeNull();
    const engine = [...new Set((m![1]!.match(/"(?:[^"]+)"/g) ?? []).map((s) => s.replace(/"/g, "")))];
    const declared = [...PI_THINKING_LEVELS];
    expect(engine.filter((x) => !declared.includes(x)), "pi 新增档位，Maxma 清单落后").toEqual([]);
    expect(declared.filter((x) => !engine.includes(x)), "pi 删除档位，Maxma 清单未收").toEqual([]);
  });

  test("provider api 白名单必须覆盖 pi 的全部 KnownApi（pi 新增即红）", () => {
    const text = readOrNull(path.join(pkgDir("@earendil-works/pi-ai"), "dist/types.d.ts")) ?? "";
    const m = text.match(/export\s+type\s+KnownApi\s*=\s*([^;]+);/);
    expect(m, "pi-ai 里找不到 KnownApi 联合类型").not.toBeNull();
    const literals = [...new Set((m![1]!.match(/"[^"]+"/g) ?? []).map((s) => s.replace(/"/g, "")))];
    const allowed = new Set<string>([...PI_PROVIDER_APIS, ...PI_PROVIDER_APIS_FORWARD_COMPAT]);
    expect(
      literals.filter((x) => !allowed.has(x)),
      `pi 新增了 api，Maxma 白名单未登记（会被判非法 providerType）：${literals
        .filter((x) => !allowed.has(x))
        .join(", ")}`,
    ).toEqual([]);

    // Maxma 侧多出来的名字必须全部登记为前瞻兼容项，不许有"来历不明的白名单条目"。
    const engineSet = new Set(literals);
    const extras = PI_PROVIDER_APIS.filter((x) => !engineSet.has(x));
    expect(
      extras,
      `PI_PROVIDER_APIS 里有引擎不认识的 api，要么移入 PI_PROVIDER_APIS_FORWARD_COMPAT：${extras.join(", ")}`,
    ).toEqual([]);
  });

  test("compaction reason：引擎会发的每一个值都必须在 WS 契约里（否则被钳成 threshold）", () => {
    // 这条直接守的是本次修掉的"手动压缩被误报成阈值触发"那一类缺陷。
    const uncovered = PI_COMPACTION_REASONS_ENGINE.filter(
      (r) => !(MAXMA_COMPACTION_REASONS_WS as readonly string[]).includes(r),
    );
    expect(
      uncovered,
      `pi 会发这些 reason，但 Maxma WS 契约没有它 → 会被钳成 threshold 误报：${uncovered.join(", ")}`,
    ).toEqual([]);

    const text = readOrNull(path.join(pkgDir("@earendil-works/pi-coding-agent"), "dist/core/agent-session.d.ts")) ?? "";
    const m = text.match(/reason\s*:\s*((?:"[^"]+"\s*\|\s*)+"[^"]+")/);
    expect(m, "agent-session.d.ts 里找不到 compaction reason 联合类型").not.toBeNull();
    const engine = [...new Set((m![1]!.match(/"[^"]+"/g) ?? []).map((s) => s.replace(/"/g, "")))];
    expect(engine.sort(), "引擎 reason 词表与清单不符").toEqual([...PI_COMPACTION_REASONS_ENGINE].sort());
  });
});

describe("pi 契约对账：settings 点路径必须与引擎 Settings 类型一致", () => {
  /** 从已安装 pi 的 settings-manager.d.ts 推导"引擎真实存在的点路径"。 */
  function engineSettingPaths(): Set<string> {
    const file = path.join(pkgDir("@earendil-works/pi-coding-agent"), "dist/core/settings-manager.d.ts");
    const text = readOrNull(file);
    expect(text, `找不到 ${file}`).not.toBeNull();
    const settings = interfaceFields(text!, "Settings");
    expect(settings, "解析不到 Settings 接口").not.toBeNull();

    const paths = new Set<string>();
    for (const [key, type] of settings!) {
      paths.add(key);
      // 命名接口 → 展开一层子字段（compaction.enabled / retry.maxRetries ...）
      const named = type.replace(/\?\s*$/, "").match(/^([A-Z][\w$]*)/);
      if (named) {
        const sub = interfaceFields(text!, named[1]!);
        if (sub) for (const sk of sub.keys()) paths.add(`${key}.${sk}`);
      }
      // Record<string, ...> → 任意单级子键都算存在
      if (/^Record<\s*string\s*,/.test(type.replace(/\?\s*$/, ""))) paths.add(`${key}.*`);
    }
    return paths;
  }

  test("MAXMA_SETTINGS_KEYS 的每一条 engineReal 必须与引擎实测一致", () => {
    const real = engineSettingPaths();
    const mismatched = MAXMA_SETTINGS_KEYS.filter((k) => {
      const [head, tail] = k.path.split(".");
      const exists = tail === undefined
        ? real.has(k.path)
        : real.has(k.path) || real.has(`${head}.*`);
      return exists !== k.engineReal;
    });
    expect(
      mismatched.map((k) => `${k.path} (声明 engineReal=${k.engineReal})`),
      `settings 键清单与已安装引擎不符——面板会出现"看着能拨、拨了没反应"的静默 no-op：\n  ${mismatched
        .map((k) => `${k.path} → engineReal=${k.engineReal}`)
        .join("\n  ")}`,
    ).toEqual([]);
  });

  test("清单本身不许互相矛盾（同一路径只能登记一次）", () => {
    const seen = new Map<string, boolean>();
    const dupes: string[] = [];
    for (const k of MAXMA_SETTINGS_KEYS) {
      if (seen.has(k.path) && seen.get(k.path) !== k.engineReal) dupes.push(k.path);
      seen.set(k.path, k.engineReal);
    }
    expect(dupes, `同一 settings 路径被登记了两种结论：${dupes.join(", ")}`).toEqual([]);
  });
});
