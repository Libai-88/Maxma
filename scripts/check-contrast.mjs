#!/usr/bin/env node
/**
 * scripts/check-contrast.mjs — 主题配色的 WCAG 对比度守卫。
 *
 * 为什么需要：浅色主题里 `--muted-foreground` 一直被当成"次要文字"到处用（页脚提示、
 * 说明句、表头注释）。这类颜色看起来只是"淡"，但淡到什么程度没有量；换个主题、
 * 换块玻璃背景，同一个 token 就可能从 4.9:1 掉到 3.2:1，而人眼在浅色上尤其迟钝。
 *
 * 做法：直接从 solid-glass.css 里读 token（不维护第二份色表），把 OKLCH 转成线性 sRGB，
 * 按 WCAG 2.1 相对亮度算比值。玻璃卡片的底色是半透明的，先按 alpha 与页面底色做
 * 合成再算，否则会拿"叠在后景上的结果"去比"没叠的颜色"。
 *
 * 门槛（正文与次要文字都按小字号处理，取 4.5:1）：
 *   - foreground        vs background  >= 7:1（主文字，留足余量）
 *   - muted-foreground  vs background  >= 4.5:1
 *   - muted-foreground  vs card（合成后）>= 4.5:1
 *
 * 退出码 0 = 全部达标；1 = 有项不达标或解析失败（不能让守卫静默空转）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(path.resolve(HERE, ".."), "web", "src", "solid-glass.css");

/** 从 CSS 里切出某个选择器块（够用即可：主题块都是单层、不含嵌套）。 */
function block(css, selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return null;
  const start = css.indexOf("{", idx);
  const end = css.indexOf("}", start);
  if (start < 0 || end < 0) return null;
  return css.slice(start + 1, end);
}

function token(blockText, name) {
  const m = blockText?.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** 解析 oklch(L C H [/ alpha]) 或 #rrggbb；返回线性 sRGB + alpha。 */
function parseColor(input) {
  if (!input) throw new Error("缺少颜色值");
  const hex = input.match(/^#([0-9a-f]{6})/i);
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
    return { r: srgbToLinear(r), g: srgbToLinear(g), b: srgbToLinear(b), a: 1 };
  }
  const m = input.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (!m) throw new Error(`无法解析颜色：${input}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  let a = 1;
  if (m[4]) a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);

  const A = L;
  const B = C * Math.cos(h);
  const D = C * Math.sin(h);
  const l_ = A + 0.3963377774 * B + 0.2158037573 * D;
  const m_ = A - 0.1055613458 * B - 0.0638541728 * D;
  const s_ = A - 0.0894841775 * B - 1.291485548 * D;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return { r: lin[0], g: lin[1], b: lin[2], a };
}

function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 把 alpha 前景合成到不透明背景上（玻璃卡片的真实观感）。 */
function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function checkTheme(css, label, selector, limits) {
  const b = block(css, selector);
  if (!b) throw new Error(`${label}：找不到选择器 ${selector}`);
  const bg = parseColor(token(b, "background"));
  const fg = parseColor(token(b, "foreground"));
  const muted = parseColor(token(b, "muted-foreground"));
  const cardRaw = parseColor(token(b, "card"));
  const secondaryRaw = parseColor(token(b, "secondary"));
  const secondaryFg = parseColor(token(b, "secondary-foreground"));
  const card = composite(cardRaw, bg);
  const secondary = composite(secondaryRaw, bg);

  const rows = [
    { what: "foreground vs background", value: contrast(fg, bg), min: limits.fgBg },
    { what: "muted vs background", value: contrast(muted, bg), min: limits.mutedBg },
    { what: "muted vs card", value: contrast(muted, card), min: limits.mutedBg },
    // 芯片/标签：bg-secondary 上常放 muted 文字（如「运行 14s」、分类标签）
    { what: "muted vs secondary", value: contrast(muted, secondary), min: limits.mutedBg },
    { what: "secondary-fg vs secondary", value: contrast(secondaryFg, secondary), min: limits.mutedBg },
  ];
  let fail = false;
  console.log(`\n${label}`);
  for (const r of rows) {
    const ok = r.value >= r.min;
    if (!ok) fail = true;
    console.log(`  ${ok ? "✓" : "✗"} ${r.what.padEnd(26)} ${r.value.toFixed(2)}:1  (门槛 ${r.min}:1)`);
  }
  return { fail, total: rows.length, passed: rows.filter((r) => r.value >= r.min).length };
}

let css;
try {
  css = fs.readFileSync(CSS, "utf8");
} catch (err) {
  console.error(`✗ 读不到 ${CSS}：${err.message}`);
  process.exit(1);
}

try {
  const light = checkTheme(css, "浅色（:root）", ":root", { fgBg: 7, mutedBg: 4.5 });
  const dark = checkTheme(css, "深色（.dark）", "\n.dark {", { fgBg: 7, mutedBg: 4.5 });
  if (light.fail || dark.fail) {
    console.error("\n✗ 有配色未达 WCAG 门槛");
    process.exit(1);
  }
  console.log(`\n✓ 浅色与深色的主文字 / 次要文字均达 WCAG 门槛（${light.passed + dark.passed}/${light.total + dark.total} 项）`);
  process.exit(0);
} catch (err) {
  console.error(`\n✗ 解析失败（守卫不能空转）：${err.message}`);
  process.exit(1);
}
