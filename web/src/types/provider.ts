/**
 * Provider（模型供应商）类型定义
 *
 * 本文件是 Provider 类型的源头（real definitions），types/index.ts 通过
 * `export * from './provider'` 聚合再导出，保证 `import { X } from '@/types'` 向后兼容。
 */

// === 提供商管理 ===

export interface ProviderConfig {
  id: string
  provider_type: string
  label: string
  api_key: string
  base_url: string
  models: string[]
  enabled: boolean
  context_window?: number
  // 阶段 3.3：优先级（数字越小优先级越高，0 = 最高），用于 fallback 排序
  priority?: number
  // 阶段 3.3：运行时健康状态（由后台 health_monitor 维护，未持久化）
  health_status?: 'ok' | 'degraded' | 'error' | 'unknown'
  health_detail?: string | null
  health_latency_ms?: number | null
  health_reason_code?: string | null
  health_retry_at?: number | null
  health_updated_at?: number | null
  health_summary?: string | null
  last_check_time?: number
  consecutive_failures?: number
}

export interface ListProvidersResponse {
  providers: ProviderConfig[]
}

export interface TestConnectionResponse {
  status: 'ok' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  retry_at?: number | null
  updated_at?: number | null
  summary?: string | null
}

// 阶段 3.3：按需健康检查响应（POST /providers/{id}/health）
export interface ProviderHealthCheckResponse {
  status: 'ok' | 'degraded' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  retry_at?: number | null
  updated_at?: number | null
  summary?: string | null
  last_check_time: number
  consecutive_failures: number
}

export interface DiscoverModelsResponse {
  models: string[]
}
