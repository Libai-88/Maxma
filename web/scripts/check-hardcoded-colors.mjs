/**
 * check-hardcoded-colors.mjs — Solid Glass 语义色守卫（React/TSX 版）。
 *
 * Fails (exit 1) when a .tsx file under src/ (excluding components/ui/ 框架源码)
 * carries a color that bypasses the theme tokens:
 *   1. 硬编码 hex / oklch( / rgb(a)(  字面量（CSS 变量兜底 var(--x, #hex) 除外）
 *   2. 非语义 Tailwind 调色板类（bg-red-500 / text-emerald-300 之类）
 *
 * 语义类（bg-card / text-muted-foreground / border-border / bg-destructive /
 * text-status-done 等）由 solid-glass.css 的 @theme 变量驱动，是唯一允许的用法。
 *
 * Usage: node scripts/check-hardcoded-colors.mjs   (exit 0 = clean)
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
// 框架源码（shadcn / Solid Glass）自带材质与调色板，是唯一事实源，豁免。
const EXEMPT_PREFIXES = ["components/ui/", "components/common/Markdown.tsx"];
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\([^)]*\)/g;
// Tailwind 默认调色板类（非语义）：bg-red-500、text-emerald-300/80 等。
const PALETTE_CLASS_RE = /(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}/g;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "assets" || e.name === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Mask the sanctioned forms so the regexes only see violations. */
function sanitize(line) {
  let s = line;
  if (s.includes("${")) return "";           // dynamic template
  if (s.includes("solid-glass")) return "";  // framework references
  s = s.replace(/var\(--[\w-]+(?:,[^)]*)?\)/g, ""); // CSS var + fallback
  s = s.replace(/--[a-zA-Z-]+\s*:\s*[^;]+;?/g, ""); // custom property definitions
  s = s.replace(/\/\/.*$/g, "");             // line comments
  s = s.replace(/console\.[a-z]+\([^;]*/g, ""); // dev logging
  return s;
}

const files = walk(ROOT);
let violations = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (EXEMPT_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const clean = sanitize(line);
    const hits = [...(clean.match(COLOR_RE) ?? []), ...(clean.match(PALETTE_CLASS_RE) ?? [])];
    if (hits.length > 0) {
      violations++;
      console.log(`${rel}:${i + 1}: ${hits.join(" ")}`);
    }
  });
}

if (violations > 0) {
  console.error(`\n✗ ${violations} hardcoded color(s) found — use Solid Glass semantic tokens (docs/brand-guidelines.md).`);
  process.exit(1);
} else {
  console.log(`✓ No hardcoded colors in ${files.length} TSX files.`);
}
