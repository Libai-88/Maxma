/**
 * config-settings.ts — 全局配置读取（config/settings.py 的 Bun 等价子集，
 * 阶段二 2.5）。
 *
 * pydantic BaseSettings 语义：字段默认值 + .env 文件 + 环境变量覆盖。
 * Bun 后端仅需迁移 health/capabilities/CORS 实际消费的字段：
 *   maxma_api_port(8000) / maxma_web_port(5173) / think_path_enabled(False)
 *   / provider_diagnostics_enabled(False)
 *
 * ⚠️ 每次调用重读（.env 可能变更；对齐 Python reload_settings 语义）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { dataDir } from "./app-paths";

/** 解析 .env 文本为 key→value（key 归一为大写——pydantic-settings 默认大小写不敏感）。 */
function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function envFileValues(): Record<string, string> {
  const file = path.join(dataDir(), ".env");
  try {
    if (!fs.existsSync(file)) return {};
    return parseDotEnv(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** 取值优先级：process.env → .env → 默认值（对齐 pydantic-settings 大小写不敏感）。 */
function readStr(key: string, fileValues: Record<string, string>): string | undefined {
  const upper = key.toUpperCase();
  // POSIX 下 process.env 大小写敏感：检查大写与小写两种拼法
  const fromEnv = process.env[upper] ?? process.env[key.toLowerCase()];
  return fromEnv ?? fileValues[upper];
}

function readBool(key: string, fileValues: Record<string, string>, dflt: boolean): boolean {
  const raw = readStr(key, fileValues);
  if (raw === undefined) return dflt;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return dflt;
}

function readInt(key: string, fileValues: Record<string, string>, dflt: number): number {
  const raw = readStr(key, fileValues);
  if (raw === undefined) return dflt;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

export interface AppSettings {
  maxma_api_port: number;
  maxma_web_port: number;
  think_path_enabled: boolean;
  provider_diagnostics_enabled: boolean;
}

/** 读取全局配置（每次调用重读 .env/env，惰性 getter 语义对齐 app-paths）。 */
export function getAppSettings(): AppSettings {
  const fileValues = envFileValues();
  return {
    // env 名 = 字段名大写（pydantic-settings 默认大小写不敏感匹配）
    maxma_api_port: readInt("MAXMA_API_PORT", fileValues, 8000),
    maxma_web_port: readInt("MAXMA_WEB_PORT", fileValues, 5173),
    think_path_enabled: readBool("THINK_PATH_ENABLED", fileValues, false),
    provider_diagnostics_enabled: readBool("PROVIDER_DIAGNOSTICS_ENABLED", fileValues, false),
  };
}
