#!/usr/bin/env node
/**
 * scripts/check-file-size-budget.mjs — 巨型文件体量棘轮（FILE-SIZE-RATCHET-001）。
 *
 * ## 为什么是棘轮，而不是"拆文件"
 *
 * 诊断里点名的 6 个巨型文件（useChat.ts 2842 行、chat-ws.ts 1434、jetHub.ts 1331、
 * bridge-pi.ts 1263、JetHubView.tsx 1112、api/index.ts 1096）都是历史包袱，
 * 一次性大重构的回归风险远高于收益，而且这种"大爆炸式拆分"通常会在几周内
 * 重新长回去——因为**没有任何东西在拦着它继续长**。
 *
 * 所以这里只做一件事：把当前体量记进基线，之后**只准降不准涨**。
 *   - 存量 offender 继续存在，但不能变得更胖；
 *   - 任何新文件一旦越过上限，立刻红（避免下一个 2800 行文件诞生）；
 *   - 瘦身之后用 `--write` 把基线收紧，棘轮只往前走。
 *
 * 这与 scripts/check-type-budget.mjs 是同一套思路（同样的"存量记账 + 只降不升"），
 * 只是度量的对象从类型错误换成了行数。
 *
 * 用法：node scripts/check-file-size-budget.mjs            （校验）
 *       node scripts/check-file-size-budget.mjs --write    （把当前实测写回基线）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "dev_docs", "file-size-baseline.json");
const WRITE = process.argv.includes("--write");

/** 行数上限。超过就必须进基线，或者被拆掉。 */
const LIMIT = 800;

/** 参与度量的目录（只看手写源码，不看 dist/node_modules/测试夹具）。 */
const SCAN_DIRS = [
  path.join(ROOT, "web", "src"),
  path.join(ROOT, "bun-sidecar", "src"),
  path.join(ROOT, "bun-backend", "src"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "__snapshots__"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function countLines(file) {
  const text = readFileSync(file, "utf8");
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  // 末行没有换行符也算一行
  if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) n++;
  // 不以空行充数：只统计含非空白字符的行
  const meaningful = text.split("\n").filter((l) => l.trim().length > 0).length;
  return { total: n, meaningful };
}

/** 相对仓库根的 posix 路径，作为基线键（换平台也稳定）。 */
function relKey(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

const offenders = new Map();
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const { total, meaningful } = countLines(file);
    if (total > LIMIT) offenders.set(relKey(file), { lines: total, meaningful });
  }
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, "utf8"))
  : {};
const base = baseline.files ?? {};

if (WRITE) {
  const files = {};
  for (const key of [...offenders.keys()].sort()) {
    files[key] = offenders.get(key);
  }
  const next = {
    _comment: `巨型文件体量棘轮基线（每个文件 >${LIMIT} 行）。存量只准降不准涨；新文件越界必须拆分，不许加进基线。`,
    limit: LIMIT,
    files,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`✓ 已写入基线 ${path.relative(ROOT, BASELINE_FILE)}：${Object.keys(files).length} 个 offender`);
  process.exit(0);
}

if (Object.keys(base).length === 0 && offenders.size > 0) {
  console.log(`✗ 基线为空但存在 ${offenders.size} 个 >${LIMIT} 行的文件——先跑一次 --write 记账`);
  process.exit(1);
}

const problems = [];
for (const [file, cur] of offenders) {
  const recorded = base[file];
  if (!recorded) {
    problems.push(`✗ ${file}: ${cur.lines} 行（新越界，基线里没有它；请拆分，不要加进基线）`);
  } else if (cur.lines > recorded.lines) {
    problems.push(`✗ ${file}: ${cur.lines} 行，基线 ${recorded.lines} 行（长了 ${cur.lines - recorded.lines} 行）`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(p);
  console.log(`\n体量棘轮失败：${problems.length} 个文件越界或变胖（上限 ${LIMIT} 行）`);
  process.exit(1);
}

// 提示可以收紧的条目（不作为失败）
const tighten = [];
for (const [file, recorded] of Object.entries(base)) {
  const cur = offenders.get(file);
  if (!cur) tighten.push(`${file}: 已低于 ${LIMIT} 行，可从基线移除`);
  else if (cur.lines < recorded.lines) tighten.push(`${file}: ${recorded.lines} → ${cur.lines} 行`);
}

const checked = SCAN_DIRS.filter(existsSync_);
function existsSync_(d) {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
}
console.log(
  `✓ 体量棘轮通过：${checked.length} 个源码目录，${offenders.size} 个文件 >${LIMIT} 行（均未超出基线）`,
);
if (tighten.length > 0) {
  console.log(`  可收紧（node scripts/check-file-size-budget.mjs --write）：`);
  for (const t of tighten) console.log(`    · ${t}`);
}
