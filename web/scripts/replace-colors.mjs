/**
 * replace-colors.mjs — tokenize hardcoded colors in Vue components.
 *
 * Scope: src/components + src/views .vue files (excludes themes/, assets/styles).
 * Rules (ordered, context-aware):
 *   R1. CSS var fallback `var(--x, #hex)` is EXEMPT (theme is the source of truth,
 *       fallback is a degradation guard).
 *   R2. `color: #fff` (foreground on accent/danger) → var(--text-inverse).
 *   R3. `background: #fff` (solid white surface) → var(--bg-raised).
 *   R4. #hex inside color-mix(..., #hex) → var(--text-inverse).
 *   R5. Known destructive reds as solid backgrounds → var(--status-error).
 *   R6. Tailwind gray text colors → theme text tokens.
 *
 * Usage: node scripts/replace-colors.mjs [--dry-run]
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
const DRY = process.argv.includes("--dry-run");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "themes" || e.name === "assets") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".vue")) {
      out.push(p);
    }
  }
  return out;
}

/** Replace a full matched color token, keeping surrounding text. */
function replaceColor(line) {
  let changed = false;
  let out = line;

  // R1: protect var(...) fallbacks by masking them
  const fallbacks = [];
  out = out.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, (m) => {
    fallbacks.push(m);
    return `\u0000FB${fallbacks.length - 1}\u0000`;
  });

  // R2: color: #fff → text-inverse (foreground white)
  out = out.replace(/color:\s*#fff\b/gi, "color: var(--text-inverse)");

  // R3: background: #fff → bg-raised (solid white surface)
  out = out.replace(/background:\s*#fff\b/gi, "background: var(--bg-raised)");

  // R4: color-mix tail #fff → text-inverse
  out = out.replace(/color-mix\(([^)]*?),\s*#fff\s*\)/gi, "color-mix($1, var(--text-inverse))");

  // R5: destructive reds as solid values → status-error
  out = out.replace(/#b42318\b/gi, "var(--status-error)");
  out = out.replace(/#dc2626\b/gi, "var(--status-error)");

  // R6: Tailwind gray text tokens (context: color: / fill: / stroke:)
  const grayMap = {
    "#9ca3af": "var(--text-tertiary)",
    "#6b7280": "var(--text-tertiary)",
    "#1f2937": "var(--text-primary)",
    "#374151": "var(--text-secondary)",
    "#4b5563": "var(--text-secondary)",
    "#111827": "var(--text-primary)",
    "#333": "var(--text-primary)",
    "#999": "var(--text-tertiary)",
    "#666": "var(--text-secondary)",
  };
  for (const [hex, token] of Object.entries(grayMap)) {
    const re = new RegExp(`(color|fill|stroke):\\s*${hex}\\b`, "gi");
    out = out.replace(re, `$1: ${token}`);
  }

  // R7: status palette → theme status tokens (any property)
  const statusMap = {
    "#ef4444": "var(--status-error)",
    "#dc2626": "var(--status-error)",
    "#e5484d": "var(--status-error)",
    "#b42318": "var(--status-error)",
    "#22c55e": "var(--status-ok)",
    "#16a34a": "var(--status-ok)",
    "#10b981": "var(--status-ok)",
    "#f59e0b": "var(--status-warn)",
    "#eab308": "var(--status-warn)",
    "#ffa117": "var(--status-warn)",
    "#3b82f6": "var(--status-info)",
    "#6366f1": "var(--status-info)",
  };
  for (const [hex, token] of Object.entries(statusMap)) {
    // \b 在 # 前后不成立（# 非词字符），用十六进制后瞻防误伤 #ef444400 之类
    const re = new RegExp(`${hex}(?![0-9a-fA-F])`, "gi");
    out = out.replace(re, token);
  }

  // R8: translucent status backgrounds → color-mix derivations
  const statusBgMap = [
    // red (status-error) — both compact & spaced variants
    ["rgba(239,68,68,0.1)", "color-mix(in srgb, var(--status-error) 10%, transparent)"],
    ["rgba(239, 68, 68, 0.1)", "color-mix(in srgb, var(--status-error) 10%, transparent)"],
    ["rgba(239,68,68,0.15)", "color-mix(in srgb, var(--status-error) 15%, transparent)"],
    ["rgba(239,68,68,0.3)", "color-mix(in srgb, var(--status-error) 30%, transparent)"],
    ["rgba(239, 68, 68, 0.3)", "color-mix(in srgb, var(--status-error) 30%, transparent)"],
    ["rgba(239,68,68,0.08)", "color-mix(in srgb, var(--status-error) 8%, transparent)"],
    ["rgba(239, 68, 68, 0.08)", "color-mix(in srgb, var(--status-error) 8%, transparent)"],
    // amber (status-warn)
    ["rgba(245,158,11,0.1)", "color-mix(in srgb, var(--status-warn) 10%, transparent)"],
    ["rgba(245, 158, 11, 0.1)", "color-mix(in srgb, var(--status-warn) 10%, transparent)"],
    ["rgba(245,158,11,0.06)", "color-mix(in srgb, var(--status-warn) 6%, transparent)"],
    ["rgba(245,158,11,0.2)", "color-mix(in srgb, var(--status-warn) 20%, transparent)"],
    ["rgba(245,158,11,0.08)", "color-mix(in srgb, var(--status-warn) 8%, transparent)"],
    // blue (status-info)
    ["rgba(59,130,246,0.1)", "color-mix(in srgb, var(--status-info) 10%, transparent)"],
    ["rgba(59, 130, 246, 0.1)", "color-mix(in srgb, var(--status-info) 10%, transparent)"],
    // green (status-ok)
    ["rgba(16,185,129,0.1)", "color-mix(in srgb, var(--status-ok) 10%, transparent)"],
    ["rgba(16, 185, 129, 0.1)", "color-mix(in srgb, var(--status-ok) 10%, transparent)"],
    ["rgba(34,197,94,0.1)", "color-mix(in srgb, var(--status-ok) 10%, transparent)"],
    ["rgba(34,197,94,0.08)", "color-mix(in srgb, var(--status-ok) 8%, transparent)"],
    ["rgba(34,197,94,0.15)", "color-mix(in srgb, var(--status-ok) 15%, transparent)"],
    // green-scale literal RGB (legacy success tints)
    ["rgba(90, 130, 75, 0.3)", "color-mix(in srgb, var(--status-ok) 30%, transparent)"],
    ["rgba(85, 125, 70, 0.2)", "color-mix(in srgb, var(--status-ok) 20%, transparent)"],
    ["rgba(80, 120, 70, 0.4)", "color-mix(in srgb, var(--status-ok) 40%, transparent)"],
    ["rgba(80, 120, 65, 0.2)", "color-mix(in srgb, var(--status-ok) 20%, transparent)"],
    ["rgba(75, 115, 65, 0.25)", "color-mix(in srgb, var(--status-ok) 25%, transparent)"],
    ["rgba(70, 110, 60, 0.3)", "color-mix(in srgb, var(--status-ok) 30%, transparent)"],
    ["rgba(60, 100, 50, 0.35)", "color-mix(in srgb, var(--status-ok) 35%, transparent)"],
    // ink overlays (text-primary alpha)
    ["rgba(0, 0, 0, 0.5)", "color-mix(in srgb, var(--text-primary) 50%, transparent)"],
    ["rgba(0,0,0,0.5)", "color-mix(in srgb, var(--text-primary) 50%, transparent)"],
    ["rgba(0, 0, 0, 0.4)", "color-mix(in srgb, var(--text-primary) 40%, transparent)"],
    ["rgba(0,0,0,0.15)", "color-mix(in srgb, var(--text-primary) 15%, transparent)"],
    ["rgba(0, 0, 0, 0.15)", "color-mix(in srgb, var(--text-primary) 15%, transparent)"],
    ["rgba(0, 0, 0, 0.03)", "color-mix(in srgb, var(--text-primary) 3%, transparent)"],
    ["rgba(0, 0, 0, 0.08)", "color-mix(in srgb, var(--text-primary) 8%, transparent)"],
    ["rgba(30, 30, 30, 0.85)", "color-mix(in srgb, var(--text-primary) 85%, transparent)"],
    // white overlays (text-inverse alpha)
    ["rgba(255, 255, 255, 0.08)", "color-mix(in srgb, var(--text-inverse) 8%, transparent)"],
    ["rgba(255, 255, 255, 0.2)", "color-mix(in srgb, var(--text-inverse) 20%, transparent)"],
    ["rgba(255,255,255,0.12)", "color-mix(in srgb, var(--text-inverse) 12%, transparent)"],
    ["rgba(255, 255, 255, 0.12)", "color-mix(in srgb, var(--text-inverse) 12%, transparent)"],
    ["rgba(255, 255, 255, 0.7)", "color-mix(in srgb, var(--text-inverse) 70%, transparent)"],
    ["rgba(255, 255, 255, 0.18)", "color-mix(in srgb, var(--text-inverse) 18%, transparent)"],
    ["rgba(255, 255, 255, 0.05)", "color-mix(in srgb, var(--text-inverse) 5%, transparent)"],
    ["rgba(255, 253, 247, 0.12)", "color-mix(in srgb, var(--bg-raised) 12%, transparent)"],
    ["rgba(255, 245, 230, 0.18)", "color-mix(in srgb, var(--status-warn) 18%, transparent)"],
  ];
  for (const [old, replacement] of statusBgMap) {
    out = out.split(old).join(replacement);
  }

  // restore fallbacks
  out = out.replace(/\u0000FB(\d+)\u0000/g, (_, i) => fallbacks[Number(i)]);
  return { out, changed: out !== line };
}

const files = walk(ROOT);
let totalChanges = 0;
const report = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  let fileChanges = 0;
  for (let i = 0; i < lines.length; i++) {
    const { out, changed } = replaceColor(lines[i]);
    if (changed) {
      lines[i] = out;
      fileChanges++;
      totalChanges++;
      report.push(`${path.relative(ROOT, file)}:${i + 1}`);
    }
  }
  if (!DRY && fileChanges > 0) {
    fs.writeFileSync(file, lines.join("\n"), "utf8");
  }
}
console.log(`Scanned ${files.length} files. ${DRY ? "[dry-run] " : ""}changes: ${totalChanges}`);
if (report.length > 0) {
  console.log("Changed lines (first 40):");
  for (const r of report.slice(0, 40)) console.log("  " + r);
}
