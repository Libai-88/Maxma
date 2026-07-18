/** Provider 模型信息 */
export interface ModelInfo {
  id: string
  provider: string
  name: string
  contextWindow: number
}

/** 上下文用量信息（UI camelCase 格式，区别于 API 的 snake_case 版本） */
export interface ChatContextUsage {
  estimatedTokens: number
  maxTokens: number
  percentage: number
  messageCount: number
  modelName: string
}
