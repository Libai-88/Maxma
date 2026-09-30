/**
 * app-paths.ts — 路径解析（api/app_paths.py 的 Bun 直译，阶段二 2.0）。
 *
 * 与 Python 版保持同一套目录语义，保证灰度期两端读写同一批数据文件：
 *   开发模式：BUNDLE_DIR = DATA_DIR = 项目根目录
 *   便携模式：可执行文件旁 data/（需 portable.flag）
 *   标准打包：%APPDATA%/MaxmaHere
 *
 * ⚠️ 全部路径导出为**惰性 getter**（每次调用读 env）——测试隔离（per-test
 * 临时数据目录）与运行时 env 变更都依赖这一点；不要缓存返回值。
 * 阶段二打包形态为 Bun 单文件可执行（无 PyInstaller _MEIPASS）。
 */

import * as path from "node:path";
import * as fs from "node:fs";

export const PORTABLE_FLAG_FILENAME = "portable.flag";

/** 打包资源根目录（只读）。开发模式 = 项目根。 */
export function bundleDir(): string {
  return path.resolve(process.env.MAXMA_BUNDLE_DIR ?? path.join(import.meta.dir, "..", ".."));
}

function checkPortable(): boolean {
  try {
    const exeDir = process.env.MAXMA_EXE_DIR;
    if (!exeDir) return false;
    return fs.existsSync(path.join(exeDir, PORTABLE_FLAG_FILENAME));
  } catch {
    return false;
  }
}

/** 用户数据根目录（可写）。 */
export function dataDir(): string {
  if (process.env.MAXMA_DATA_DIR) return path.resolve(process.env.MAXMA_DATA_DIR);
  const exeDir = process.env.MAXMA_EXE_DIR;
  if (exeDir && checkPortable()) {
    return path.join(path.resolve(exeDir), "data");
  }
  // 开发模式：数据就在项目根目录
  return bundleDir();
}

export function isPortable(): boolean {
  return checkPortable();
}

// ── 常用子路径快捷方式（与 Python 版同名同义，惰性） ──

/** 打包资源（只读） */
export const getWebDistDir = (): string => path.join(bundleDir(), "web", "dist");
export const getMacrosDir = (): string => path.join(bundleDir(), "macros");
export const getConfigDir = (): string => path.join(bundleDir(), "config");
export const getPersonasDir = (): string => path.join(getConfigDir(), "personas");

/** 用户数据（可写） */
export const getPersonasDataDir = (): string => path.join(dataDir(), "config", "personas");
export const getMacrosDataDir = (): string => path.join(dataDir(), "macros");
export const getApiDataDir = (): string => path.join(dataDir(), "api", "data");
export const getLogsDir = (): string => path.join(dataDir(), "logs");
export const getUploadsDir = (): string => path.join(dataDir(), "uploads");
export const getVectorDbDir = (): string => path.join(dataDir(), "vector_db");

/** news.yaml（与 Python NEWS_YAML_PATH 一致）。 */
export const getNewsYamlPath = (): string => path.join(getApiDataDir(), "news.yaml");
/** 引导状态文件（与 Python ONBOARDING_STATE_PATH 一致）。 */
export const getOnboardingStatePath = (): string => path.join(dataDir(), "config", "onboarding.json");
