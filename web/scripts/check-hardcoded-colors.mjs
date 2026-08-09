/**
 * check-hardcoded-colors.mjs — brand-token guard for Vue components.
 *
 * Fails (exit 1) when a .vue file under src/ (excluding themes/, assets/)
 * contains a hardcoded color that is NOT one of the sanctioned forms:
 *   1. CSS var fallback         var(--x, #hex)
 *   2. CSS custom property def  --x: #hex;   (token definition — the sanctioned way)
 *   3. Dynamic template         rgba(${...}) / color containing ${}
 *   4. IconCloud technology brand colors (semantic data, not UI theme)
 *   5. console.* logging colors (dev diagnostics, not UI)
 *   6. JS getComputedStyle fallback  `|| '#hex'` / `?? '#hex'`
 *   7. @keyframes / animation color stops are allowed (color-mix cannot express them)
 *
 * Usage: node scripts/check-hardcoded-colors.mjs   (exit 0 = clean)
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "src");
// Known technical debt (tracked in maxma-deep-optimization-plan.md S1-2):
//  - components/inspira/: third-party decorative FX components whose palette is
//    the effect itself; needs designer-led 6-theme token contract extension.
//  - components/AnimatedCircularProgressBar.vue: JS-computed colors rendered to
//    canvas/SVG where CSS variables cannot be resolved.
const EXEMPT_PREFIXES = ["components/inspira/", "components/FluidBackground.vue", "components/LiquidBackground.vue", "components/IconCloud.vue", "components/AnimatedCircularProgressBar.vue", "views/OnboardingView.vue", "components/SingularityBackground.vue", "components/TextGlitch.vue"];
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|rgb\([^)]*\)/g;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "themes" || e.name === "assets" || e.name === "node_modules") continue;
      out.push(...walk(p));
    } else if (e.name.endsWith(".vue")) out.push(p);
  }
  return out;
}

/** Mask the sanctioned forms so COLOR_RE only sees violations. */
function sanitize(line) {
  let s = line;
  // 0. Whole-line exemption for dynamic template interpolation (${...})
  if (s.includes("${")) return "";
  // 1. CSS var fallback
  s = s.replace(/var\(--[\w-]+,[^)]*\)/g, "");
  // 2. CSS custom property definition
  s = s.replace(/--[\w-]+\s*:\s*/g, "");
  // 3. dynamic template interpolation (${...})
  s = s.replace(/\$\{[^}]*\}/g, "");
  // 5. console.* logging color strings
  s = s.replace(/console\.(log|group|warn|error)[^;]*/g, "");
  // 6. JS getComputedStyle fallback (`|| '#hex'` / `?? '#hex'`)
  s = s.replace(/(\|\||\?\?)\s*'#[0-9a-fA-F]{3,8}'/g, "");
  s = s.replace(/(\|\||\?\?)\s*"#[0-9a-fA-F]{3,8}"/g, "");
  // 7. HTML entities like &#9776; (menu glyphs) — not colors
  s = s.replace(/&#\d+;/g, "");
  return s;
}

const files = walk(ROOT);
let violations = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (EXEMPT_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const matches = sanitize(line).match(COLOR_RE);
    if (matches && matches.length > 0) {
      violations++;
      console.log(`${rel}:${i + 1}: ${matches.join(" ")}`);
    }
  });
}

if (violations > 0) {
  console.error(`\n✗ ${violations} hardcoded color(s) found — use theme tokens (docs/brand-guidelines.md).`);
  process.exit(1);
} else {
  console.log(`✓ No hardcoded colors in ${files.length} Vue files.`);
}
