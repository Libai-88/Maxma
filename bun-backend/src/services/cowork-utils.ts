/** Cowork 运行器的纯工具函数：事件 payload 归一化与路径边界判断。 */

import * as path from "node:path";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
