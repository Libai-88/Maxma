/**
 * extensions-config.ts — 用户扩展禁用清单的持久化（EXT-TOGGLE-001）。
 *
 * 存 `api/data/disabled_extensions.json`（与其它用户数据同一根，随包走）：
 *
 *   { "disabled": ["hello.ts", "team/tool.ts"] }
 *
 * 值是**相对 `<agentDir>/extensions` 的 posix 路径**（与 kernel/extensions.ts
 * 的 `extensionIdentity` 一致），不是绝对路径——绝对路径会让同一份配置在换机、
 * 换用户目录后全部失效。
 *
 * 只接受"看起来像用户扩展文件"的 id：绝对路径、`..`、`<inline:…>`/`builtin:…`
 * 一律拒绝。这样即便前端被改坏，也写不进能影响 Maxma 内联安全扩展的条目。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "./app-paths";

export function disabledExtensionsPath(): string {
  return path.join(getApiDataDir(), "disabled_extensions.json");
}

const EXTENSION_FILE_RE = /\.(ts|js|mts|cts|cjs|mjs)$/i;

/** id 是否是一个合法的"用户扩展相对路径"。 */
export function isValidExtensionId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (path.isAbsolute(trimmed)) return false;
  if (/^<|^builtin:/i.test(trimmed)) return false;
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((p) => p === ".." || p === ".")) return false;
  return EXTENSION_FILE_RE.test(parts[parts.length - 1]!);
}

/** 读取禁用清单。文件缺失/损坏按"没有禁用"处理（不阻断启动），只留日志。 */
export function readDisabledExtensions(): string[] {
  const file = disabledExtensionsPath();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { disabled?: unknown } | null)?.disabled;
    if (!Array.isArray(list)) {
      console.warn(`[extensions] ${file} 结构异常（缺少 disabled 数组），按无禁用处理`);
      return [];
    }
    return [...new Set(list.filter(isValidExtensionId).map((id) => id.split(/[\\/]+/).join("/")))];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[extensions] 读取 ${file} 失败: ${String(error)}`);
    }
    return [];
  }
}

/** 写入禁用清单（排序后落盘，便于 diff 与人工核对）。 */
export function writeDisabledExtensions(ids: string[]): string[] {
  const normalized = [...new Set(ids.filter(isValidExtensionId).map((id) => id.split(/[\\/]+/).join("/")))].sort();
  const file = disabledExtensionsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ disabled: normalized }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
  return normalized;
}

/** 单条启用/禁用，返回写入后的清单。 */
export function setExtensionEnabled(id: string, enabled: boolean): string[] {
  if (!isValidExtensionId(id)) {
    throw Object.assign(new Error("扩展 id 不合法：只接受 extensions 目录下的相对路径"), { status: 400 });
  }
  const normalized = id.split(/[\\/]+/).join("/");
  const current = readDisabledExtensions();
  const next = enabled
    ? current.filter((item) => item !== normalized)
    : [...current, normalized];
  return writeDisabledExtensions(next);
}
