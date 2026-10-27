#!/usr/bin/env node
/**
 * scripts/upgrade-pi.mjs — 引擎（@earendil-works/pi）受控升级工具。
 *
 * 取代 scripts/upgrade-omp.mjs。旧脚本已经整体失效：它读
 * `bun-sidecar/package.json` 里的 `@oh-my-pi/pi-coding-agent`（早就不存在，
 * 于是 currentVersion() 返回 undefined 并在 :125 崩溃），查询的是**另一个还在发版
 * 的旧引擎** @oh-my-pi（实测 npm latest 18.13.1），bump 清单里还含新 scope 下 404 的
 * pi-catalog，而且**只动 bun-sidecar 一个 workspace** —— bun-backend 那份同样锁死的
 * 三个直接依赖它碰都不碰，按它走必然造出两棵不一致的依赖树。
 * 配套的 verify-omp-settings.mjs 同样失效（读的 settings-schema.d.ts 不存在，
 * 解析的 globalPaths 也已从源码消失），**且失败时退出码为 0 —— 一条会发绿灯的死检查**。
 *
 * 本脚本的三条硬性原则：
 *   1. **两个 workspace 一起升**，包括 overrides 里的家族包；升完校验两棵锁一致。
 *   2. **失败必须非零退出**；核对没做成要显式说"未核对"，不许沉默通过。
 *   3. **不猜语义**：先打印上游 CHANGELOG 里 current→target 之间的 Breaking Changes，
 *      跨大版本只允许 --force，因为 semver 在这个上游不可信（0.99.0 的 CHANGELOG 里
 *      有 47 个 "### Breaking Changes" 段，散布在 minor 甚至 patch 上）。
 *
 * 用法：
 *   node scripts/upgrade-pi.mjs --check            只查不改：版本差距 + Breaking 摘要
 *   node scripts/upgrade-pi.mjs 1.4.0              升到指定版本（同带内自动，跨带需 --force）
 *   node scripts/upgrade-pi.mjs latest             升到 npm latest
 *   ... --force                                    允许跨大版本
 *   ... --dry-run                                  跑完整流程但不写文件（验证脚本本身）
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 直接依赖（两处 package.json 都声明，必须同版本）。 */
const DIRECT = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
];
/** 家族包：0.99.x 时代上游用 ^0.99.0 声明，必须在 overrides 里钉死，否则两棵树会漂。 */
const FAMILY = [
  "@earendil-works/chord",
  "@earendil-works/pi-codemode",
  "@earendil-works/pi-mcp",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-tui",
];
const WORKSPACES = ["bun-backend", "bun-sidecar"];

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check");
const FORCE = args.includes("--force");
const DRY = args.includes("--dry-run");
const targetArg = args.find((a) => !a.startsWith("--"));

function sh(cmd, cmdArgs, opts = {}) {
  // shell:true 不可省：npm 在 Windows 上是 npm.cmd 包装，execFileSync 不经 shell
  // 解析会直接 ENOENT（第一版就是这么"npm view 失败"的）。
  return execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    cwd: opts.cwd ?? ROOT,
    shell: true,
    ...opts,
  });
}

/** 把失败原因如实打出来——一句"大概是网络"式的猜测只会把下一个人带偏。 */
function why(err) {
  const msg = String(err?.stderr ?? err?.stdout ?? err?.message ?? err).trim();
  return msg.split("\n").slice(0, 3).join(" / ");
}

/**
 * `npm view <pkg> <field>` 或 `npm view <pkg>@<version> version`。
 * 注意 spec 与 field 是两个参数——写成 `pkg@field` 会查出一个不存在的版本，
 * 然后被 catch 成"网络失败"，那是假信号（我第一版就踩了）。
 */
