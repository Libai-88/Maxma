#!/usr/bin/env node
/**
 * 玻璃层数守卫：`backdrop-filter` 的生效声明不得超过既有的 8 组。
 *
 * ## 为什么要有
 *
 * 玻璃是这个主题唯一的贵东西：每一层 `backdrop-filter` 都要在合成时
 * 把背后的画面模糊一遍。现在全站只有 8 组（`.glass-panel` / `.bg-card` /
 * `.bg-popover` / `.glass-control` / `.glass-primary` / 侧栏 / 两处控件外壳），
 * 这是它看起来像玻璃、又不卡的原因。
 *
 * 变美最容易走的歪路就是「再加一层模糊会更好看」——一层不卡，十层就卡，
 * 而且叠三层玻璃后文字对比度会掉到不可读。所以这里把它变成硬上限：
 * 数字不变就不许合入。
 *
 * `none` 声明（`data-glass="opaque"` 与 `prefers-reduced-transparency` 的逃生门）
 * 不计入。`-webkit-` 前缀是同一条声明的副本，不重复计数。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
const LIMIT = 8;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".css")) files.push(p);
  }
})(ROOT);

const live = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*-webkit-backdrop-filter:/.test(line)) return;
    const m = line.match(/^\s*backdrop-filter:\s*(.+?);/);
    if (!m) return;
    const value = m[1].trim();
    if (value === "none") return;
    live.push({ file: rel, line: i + 1, value });
  });
}

if (live.length > LIMIT) {
  console.error(`✗ 玻璃层数守卫：${live.length} 组 backdrop-filter，上限 ${LIMIT} 组\n`);
  for (const v of live) console.error(`  ${v.file}:${v.line}  backdrop-filter: ${v.value}`);
  console.error("\n变美不要靠加模糊：先看 spacing、层级和状态语言。");
  console.error("若确实要新增一层，先证明它能换来什么，再把这里的 LIMIT 调高（并在提交信息里写明）。");
  process.exit(1);
}

console.log(`✓ 玻璃层数守卫通过（${live.length}/${LIMIT} 组）`);
