#!/usr/bin/env bun
/**
 * verify-omp-settings.mjs — 校验 Maxma 使用的 OMP settings 路径在已安装版本中是否有效。
 *
 * 用法：bun run scripts/verify-omp-settings.mjs
 *
 * 读取：
 *   1. session-bridge.ts 的 globalPaths 列表
 *   2. 代码中硬编码的 settings 路径（setSetting / Settings.isolated 调用）
 * 对照：
 *   已安装 @oh-my-pi/pi-coding-agent 的 settings-schema.d.ts
 * 输出：失效路径清单（MISSING 标记，供升级时迁移）
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR = resolve(ROOT, "bun-sidecar");

// ── 1. 从 schema 提取全部合法路径 ──
const schemaPath = resolve(
  SIDECAR,
  "node_modules/@oh-my-pi/pi-coding-agent/dist/types/config/settings-schema.d.ts",
);
let schema = "";
try {
  schema = readFileSync(schemaPath, "utf-8");
} catch {
  console.error("找不到 settings-schema.d.ts，请先 bun install。");
  process.exit(1);
}
const validPaths = new Set([
  // 嵌套键（带引号）：readonly "tools.approvalMode":
  ...[...schema.matchAll(/readonly\s+"([^"]+)"/g)].map((m) => m[1]),
  // 顶层键（无引号）：readonly steeringMode: / readonly temperature:
  ...[...schema.matchAll(/readonly\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:/g)].map((m) => m[1]),
]);
const ompVersion = JSON.parse(
  readFileSync(resolve(SIDECAR, "node_modules/@oh-my-pi/pi-coding-agent/package.json"), "utf-8"),
).version;

// ── 2. 提取 Maxma 使用的路径 ──
const bridge = readFileSync(resolve(SIDECAR, "src/session-bridge.ts"), "utf-8");
const usedPaths = new Set();

// 2a. globalPaths 列表
const gpMatch = bridge.match(/const globalPaths = \[([\s\S]*?)\];/);
if (gpMatch) {
  for (const m of gpMatch[1].matchAll(/"([a-zA-Z0-9_.]+)"/g)) usedPaths.add(m[1]);
}
// 2b. setSetting / Settings.isolated 硬编码路径
for (const m of bridge.matchAll(/(?:setSetting\([^,]+,\s*|"tools\.[a-zA-Z0-9_.]+"|"compaction\.[a-zA-Z0-9_.]+"|"retry\.[a-zA-Z0-9_.]+"|"thinkingBudgets\.[a-zA-Z0-9_.]+"|"memory\.[a-zA-Z0-9_.]+"|"advisor\.[a-zA-Z0-9_.]+"|"temperature")/g)) {
  const hit = m[0].replace(/^setSetting\([^,]+,\s*/, "").replace(/"/g, "");
  if (/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(hit)) usedPaths.add(hit);
}

// ── 3. 对比输出 ──
const missing = [...usedPaths].filter((p) => !validPaths.has(p)).sort();
console.log(`OMP 版本: ${ompVersion}`);
console.log(`schema 路径数: ${validPaths.size} | Maxma 使用路径数: ${usedPaths.size}`);
if (missing.length === 0) {
  console.log("\n全部 settings 路径有效 ✅");
} else {
  console.log("\n以下路径在已安装版本中缺失（MISSING）：");
  for (const p of missing) console.log(`  MISSING  ${p}`);
  console.log("\n提示：失效路径在代码中被 try/catch 静默跳过（不会崩溃），但相关配置不生效，升级时应迁移。");
  process.exit(1);
}
