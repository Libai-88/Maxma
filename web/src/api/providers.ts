/** Provider 与本地模型接入 API，从 api/index.ts 抽出以控制主体量。 */
import type {
  DiscoverModelsResponse,
  ListProvidersResponse,
  ProviderConfig,
  ProviderHealthCheckResponse,
  TestConnectionResponse,
} from '@/types'

type Request = <T>(url: string, options?: RequestInit) => Promise<T>

export function createProvidersApi(request: Request) {
  return {
    listProviders: () =>
      request<ListProvidersResponse>('/providers'),

    systemHardware: (refresh = false) =>
      request<{
        platform: string
        arch: string
        cpuModel: string
        cpuCores: number
        memoryTotalBytes: number
        memoryFreeBytes: number
        gpus: Array<{ name: string; memoryBytes: number | null; source: string }>
        warnings: string[]
      }>(`/system/hardware${refresh ? '?refresh=1' : ''}`),

    modelRouting: (refresh = false) =>
      request<{
        candidates: Array<{
          providerId: string
          providerLabel: string
          model: string
          location: 'local' | 'cloud'
          fit: 'good' | 'ok' | 'tight' | 'too_large' | 'cloud'
          requiredMemoryGb: number | null
          device: 'gpu' | 'cpu' | 'remote'
          reason: string
        }>
        recommended: { model: string; providerLabel: string; reason: string } | null
        notes: string[]
      }>(`/models/routing${refresh ? '?refresh=1' : ''}`),

    setupLocalProvider: (body: { preset?: 'ollama' | 'lmstudio'; base_url?: string; label?: string; model?: string }) =>
      request<{
        created: boolean
        provider: ProviderConfig
        models: string[]
        probe: { reachable: boolean; detail: string }
      }>('/models/local-setup', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    createProvider: (body: Partial<ProviderConfig>) =>
      request<ProviderConfig>('/providers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    updateProvider: (id: string, body: Partial<ProviderConfig>) =>
      request<ProviderConfig>(`/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),

    deleteProvider: (id: string) =>
      request<{ status: string }>(`/providers/${id}`, { method: 'DELETE' }),

    testConnection: (body: { api_key: string; base_url: string; provider_type?: string }) =>
      request<TestConnectionResponse>('/providers/test', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    discoverModels: (body: { api_key: string; base_url: string; provider_type?: string }) =>
      request<DiscoverModelsResponse>('/providers/discover-models', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    discoverModelsForExisting: (id: string) =>
      request<DiscoverModelsResponse>(`/providers/${id}/discover-models`, {
        method: 'POST',
      }),

    testExistingProvider: (id: string) =>
      request<TestConnectionResponse>(`/providers/${id}/test`, {
        method: 'POST',
      }),

    // 阶段 3.3：按需触发健康检查并同步运行时健康状态（影响 fallback 链路）
    checkProviderHealth: (id: string) =>
      request<ProviderHealthCheckResponse>(`/providers/${id}/health`, {
        method: 'POST',
      }),
  }
}