function npmView(pkg, ...rest) {
  return sh("npm", ["view", pkg, ...rest], { stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function readManifest(ws) {
  return JSON.parse(readFileSync(path.join(ROOT, ws, "package.json"), "utf8"));
}

function currentVersions() {
  const map = {};
  for (const ws of WORKSPACES) {
    const pkg = readManifest(ws);
    map[ws] = { direct: {}, overrides: pkg.overrides ?? {} };
    for (const d of DIRECT) map[ws].direct[d] = pkg.dependencies?.[d];
  }
  const first = map[WORKSPACES[0]].direct[DIRECT[0]];
  const mismatched = [];
  for (const ws of WORKSPACES) {
    for (const d of DIRECT) {
      if (map[ws].direct[d] !== first) mismatched.push(`${ws}/${d}=${map[ws].direct[d]}`);
    }
  }
  return { pinned: first, map, mismatched };
}

/** 从锁文件里取 @earendil-works/* 的解析版本（bun.lock 是 JSONC，不能 JSON.parse）。 */
function lockedVersions(ws) {
  const file = path.join(ROOT, ws, "bun.lock");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const out = {};
  const re = /"(@earendil-works\/[^"]+)"\s*:\s*\[\s*"\1@([^"]+)"/g;
  for (const m of text.matchAll(re)) out[m[1]] = m[2];
  return out;
}

function breakingSections(changelogText, fromVersion, toVersion) {
  const entries = changelogText.split(/\n## \[/).slice(1);
  const num = (v) => v.split("-")[0].split(".").map(Number);
  const cmp = (a, b) => {
    const [x, y, z] = num(a);
    const [p, q, r] = num(b);
    return x - p || y - q || z - r;
  };
  const hits = [];
  for (const chunk of entries) {
    const m = chunk.match(/^\]?([^\]\s]+)/);
    if (!m) continue;
    const ver = m[1];
    if (cmp(ver, fromVersion) <= 0 || cmp(ver, toVersion) > 0) continue;
    const seg = chunk.split(/### Breaking Changes/)[1];
    if (seg) hits.push({ ver, body: seg.split(/\n###? /)[0].trim() });
  }
  return hits;
}

// ── 1. 现状 ────────────────────────────────────────────────
const cur0 = currentVersions();
console.log("=".repeat(64));
console.log("pi 引擎受控升级");
console.log("=".repeat(64));
if (!cur0.pinned) {
  console.error("✗ 读不到当前锁定版本（两个 workspace 的 package.json 里都没有 " + DIRECT[0] + "）");
  process.exit(1);
}
console.log(`当前锁定: ${cur0.pinned}`);
if (cur0.mismatched.length) {
  console.error(`✗ 两个 workspace 的直接依赖已经不一致：\n  ${cur0.mismatched.join("\n  ")}`);
  process.exit(1);
}

let latest;
try {
  latest = npmView(DIRECT[0], "dist-tags.latest");
} catch (err) {
  console.error(`✗ 查询 npm latest 失败：${why(err)}\n  ——无法确认上游最新版，检查未完成。`);
  process.exit(1);
}
console.log(`npm latest: ${latest}`);
const target = CHECK_ONLY || targetArg === "latest" ? latest : targetArg;
console.log(`目标版本: ${target}`);

// 上游三个包同步发版（家族锁同源），目标版本必须三个都存在
for (const d of DIRECT) {
  let v = "";
  try {
    v = sh("npm", ["view", `${d}@${target}`, "version"], { stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    console.error(`✗ ${d}@${target} 在 npm 上取不到：${why(err)}\n  引擎全家桶必须同步 bump，目标版本无效。`);
    process.exit(1);
  }
  if (!v) {
    console.error(`✗ ${d}@${target} 无返回版本，目标无效。`);
    process.exit(1);
  }
}

const sameMajor = target.split(".")[0] === cur0.pinned.split(".")[0];
console.log(`跨大版本: ${sameMajor ? "否（同 major）" : "是（需 --force，且逐条核对 Breaking）"}`);

// ── 2. Breaking Changes 摘要 ──────────────────────────────
console.log("\n── 上游 CHANGELOG 中 current→target 之间的 Breaking Changes ──");
let breaking = null;
try {
  const text = sh("curl", ["-sSL", `https://unpkg.com/${DIRECT[0]}@${target}/CHANGELOG.md`]);
  breaking = breakingSections(text, cur0.pinned, target);
  if (!breaking.length) {
    console.log(`  （${cur0.pinned} → ${target} 之间无 Breaking Changes 段）`);
  } else {
    for (const b of breaking) {
      console.log(`\n  [${b.ver}]`);
      console.log(
        b.body
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => "    " + l.trim().slice(0, 160))
          .join("\n"),
      );
    }
    console.log(
      "\n  ⚠️ 逐条与本仓消费面对账：bun-sidecar/src/kernel/pi-contract.ts（符号/事件/工具/" +
        "settings/provider api 的登记表），以及 tests/pi-contract.test.ts 的判据。",
    );
  }
} catch (err) {
  console.log(`  ⚠️ 未能获取 CHANGELOG：${why(err)}`);
  console.log("     Breaking 变更**未核对**（本脚本据此判为未完成检查，退出码非 0）。");
}

// 两把锁的家族漂移现状（升级前就存在的第三种版本树的证据）
const lockA = lockedVersions("bun-backend");
const lockB = lockedVersions("bun-sidecar");
if (lockA && lockB) {
  const drift = Object.keys({ ...lockA, ...lockB }).filter((k) => lockA[k] !== lockB[k]);
  console.log(
    drift.length
      ? `\n⚠️ 两 workspace 锁文件已有家族包漂移：\n  ${drift.map((k) => `${k}: backend=${lockA[k]} / sidecar=${lockB[k]}`).join("\n  ")}`
      : "\n✓ 两把 bun.lock 的 @earendil-works/* 解析版本一致",
  );
} else {
  console.log("\n⚠️ 至少一把 bun.lock 缺失（backend 的锁必须入库，否则 CI 的 --frozen-lockfile 无锁可冻）。");
}

if (CHECK_ONLY) {
  console.log("\n（--check：只读，未改动任何文件）");
  if (!breaking) {
    console.error("✗ 因 CHANGELOG 未取到，本次 check 视为未完成。");
    process.exit(3);
  }
  process.exit(0);
}

if (!sameMajor && !FORCE) {
  console.error("\n✗ 跨大版本升级需显式 --force（semver 在本上游不可信：0.99.0 的 CHANGELOG 含 47 个 Breaking 段，散布在 minor/patch）。");
  process.exit(1);
}
if (cur0.pinned === target && !FORCE) {
  console.log("\n目标与当前一致，无需升级。");
  process.exit(0);
}

// ── 3. bump（含备份与失败回滚）─────────────────────────────
const backups = new Map();
for (const ws of WORKSPACES) {
  const file = path.join(ROOT, ws, "package.json");
  backups.set(file, readFileSync(file, "utf8"));
  if (DRY) continue;
  const pkg = JSON.parse(backups.get(file));
  for (const d of DIRECT) pkg.dependencies[d] = target;
  for (const f of FAMILY) if (pkg.overrides?.[f]) pkg.overrides[f] = target;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n", "utf8");
}
console.log(`\n已写入两个 workspace 的 package.json（direct ${DIRECT.length} 个 + overrides 家族 ${FAMILY.length} 个 → ${target}）${DRY ? "（--dry-run 实际未写）" : ""}`);

function restore() {
  for (const [file, text] of backups) writeFileSync(file, text, "utf8");
  console.error("已回滚 package.json（未动 bun.lock；如需彻底还原：git checkout -- <两个 package.json> 后 bun install）");
}

let failed = false;
try {
  for (const ws of WORKSPACES) {
    if (DRY) continue;
    sh("bun", ["install"], { cwd: path.join(ROOT, ws), stdio: "inherit" });
  }
  console.log("\n── 验证：类型 ──");
  sh("bun", ["x", "tsc", "--noEmit"], { cwd: path.join(ROOT, "bun-sidecar"), stdio: "inherit" });
  console.log("\n── 验证：引擎契约守卫（先跑这两个，它们会点名断裂面）──");
  sh("bun", ["test", "tests/pi-contract.test.ts", "tests/engine-boundary.test.ts"], {
    cwd: path.join(ROOT, "bun-sidecar"),
    stdio: "inherit",
  });
  console.log("\n── 验证：sidecar + backend 测试 ──");
  sh("bun", ["test"], { cwd: path.join(ROOT, "bun-sidecar"), stdio: "inherit" });
  sh("bun", ["test"], { cwd: path.join(ROOT, "bun-backend"), stdio: "inherit" });
} catch (err) {
  failed = true;
  console.error(`\n✗ 升级验证失败：${why(err)}`);
  if (!DRY) restore();
}

// 升完再核对两把锁是否一致
const a2 = lockedVersions("bun-backend");
const b2 = lockedVersions("bun-sidecar");
if (a2 && b2) {
  const drift = Object.keys({ ...a2, ...b2 }).filter((k) => a2[k] !== b2[k]);
  if (drift.length) {
    console.error(`✗ 升级后两 workspace 锁仍不一致：\n  ${drift.map((k) => `${k}: ${a2[k]} / ${b2[k]}`).join("\n  ")}`);
    failed = true;
  }
}

if (failed) {
  console.error("\n结论：升级未完成（已尽力回滚 package.json）。");
  process.exit(1);
}
console.log(`\n结论：升级到 ${target} 的自动段通过。仍需人工完成：`);
console.log("  1. 运行时冒烟（真实链路）：发一条消息 → 流式回复 → 工具调用 → 审批 → 取消；");
console.log("     类型与测试全绿不等于运行时可用（2026-08 的演练正是 tsc/测试/编译全过而 natives 崩）。");
console.log("  2. bun run build-server.mjs + 便携包冒烟（pi 被内联进 server.js，换引擎=重打后端产物）。");
console.log("  3. 核对 /api/capabilities 的 engine.version 与文档；HANDOFF.md 的引擎版本行。");
console.log("  4. 若 pi-contract.ts 有任何一条被引擎改动，先更新登记表并写清 breakMode，再提交。");
