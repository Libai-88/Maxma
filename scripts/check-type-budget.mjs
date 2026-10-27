#!/usr/bin/env node
/**
 * scripts/check-type-budget.mjs — 类型债棘轮（只准减，不准增）。
 *
 * 为什么不是直接 `tsc --noEmit` 硬门槛：
 *   bun-backend 有 86 个**历史遗留**类型错误（含测试文件），把它们当本次门禁
 *   等于永久红灯——红灯没人看的 CI 比没有 CI 更坏。
 * 为什么不是不设门槛：
 *   2026-10-27 的审计发现，`bun-sidecar` 的 tsc 已经红了很久（14 个错误），
 *   因为**没有任何 CI 跑 tsc**。其中一条正是引擎边界该有的断言：
 *   `kernel/types.ts` 从 pi-coding-agent import 了它并不导出的 `Model`
 *   ——纯类型 import 被擦除，所以运行时不报错，测试也不红，只有 tsc 看得见。
 *   这就是"缺失的断层面"的真实代价：断裂静默积累。
 *
 * 所以这里记一个基线，超标即红；数字下降时提示可以下调基线。
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

function countErrors(ws) {
  let out = "";
  try {
    out = execFileSync("bun", ["x", "tsc", "--noEmit"], {
      encoding: "utf8",
      cwd: path.join(ROOT, ws),
      shell: true,
    });
  } catch (err) {
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  const lines = String(out)
    .split("\n")
    .filter((l) => /error TS\d+/.test(l));
  return { count: lines.length, lines };
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
    const { count } = countErrors(ws);
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
  const { count, lines } = countErrors(ws);
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
