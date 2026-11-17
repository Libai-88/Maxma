#!/usr/bin/env node
/**
 * web/scripts/lint-changed.mjs — 只对"本次改动触及"的前端文件跑 ESLint。
 *
 * 为什么不 lint 全量：web/src 2.6 万行从未 lint 过，全量开闸 = 一次性几百上千条
 * 存量告警 → 只能加 `--quiet` 或直接不跑，门槛等同不存在。这里换一条路：
 * 存量豁免，**新改动必须干净**。棘轮只要往前走就不会退化。
 *
 * 来源集合（三者取并集，去重）：
 *   1. `<base>...HEAD` 的已提交改动（默认 base=origin/main，可用 LINT_BASE 覆盖）
 *   2. 工作区未暂存 + 已暂存的改动（本地开发时也能即时反馈）
 *   3. 未跟踪的新文件（`git ls-files --others`）——新写的文件最需要被 lint
 *
 * 用法：node scripts/lint-changed.mjs
 *       LINT_BASE=HEAD~5 node scripts/lint-changed.mjs
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB_DIR, "..");

const BASE = process.env.LINT_BASE || "origin/main";

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function toLines(s) {
  return s ? s.split("\n").filter(Boolean) : [];
}

// base 不存在（浅克隆 / 远端未 fetch）时退化为"只看工作区改动"，
// 而不是整门失效——但要把这件事说出来，别静默降级。
let baseRef = null;
const mergeBase = tryGit(["merge-base", BASE, "HEAD"]);
if (mergeBase) baseRef = mergeBase;
else console.log(`! 找不到 ${BASE}（未 fetch？浅克隆？）——本次只检查工作区与未跟踪文件`);

const files = new Set();
if (baseRef) {
  for (const f of toLines(tryGit(["diff", "--name-only", "--diff-filter=AMR", `${baseRef}...HEAD`]))) files.add(f);
}
for (const f of toLines(tryGit(["diff", "--name-only", "--diff-filter=AMR"]))) files.add(f);
for (const f of toLines(tryGit(["diff", "--cached", "--name-only", "--diff-filter=AMR"]))) files.add(f);
for (const f of toLines(tryGit(["ls-files", "--others", "--exclude-standard"]))) files.add(f);

// 只关心前端源码与测试，且必须是 .ts/.tsx
const targets = [...files]
  .filter((f) => /^web\/(src|tests)\//.test(f) && /\.(ts|tsx)$/.test(f))
  .map((f) => f.slice("web/".length))
  .sort();

if (targets.length === 0) {
  console.log("✓ 本次改动没有触及 web/src 或 web/tests 下的 .ts/.tsx，跳过 lint");
  process.exit(0);
}

const eslintBin = path.join(
  WEB_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint",
);
if (!existsSync(eslintBin)) {
  console.log("✗ 未找到本地 eslint（先 `npm ci` / `npm install`）");
  process.exit(2);
}

console.log(`lint 目标（相对 web/，共 ${targets.length} 个）：`);
for (const t of targets) console.log(`  · ${t}`);

try {
  const out = execFileSync(eslintBin, [...targets], {
    cwd: WEB_DIR,
    encoding: "utf8",
    shell: true,
  });
  if (out.trim()) console.log(out);
  console.log("✓ ESLint 通过（0 error）");
} catch (err) {
  const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  if (out.trim()) console.log(out);
  console.log("✗ ESLint 未通过");
  process.exit(1);
}
