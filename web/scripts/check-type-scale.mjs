#!/usr/bin/env node
/**
 * 排版守卫：字号必须有档位，动效必须有时长，阴影必须有高度。
 *
 * ## 为什么要有
 *
 * 2026-11-18 的美学整理起因：`solid-glass.css` 里配色、圆角、玻璃材质都有 token，
 * 唯独「字号」没有。结果 33 个视图里写出了 125 处任意字号、11 个档位
 * （10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 14 / 15 / 17 / 22px）。
 * 10.5 与 11 并排不是大小关系，12.5 与 13 也不是——半像素档不构成层级，
 * 页面就显得「精致但发糊」。同一批视图里 transition 有 34 处、带时长的只有 1 处，
 * shadow-sm/lg/2xl 混着用。
 *
 * 编译器看不见这些，色彩守卫只认颜色，间距守卫只认 padding。
 *
 * ## 判定（静态、只看类名字符串）
 *
 *  1. `text-[…]` 任意字号 → 违规。档位见 SCALE（caption/meta/ui/body/subtitle/display）。
 *  2. `transition*` 出现在类名串里、却没有任何 `duration-*` → 违规。
 *     时长取自 `--motion-fast/base/slow`，曲线取 `ease-standard` / `ease-out-quint`。
 *  3. `shadow-sm|md|lg|xl|2xl|inner` 或 `shadow-[…]` → 违规。
 *     高度只有三级：elev-1 / elev-2 / elev-3。玻璃面上（.bg-card/.bg-popover/
 *     .glass-panel）本来就有阴影，这些类是多余的，直接删掉即可。
 *
 * ## 棘轮
 *
 * 存量很大，一次改完不现实，所以基线文件 `type-scale-baseline.json` 记下
 * 「今天已经有的违规」，只对新写的开闸。
 *
 * 基线按 **文件 + 写法 + 条数** 记账，不记行号：行号会因为任何一次编辑整体漂移，
 * 按行号记账会让「改上面一行」变成「下面多出 20 处违规」——那种守卫最后一定会被关掉。
 *
 *   node scripts/check-type-scale.mjs              # 检查（CI / 闸门）
 *   node scripts/check-type-scale.mjs --prune      # 把已修好的条数从基线里减掉（推荐）
 *   node scripts/check-type-scale.mjs --update     # 按现状重写整份基线（慎用）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
const BASELINE = path.resolve(process.cwd(), "scripts", "type-scale-baseline.json");

/** 六档阶梯。任意字号按最近的档位归并。 */
const SCALE = {
  10: "caption",
  "10.5": "caption",
  11: "caption",
  "11.5": "meta",
  12: "meta",
  "12.5": "ui",
  13: "ui",
  14: "body",
  15: "subtitle",
  17: "subtitle",
  22: "display",
};

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".tsx")) files.push(p);
  }
})(ROOT);

/** key: `kind|file|token` → { kind, file, token, hint, lines: number[] } */
const found = new Map();
const add = (kind, file, line, token, hint) => {
  const key = `${kind}|${file}|${token}`;
  const hit = found.get(key);
  if (hit) {
    hit.lines.push(line);
    return;
  }
  found.set(key, { kind, file, token, hint, lines: [line] });
};

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    // 只看类名字符串所在的行。
    if (!/className=|\bclass=/.test(line)) return;

    for (const m of line.matchAll(/text-\[([0-9.]+)(px|rem|em)\]/g)) {
      const raw = m[1];
      const unit = m[2];
      const hint = unit === "px"
        ? (SCALE[raw] ? `→ text-${SCALE[raw]}` : "→ 先决定它是 caption/meta/ui/body/subtitle/display 中的哪一档")
        : `→ 换成 px 档位（${unit} 会随父级字号漂移）`;
      add("fontSize", rel, n, m[0], hint);
    }

    if (/\btransition(-|\b)/.test(line) && !/\bduration-(fast|base|slow|[0-9]+\b)/.test(line)) {
      add("motion", rel, n, "transition", "→ 颜色/背景用 duration-fast ease-standard，位移用 duration-base ease-out-quint");
    }

    for (const m of line.matchAll(/shadow-(2xs|xs|sm|md|lg|xl|2xl|inner|\[[^\]]*\])/g)) {
      add("shadow", rel, n, m[0], "→ 玻璃面删掉（材质自带阴影）；其余用 elev-1/2/3");
    }
  });
}

const loadBaseline = () => {
  if (!fs.existsSync(BASELINE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch {
    return {};
  }
};

/** 基线结构：{ "kind|file|token": count } —— 一个扁平字典，读起来最省事。 */
const currentCounts = {};
for (const [key, v] of found) currentCounts[key] = v.lines.length;

const writeFile = (counts) => {
  fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`✓ 基线已写入 ${path.relative(process.cwd(), BASELINE)}（${total} 条）`);
};

if (process.argv.includes("--update")) {
  writeFile(currentCounts);
  process.exit(0);
}

const baseline = loadBaseline();

if (process.argv.includes("--prune")) {
  // 只准降：保留 min(基线, 现状)。
  const next = {};
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(currentCounts)])) {
    const allowed = baseline[key] ?? 0;
    const now = currentCounts[key] ?? 0;
    const keep = Math.min(allowed, now);
    if (keep > 0) next[key] = keep;
  }
  writeFile(next);
  process.exit(0);
}

const violations = [];
let known = 0;
for (const [key, v] of found) {
  const allowed = baseline[key] ?? 0;
  const excess = v.lines.length - allowed;
  if (excess <= 0) {
    known += v.lines.length;
    continue;
  }
  known += allowed;
  violations.push({ ...v, excess, allowed });
}

const stale = Object.entries(baseline)
  .map(([key, allowed]) => [key, allowed - (currentCounts[key] ?? 0)])
  .filter(([, over]) => over > 0);

if (violations.length === 0) {
  const staleNote = stale.length ? `；基线里有 ${stale.length} 处已修好，可 --prune 收敛` : "";
  console.log(`✓ 排版/动效/阴影守卫通过（存量 ${known} 条在基线内${staleNote}）`);
  process.exit(0);
}

const total = violations.reduce((a, v) => a + v.excess, 0);
console.error(`✗ 排版/动效/阴影守卫：新增 ${total} 处违规（存量 ${known} 条已在基线内）\n`);
for (const v of violations) {
  const where = v.excess === v.lines.length
    ? `${v.file}:${v.lines.slice(0, 3).join(",")}`
    : `${v.file}:${v.lines.slice(v.allowed).slice(0, 3).join(",")}`;
  console.error(`  ${where}  ${v.token}  ${v.hint}`);
}
console.error("\n档位：caption 11 / meta 12 / ui 13 / body 14 / subtitle 16 / display 22");
console.error("高度：elev-1（贴在页面上）/ elev-2（页面由它铺开）/ elev-3（浮在上面）");
process.exit(1);
