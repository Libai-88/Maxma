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
    total_tokens_in: number
    total_tokens_out: number
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
    http: Record<string, any>
    tools: Record<string, any>
    llm: Record<string, any>
    errors: Record<string, any>
  }>
}
