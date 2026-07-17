/**
 * Provider（模型供应商）类型定义
 *
 * 注意：以下类型原本定义在 types/index.ts 中并被多处消费，
 * 为避免大规模迁移带来的回归风险，这里仅以 re-export 形式集中暴露。
 * 新代码应优先从本文件导入 provider 相关类型，types/index.ts 仍保留导出以向后兼容。
 */

export type {
  ProviderConfig,
  ListProvidersResponse,
  TestConnectionResponse,
  ProviderHealthCheckResponse,
  DiscoverModelsResponse,
} from './index'
