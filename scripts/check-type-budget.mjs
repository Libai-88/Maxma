#!/usr/bin/env node
/**
 * scripts/check-type-budget.mjs — 类型债门禁（两侧基线均为 0）。
 *
 * ## 历史与现状
 *
 * 2026-10-27 的审计发现 `.github/workflows` 里**没有任何 workflow 跑 tsc**，
 * 于是 `bun-sidecar` 带着 14 个类型错误躺了很久。其中一条正是引擎边界该有的断言：
 * `kernel/types.ts` 从 pi-coding-agent import 了它并不导出的 `Model`
 * ——纯类型 import 被擦除，所以运行时不报错、测试也不红，**只有 tsc 看得见**。
 * 这就是"缺失的断层面"的真实代价：断裂静默积累。
 *
 * 当时的处置是给 `bun-backend` 记一个 86 的基线（阶段二 Python→Bun 直译遗留 +
 * 13 个测试文件手搓的 sqlite 类型桩等），只准减不准增——因为把 86 个历史错误
 * 直接当门禁等于永久红灯，而**没人看的红灯比没有红灯更坏**。
 *
 * 现在 86 个已全部修完，**两侧基线都清零**：本脚本退化为硬门槛，
 * 与 `tsc --noEmit` 等效，但它保留了 per-workspace 的计数与可读报错，
 * 也保留了 `--write` 这条下调通道（将来若某侧因故临时抬升，仍需显式记账）。
 *
 * 用法：node scripts/check-type-budget.mjs            （校验全部 workspace）
 *       node scripts/check-type-budget.mjs --write    （把当前实测写回基线）
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "dev_docs", "typecheck-baseline.json");
const WORKSPACES = ["bun-sidecar", "bun-backend"];
const WRITE = process.argv.includes("--write");

/**
 * 找一个**真的能跑**的 bun。
 *
 * 本机 PowerShell / cmd 的 PATH 里没有 bun，只有 `bun-sidecar/bun.exe`（便携运行时就放在那儿）。
 * 之前 `execFileSync("bun", …, { shell: true })` 在这种情况下会退化成
 * `'bun' is not recognized` → 输出里 0 个 `error TS` → 计成 0 个错误 → 棘轮发绿灯。
 * 优先顺序：环境变量 BUN_BIN → PATH 上的 bun → 仓内的便携运行时。
 * 都找不到就返回 null，由调用方报"工具链缺失"并且红——绝不静默当成 0。
 */
function resolveBun() {
  const candidates = [];
  if (process.env.BUN_BIN) candidates.push(process.env.BUN_BIN);
  candidates.push("bun");
  candidates.push(path.join(ROOT, "bun-sidecar", "bun.exe"));
  candidates.push(path.join(ROOT, "bun-sidecar", "bun"));
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { encoding: "utf8", stdio: "ignore" });
      return c;
    } catch {
      // 下一个候选
    }
  }
  return null;
}

const BUN = resolveBun();
if (!BUN) {
  console.error("✗ 找不到可执行的 bun（PATH、BUN_BIN、bun-sidecar/bun(.exe) 都试过了）");
  console.error("  类型债棘轮无法校验——这是工具链缺失，不是'0 个错误'。");
  process.exit(1);
}

function countErrors(ws) {
  let out = "";
  let toolError = null;
  try {
    out = execFileSync(BUN, ["x", "tsc", "--noEmit"], {
      encoding: "utf8",
      cwd: path.join(ROOT, ws),
      shell: false,
    });
  } catch (err) {
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    // 关键区分：tsc **有**类型错误时自身也返回非 0，但 stdout 里一定有 `error TS…`。
    // 若退出非 0 且一条都匹配不到，说明工具根本没跑起来（bun 不在 PATH、依赖缺失…），
    // 这种情况必须报"工具故障"，绝不能计成 0 个错误——否则棘轮会为一次跑不动的检查
    // 发绿灯（2026-11-17 在本机 PowerShell 下实测到：`'bun' is not recognized` + `✓ 0`）。
    if (!/error TS\d+/.test(String(out))) {
      toolError = `tsc 未产出可解析输出（exit ${err.status ?? "?"}）：${String(out).trim().slice(0, 200) || "无输出"}`;
    }
  }
  const lines = String(out)
    .split("\n")
    .filter((l) => /error TS\d+/.test(l));
  return { count: lines.length, lines, toolError };
}

const raw = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
  : {};
// 基线写在 .baseline 子对象里（同级还有 _comment 说明来历）。读错层级会让
// 校验永远报"基线里没有这一项"——第一版就是这么自我否定的，写完必须回读。
const baseline = raw.baseline ?? raw;

if (WRITE) {
  const next = {};
  for (const ws of WORKSPACES) {
    const { count, toolError } = countErrors(ws);
    if (toolError) {
      console.error(`✗ ${ws}: ${toolError}`);
      console.error("  拒绝把'跑不动的检查'写成 0 —— 先修好工具链再记账。");
      process.exit(1);
    }
    next[ws] = count;
    console.log(`${ws}: ${count}`);
  }
  writeFileSync(
    BASELINE_FILE,
    JSON.stringify({ _comment:
      "类型债棘轮基线，由 scripts/check-type-budget.mjs 校验：CI 只在错误数**上升**时红。" +
      "bun-sidecar 已清零（0）——它是引擎边界的编译期断层面，必须保持 0，" +
      "任何新增都不该被容忍。bun-backend 的 86 是阶段二 Python→Bun 直译遗留，" +
      "从未进过 CI 所以悄悄攒下的；下降后请用 --write 下调。",
      baseline: next, }, null, 2) + "\n", "utf8");
  console.log(`基线已写入 ${path.relative(ROOT, BASELINE_FILE)}`);
  process.exit(0);
}

let failed = false;
for (const ws of WORKSPACES) {
  const limit = baseline[ws];
  if (limit === undefined) {
    console.error(`✗ ${ws}: 基线里没有这一项（先跑 --write）`);
    failed = true;
    continue;
  }
  const { count, lines, toolError } = countErrors(ws);
  if (toolError) {
    failed = true;
    console.error(`✗ ${ws}: ${toolError}`);
    continue;
  }
  if (count > limit) {
    failed = true;
    console.error(`✗ ${ws}: 类型错误 ${count} > 基线 ${limit}（新增 ${count - limit} 个）`);
    console.error(lines.slice(0, 20).map((l) => "    " + l).join("\n"));
  } else if (count < limit) {
    console.log(`✓ ${ws}: ${count} < 基线 ${limit} —— 还掉了 ${limit - count} 个，记得 --write 下调基线`);
  } else {
    console.log(`✓ ${ws}: ${count}（持平基线）`);
  }
}

if (failed) {
  console.error("\n结论：类型债上升。修掉新增的错误，而不是调高基线。");
  process.exit(1);
}
