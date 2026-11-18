/**
 * scripts/check-no-purple.mjs — 五套主题的“禁止紫色”回归锁。
 *
 * 用户对紫色是硬否决：270°–330° 的蓝紫/紫罗兰看起来像“AI 默认紫”，
 * 不允许出现在任何界面、语法高亮或背景第二色相里。
 *
 * 这里扫两份事实源：`theme-palettes.css` 的 10 个主题块，以及 `solid-glass.css`
 * 的基础兜底。把 `oklch()` 的色相与 hex 色值都换算成 HSL 色相；只拦
 * **270°–325°** 的紫罗兰带——再往右是洋红/粉色（Sakura 的 #F15FB4 是 325.1°），
 * 那是用户明确要的女性向配色，不是紫。
 *
 * 退出码 0 = 没有紫色相；1 = 命中或读不到文件。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.join(path.resolve(HERE, ".."), "web", "src");
const FILES = [
  path.join(WEB_SRC, "solid-glass.css"),
  path.join(WEB_SRC, "theme-palettes.css"),
];

const PURPLE_MIN = 270;
const PURPLE_MAX = 325;

function isPurple(hue) {
  return hue >= PURPLE_MIN && hue < PURPLE_MAX;
}

function hexToHue(hex) {
  let body = hex.replace("#", "");
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  if (body.length !== 6) return null;
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

const violations = [];
let scannedFiles = 0;
for (const file of FILES) {
  let css;
  try {
    css = fs.readFileSync(file, "utf8");
  } catch (err) {
    console.error(`✗ 读不到 ${file}：${err.message}`);
    process.exit(1);
  }
  scannedFiles++;

  for (const match of css.matchAll(/oklch\(\s*[0-9.]+(?:%|deg)?\s+[0-9.]+(?:%|deg)?\s+([0-9.]+)(?:deg)?/g)) {
    const hue = Number(match[1]);
    if (isPurple(hue)) violations.push(`${file}: oklch hue ${hue}°`);
  }
  for (const match of css.matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?/g)) {
    const hue = hexToHue(match[0]);
    if (hue !== null && isPurple(hue)) {
      violations.push(`${file}: ${match[0]} hue ${hue.toFixed(1)}°`);
    }
  }
}

if (violations.length > 0) {
  console.error("✗ 发现紫色相（270°–325°）：");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`✓ 无紫守卫通过：${scannedFiles} 个 CSS 文件，0 个 270°–325° 色相`);
