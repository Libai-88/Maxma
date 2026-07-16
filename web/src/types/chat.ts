/** Provider 模型信息 */
export interface ModelInfo {
  id: string
  provider: string
  name: string
  contextWindow: number
}

/** 上下文用量信息 */
export interface ContextUsage {
  estimatedTokens: number
  maxTokens: number
  percentage: number
  messageCount: number
  modelName: string
}
