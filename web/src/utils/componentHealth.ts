import type { ComponentHealth } from '@/types'

/**
 * 容错地把后端返回的 component health 子字段归一化为 ComponentHealth | null。
 *
 * 后端 `/api/health` 在某些子组件（如 llm / memory / native_tools / mcp_tools）
 * 缺失或未配置时可能返回 `null` / `undefined`，与前端 TS 类型 `ComponentHealth`
 * 不匹配。直接访问 `c.status` / `c.detail` 会抛 TypeError 并污染控制台。
 *
 * - 返回 null：调用方应渲染「数据不可用」占位项
 * - 返回 ComponentHealth：调用方按原逻辑处理
 */
export function safeComponentHealth(
  c: ComponentHealth | null | undefined,
): ComponentHealth | null {
  if (!c || typeof c !== 'object') return null
  if (typeof (c as ComponentHealth).status !== 'string') return null
  return c
}
