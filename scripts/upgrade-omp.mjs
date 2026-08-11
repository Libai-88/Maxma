#!/usr/bin/env bun
/**
 * upgrade-omp.mjs — OMP 受控升级一键脚本
 *
 * 用法（在 MaxmaHere 根目录）：
 *   bun run scripts/upgrade-omp.mjs            # 升级到 npm latest
 *   bun run scripts/upgrade-omp.mjs 17.2.12    # 升级到指定版本
 *   bun run scripts/upgrade-omp.mjs --check    # 只检查并展示升级建议，不改动
 *
 * 流程（失败即停，不产生半成品状态）：
 *   1. 检查 npm 最新版 + CHANGELOG 摘要（Breaking Changes 高亮）
 *   2. 备份 package.json / bun.lock
 *   3. bump 4 个 @oh-my-pi/* 包 → bun install
 *   4. bunx tsc --noEmit（类型断裂面）
 *   5. bun test（138 用例）
 *   6. verify-omp-settings.mjs（settings 路径漂移检测）
 *   7. 输出升级报告；任一步失败自动回滚
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIDECAR = resolve(ROOT, "bun-sidecar");
const PKG = resolve(SIDECAR, "package.json");
const LOCK = resolve(SIDECAR, "bun.lock");
const BACKUP_PKG = `${PKG}.bak`;
const BACKUP_LOCK = `${LOCK}.bak`;

const OMP_PACKAGES = ["pi-agent-core", "pi-ai", "pi-catalog", "pi-coding-agent"];
const CHECK_ONLY = process.argv.includes("--check");
const TARGET_ARG = CHECK_ONLY ? "latest" : (process.argv[2] ?? "latest");
const TARGET = TARGET_ARG;

function sh(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  try {
    const out = execSync(cmd, { stdio: "pipe", encoding: "utf-8", ...opts, cwd: opts.cwd ?? SIDECAR });
    if (out.trim()) console.log(out.trim().split("\n").slice(0, 12).join("\n"));
    return out;
  } catch (e) {
    console.error(`[FAIL] ${cmd}`);
    const errDetail = (e.stderr ?? e.stdout ?? e.message ?? "").toString();
    if (errDetail.trim()) console.error(errDetail.slice(0, 1500));
    else console.error(`  status=${e.status} message=${(e.message ?? "").slice(0, 300)}`);
    return null;
  }
}

/** 带重试的命令执行（bun install 后首次 tsc 偶发时序失败，重试一次） */
function shRetry(cmd, label, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const out = sh(cmd);
    if (out !== null) return out;
    console.error(`${label} 第 ${attempt}/${retries} 次失败，3 秒后重试…`);
    execSync("ping -n 4 127.0.0.1 >NUL", { stdio: "ignore" }); // ~3s（跨平台 sleep）
  }
  return null;
}

