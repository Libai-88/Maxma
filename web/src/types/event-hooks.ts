/**
 * Event Hooks 类型定义
 *
 * 用于 /event-hooks 系列接口：列表、详情、创建、更新、删除、触发历史。
 * 钩子配置（config）字段因 hook_type 不同而异，统一以 Record<string, unknown> 表达，
 * 由消费端按 hook_type 自行解析（参考 HooksView.vue 的 buildConfig / configSummary）。
 */

/** 钩子类型枚举（file_change / schedule / webhook） */
export type EventHookType = 'file_change' | 'schedule' | 'webhook'

/** 钩子运行状态 */
export type EventHookStatus = 'active' | 'paused' | 'error' | string

/** 事件钩子完整记录（列表/详情/创建/更新响应中的 hook 字段） */
export interface EventHook {
  hook_id: string
  name: string
  hook_type: EventHookType
  /** 配置对象：file_change 含 path/patterns/ignore_patterns；schedule 含 interval；webhook 为空对象 */
  config: Record<string, unknown>
  /** Agent 应执行的动作描述 */
  action: string
  status: EventHookStatus
  enabled: boolean
  created_at: number
  last_triggered: number
  trigger_count: number
}

/** 钩子触发历史记录条目 */
export interface EventHookHistoryEntry {
  trigger_id: string
  hook_id: string
  timestamp: number
  trigger_type: string
  trigger_detail: string
  status: string
  result: string
}

/**
 * 创建钩子请求体。
 *
 * 注意：hook_type 字段在响应中是严格 EventHookType 联合，但请求体放宽为 string，
 * 因为消费端（HooksView.vue）的 form.hook_type 推断为 string 而非字面量联合；
 * 后端会做枚举校验，前端类型放宽不影响安全性。
 */
export interface EventHookCreateBody {
  name: string
  hook_type: EventHookType | string
  config: Record<string, unknown>
  action: string
}

/** 更新钩子请求体（部分字段可选）。hook_type 同样放宽为 string，理由同 EventHookCreateBody。 */
export interface EventHookUpdateBody {
  name?: string
  hook_type?: EventHookType | string
  config?: Record<string, unknown>
  action?: string
  enabled?: boolean
}

/** 列表响应 */
export interface ListEventHooksResponse {
  hooks: EventHook[]
}

/** 触发历史响应 */
export interface EventHookHistoryResponse {
  history: EventHookHistoryEntry[]
}

/** 创建/更新钩子响应 */
export interface EventHookMutationResponse {
  status: string
  hook: EventHook
}
