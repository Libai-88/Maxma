/**
 * app-version.ts — 应用版本号单一数据源（Python version.py 的读取，2.5b）。
 *
 * version.py 是仓库内所有"版本"表述的单一数据源（`__version__ = "v2.6.11"`）。
 * Bun 后端不复制该常量，直接解析读取，保证与 Python 版逐字节一致；读取失败
 * 回退 "unknown"。结果按 bundleDir 缓存（开发期文件不变，无需重读）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { bundleDir } from "./app-paths";

let cacheKey = "";
let cacheValue = "unknown";

export function appVersion(): string {
  const file = path.join(bundleDir(), "version.py");
  if (cacheKey === file && cacheValue !== "unknown") return cacheValue;
  try {
    const text = fs.readFileSync(file, "utf8");
    const m = text.match(/__version__\s*=\s*["']([^"']+)["']/);
    cacheValue = m ? m[1]! : "unknown";
  } catch {
    cacheValue = "unknown";
  }
  cacheKey = file;
  return cacheValue;
}
