#!/usr/bin/env node
/**
 * 间距守卫：自绘边框 / 底色的文字容器必须留出内边距。
 *
 * ## 为什么要有
 *
 * 2026-11-12 的精修起因：多处「文字和组件边框相切」。根因不是某一条样式写错，
 * 而是这类容器零散地手写在 80 个视图中，padding 全靠手感（p-1 / py-0.5 / 甚至没有），
 * 而编译器与既有闸门都看不见它——tsc 只认类型，色彩守卫只认颜色。
 *
 * ## 判定（静态、只看类名）
 *
 *  1. **带边框的容器**（`border` 或 `border-border` 等）且 `rounded`：
 *     - 有 `p-*` 时 ≥ 2（菜单外壳的最小值）；
 *     - 有 `px/py` 时 px ≥ 2、py ≥ 1.5。
 *  2. **自带底色的圆角块**（`bg-*` + `rounded`，不含边框）：
 *     - 有 `px-*` 却没有 `py-*`/`p-*`，也没有固定高度（`h-*`/`size-*`）→ 违规。
 *       这正是行内 code / 状态胶囊最常见的形态：文字上下直接贴着自己的圆角底。
 *
 * 只做这两条，因为它们是可判定的；"这个容器里到底有没有直接文本"渲染期才知道，
 * 硬猜会造出一堆假阳性，然后守卫会被关掉（比没有守卫更糟）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.tsx')) files.push(p);
  }
})(ROOT);

const NUM = (v) => Number(v);
const violations = [];

function checkClassString(file, line, cls) {
  // 边框包括单向边（border-b 分隔行）——设置面板的行就是这种形态，
  // 之前只看 `rounded` 会漏掉它们（恰恰是用户反馈最明显的一处）。
  const hasBorder =
    /(^|\s)border(\s|$)/.test(cls) ||
    /border-(border|destructive|primary|input|ring)/.test(cls) ||
    /(^|\s)border-[btlr](\s|$)/.test(cls);
  const rounded = /(^|\s)rounded/.test(cls);
  if (!hasBorder && !rounded) return;

  const pads = [...cls.matchAll(/\b(p|px|py|pt|pb|pl|pr)-(\d+(?:\.\d+)?)\b/g)].map((m) => [m[1], NUM(m[2])]);
  const hasPadding = pads.length > 0;
  const min = (keys) => {
    const vals = pads.filter(([k]) => keys.includes(k)).map(([, v]) => v);
    return vals.length ? Math.min(...vals) : Infinity;
  };
  const p = min(['p', 'pt', 'pb', 'pl', 'pr']);
  const px = min(['p', 'px', 'pl', 'pr']);
  const py = min(['p', 'py', 'pt', 'pb']);

  if (hasBorder) {
    if (hasPadding && (p < 2 || px < 2 || py < 1.5)) {
      violations.push({ file, line, cls, why: `带边框容器留白不足（p=${p} px=${px} py=${py}）` });
    }
    return;
  }

  // 底色圆角块：有水平内边距却没有垂直内边距、且不是固定高度控件
  const hasBg = /(^|\s)bg-(muted|secondary|card|panel|primary|destructive|accent)(\/|\s|$)/.test(cls);
  if (hasBg && /(^|\s)px-/.test(cls) && !/(^|\s)py-|(^|\s)p-/.test(cls) && !/(^|\s)(h|size)-/.test(cls)) {
    violations.push({ file, line, cls, why: '底色圆角块只有水平内边距，文字上下贴边' });
  }
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    // className="…" 与 className={`…`} 两种形态；模板字符串里的静态片段同样检查
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim();
      if (cls) checkClassString(path.relative(process.cwd(), file), i + 1, cls);
    }
  });
}

if (violations.length === 0) {
  console.log(`✓ 间距守卫通过：${files.length} 个 TSX，自绘边框/底色容器均有内边距`);
  process.exit(0);
}
// 去重（同一行同一类名组合只报一次）
const seen = new Set();
for (const v of violations) {
  const key = `${v.file}:${v.line}:${v.why}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.error(`✗ ${v.file}:${v.line}  ${v.why}\n    ${v.cls.slice(0, 140)}`);
}
console.error(`\n共 ${seen.size} 处。修法：带边框容器的 floor 是 p≥2 / px≥2 / py≥1.5（推荐 p-3 / px-3.5 / py-2.5）；\n行内 code 与状态胶囊至少要 py-0.5（推荐 py-1）。`);
process.exit(1);