/** 从本地 node_modules CHANGELOG.md 提取目标版本摘要（安装后可靠）；npm readme 兜底 */
function changelogSummary(version) {
  const localChangelog = resolve(
    SIDECAR,
    "node_modules/@oh-my-pi/pi-coding-agent/CHANGELOG.md",
  );
  if (existsSync(localChangelog)) {
    try {
      const lines = readFileSync(localChangelog, "utf-8").split("\n");
      const out = [];
      let inSection = false;
      for (const l of lines) {
        if (/^## \[/.test(l) && !l.includes(`[${version}]`)) inSection = false;
        if (l.includes(`## [${version}]`)) inSection = true;
        if (inSection && l.trim()) out.push(l);
        if (out.length > 40) break;
      }
      if (out.length) return out.join("\n");
    } catch { /* fallthrough */ }
  }
  try {
    const readme = execSync(
      `npm view @oh-my-pi/pi-coding-agent@${version} readme 2>NUL || true`,
      { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 },
    );
    const lines = readme.split("\n");
    const out = [];
    let inSection = false;
    for (const l of lines) {
      if (/^## \[/.test(l)) inSection = false;
      if (l.includes(`## [${version}]`)) inSection = true;
      if (inSection && l.trim()) out.push(l);
      if (out.length > 40) break;
    }
    return out.length ? out.join("\n") : "（无法获取 CHANGELOG，请查看 GitHub releases）";
  } catch {
    return "（无法获取 CHANGELOG，请查看 GitHub releases）";
  }
}

/** 读取当前锁定版本 */
function currentVersion() {
  const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
  return pkg.dependencies["@oh-my-pi/pi-coding-agent"];
}

// ── 1. 检查最新版本 ─────────────────────────────────────────────
const cur = currentVersion();
const latest = (() => {
  try {
    const v = sh(`npm view @oh-my-pi/pi-coding-agent dist-tags.latest`, { cwd: ROOT });
    return v?.trim() ?? cur;
  } catch {
    return cur;
  }
})();

console.log("=".repeat(64));
console.log("OMP 升级检查");
console.log("=".repeat(64));
console.log(`当前锁定: ${cur}`);
console.log(`npm latest: ${latest}`);
const target = TARGET === "latest" ? latest : TARGET;
const sameMajor = cur.split(".")[0] === target.split(".")[0];
console.log(`目标版本: ${target}`);
console.log(`跨大版本: ${sameMajor ? "否（同 major，低风险）" : "是（需受控流程，见 docs/omp-upgrade-guide.md §1）"}`);

if (cur === target) {
  console.log("\n目标版本与当前一致，无需升级。");
  process.exit(0);
}

console.log("\n── CHANGELOG 摘要 ──");
console.log(changelogSummary(target));
console.log("─────────────────────");

if (CHECK_ONLY) {
  console.log("\n[--check] 仅检查，未做任何改动。");
  process.exit(0);
}

// 大版本升级提示（natives 运行时风险）——以目标版本判断，而非 latest
const targetMajor = target.split(".")[0];
if (targetMajor > cur.split(".")[0]) {
  console.warn(
    "\n[警告] 跨大版本升级！请先确认 pi-natives 运行时问题已解决（见 docs/omp-upgrade-guide.md §1 第二层前置门槛）。\n      输入 y 继续，其余退出：",
  );
  const answer = await new Promise((r) => {
    process.stdin.once("data", (d) => r(d.toString().trim().toLowerCase()));
  });
  if (answer !== "y") {
    console.log("已取消。");
    process.exit(0);
  }
}

// ── 2. 备份 ─────────────────────────────────────────────────────
copyFileSync(PKG, BACKUP_PKG);
if (existsSync(LOCK)) copyFileSync(LOCK, BACKUP_LOCK);
console.log("\n[1/6] 已备份 package.json / bun.lock");

// ── 3. bump + install ───────────────────────────────────────────
const pkg = JSON.parse(readFileSync(PKG, "utf-8"));
for (const name of OMP_PACKAGES) {
  pkg.dependencies[`@oh-my-pi/${name}`] = target;
}
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
console.log(`[2/6] 已 bump ${OMP_PACKAGES.length} 个包 → ${target}`);
if (!sh("bun install")) {
  console.error("bun install 失败，回滚中…");
  restoreAndExit();
}

// ── 4. 类型检查 ─────────────────────────────────────────────────
console.log("[3/6] 类型检查…");
if (!shRetry("bun x tsc --noEmit -p .", "类型检查")) {
  console.error("类型检查失败（API 断裂），回滚中…");
  restoreAndExit();
}
console.log("[3/6] 类型检查通过 ✅");

// ── 5. 单元测试 ─────────────────────────────────────────────────
console.log("[4/6] 单元测试…");
const testOut = sh("bun test");
if (!testOut || /fail/i.test(testOut.split("\n").slice(-8).join("\n"))) {
  console.error("单元测试失败，回滚中…");
  restoreAndExit();
}
console.log("[4/6] 单元测试通过 ✅");

// ── 6. settings 路径校验 ────────────────────────────────────────
console.log("[5/6] settings 路径漂移检测…");
const verify = resolve(ROOT, "scripts", "verify-omp-settings.mjs");
if (existsSync(verify)) {
  const vOut = sh(`bun run "${verify}"`);
  if (vOut && /MISSING/.test(vOut)) {
    console.warn("[5/6] 存在失效 settings 路径（见上），请在升级中迁移（不会阻断）。");
  } else {
    console.log("[5/6] settings 路径全部有效 ✅");
  }
} else {
  console.log("[5/6] verify-omp-settings.mjs 不存在，跳过（请先创建）。");
}

// ── 7. 报告 ─────────────────────────────────────────────────────
console.log("\n" + "=".repeat(64));
console.log("升级完成 ✅");
console.log(`  当前: ${cur} → ${target}`);
console.log("  后续步骤（手动）:");
console.log("  1. 运行时冒烟：起 dev 后端 + 浏览器仿真（聊天/工具/审批/记忆）");
console.log("  2. bun build --compile 编译 sidecar");
console.log("  3. 便携版构建");
console.log("  4. 提交（package.json + bun.lock + 必要适配）");
console.log("=".repeat(64));

function restoreAndExit() {
  copyFileSync(BACKUP_PKG, PKG);
  if (existsSync(BACKUP_LOCK)) copyFileSync(BACKUP_LOCK, LOCK);
  sh("bun install");
  console.error("已回滚到原版本。");
  process.exit(1);
}
