/** 运行时指标（Metrics）类型定义 */

export interface MetricsHistogram {
  count: number
  avg_ms: number
  min_ms: number
  max_ms: number
}

export interface MetricsSnapshot {
  uptime_seconds: number
  http: {
    total_requests: number
    status_codes: Record<string, number>
    latency_ms: MetricsHistogram
    top_paths: Record<string, MetricsHistogram>
  }
  tools: {
    total_calls: number
    total_errors: number
    by_tool: Record<string, {
      count: number
      errors?: number
      latency?: MetricsHistogram
    }>
  }
  llm: {
    total_calls: number
    estimated_usage_calls?: number
    reported_usage_calls?: number
    partial_usage_calls?: number
    missing_usage_calls?: number
    cache_warm_calls?: number
    cache_unobserved_calls?: number
    total_tokens_in: number
    total_tokens_out: number
    cache_read_tokens: number
    cache_write_tokens: number
    cache_hit_rate: number | null
    latency_ms: MetricsHistogram
    by_model: Record<string, number>
  }
  errors: Record<string, number>
}

export interface MetricsHistoryResponse {
  window_seconds: number
  snapshots: Array<{
    timestamp: string
    uptime_seconds: number
    http: { total_requests?: number; [key: string]: unknown }
    tools: { total_calls?: number; [key: string]: unknown }
    llm: { total_tokens_out?: number; [key: string]: unknown }
    errors: Record<string, number>
  }>
}

/** 账本中单条模型请求（`llm_usage_calls` 一行）。字段与后端 LlmUsageCallRow 同名。 */
export interface LlmUsageCall {
  id: string
  session_id: string
  turn_id: string | null
  request_index: number | null
  kind: 'model_request' | 'cache_warm'
  usage_source: string
  provider: string | null
  model: string | null
  occurred_at: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  cache_observation_status: 'observed' | 'unknown'
  usage_status: 'reported' | 'partial' | 'missing'
  cost_total: number | null
  cost_status: 'catalog_estimate' | 'unknown'
}

/** `/api/metrics/llm-usage` 响应：聚合 + 最近请求。 */
export interface LlmUsageResponse {
  window_seconds: number
  calls?: number
  total_tokens_in?: number
  total_tokens_out?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  cache_hit_rate?: number | null
  cache_warm_calls?: number
  by_model?: Record<string, unknown>
  recent_calls: LlmUsageCall[]
}
