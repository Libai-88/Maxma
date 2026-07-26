/**
 * tools/index.ts — Maxma 自定义工具注册入口
 *
 * 当前为空：Maxma 作为 OMP 完全态 GUI，全部使用 OMP 原生工具，
 * 不再注册任何自定义工具。保留函数签名以兼容 session-bridge.ts 调用。
 */

import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

export function registerCustomTools(): ToolDefinition[] {
  return [];
}
