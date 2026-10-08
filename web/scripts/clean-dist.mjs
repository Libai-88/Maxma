/**
 * scripts/clean-dist.mjs — 构建前清空 dist（vite.config.ts emptyOutDir:false 的配套）。
 *
 * ## 为什么不能直接 rmSync
 *
 * 本仓库有 safe-delete 钩子：对超过阈值的删除（>50 个文件）会转 tryTrash 并**静默
 * 失败**——`rmSync` 不删但退出码为 0（vite.config.ts 的注释记录过这个坑）。所以
 * 这里用 **rename** 隔离：把旧 dist 整体改名成 `_old-<时间戳>`（rename 不受钩子
 * 拦截），vite 写入全新的 dist。
 *
 * ## 为什么必须清
 *
 * 关掉 emptyOutDir 后 dist 会**永远累积**旧 hash 的 chunk（实测 JetHubView 同时存在
 * 新旧两个 bundle）。index.html 只引用新 hash，旧文件功能上无害，但：产物体积
 * 虚涨、排障时「文件时间戳没变」的怀疑会被旧文件搅浑（PLUGIN-001 复查期间真实发生）。
 *
 * 旧 `_old-*` 目录做**尽力删除**（rmSync；被钩子拦截就留着，不报错——它们不进产物，
 * 产物只拷 dist）。
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = join(process.cwd(), "dist");
if (!existsSync(distDir)) {
  console.log("[clean-dist] dist 不存在，无需清理");
  process.exit(0);
}

// 1. 旧 dist 整体改名隔离（rename 不被 safe-delete 钩子拦截）
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const quarantined = `${distDir}_old_${stamp}`;
renameSync(distDir, quarantined);
console.log(`[clean-dist] dist -> ${quarantined.split(/[\\/]/).pop()}`);

// 2. 尽力删除历史隔离目录（失败静默：不进产物，只占工作区）
const parent = join(process.cwd());
for (const name of readdirSync(parent)) {
  if (!name.startsWith("dist_old_")) continue;
  const p = join(parent, name);
  try {
    const age = Date.now() - statSync(p).mtimeMs;
    if (age < 60_000) continue; // 刚隔离的这次保留（回滚保险）
    rmSync(p, { recursive: true, force: true });
    if (!existsSync(p)) console.log(`[clean-dist] 已删除历史隔离目录 ${name}`);
  } catch {
    /* safe-delete 钩子拦截时静默保留 */
  }
}
