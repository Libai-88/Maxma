/** Provider 模型信息 */
export interface ModelInfo {
  id: string
  provider: string
  providerLabel?: string
  name: string
  displayName?: string
  contextWindow: number
  /** 来源：缺省为 providers.yaml 里配置的渠道；`plugin` 表示由插件（Jet Hub）提供。 */
  source?: 'plugin'
}

/** 上下文用量信息（UI camelCase 格式，区别于 API 的 snake_case 版本） */
export interface ChatContextUsage {
  estimatedTokens: number
  maxTokens: number
  percentage: number
  messageCount: number
  modelName: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cacheHitRate?: number | null
  outputSpeed?: number
  latencyMs?: number
}
