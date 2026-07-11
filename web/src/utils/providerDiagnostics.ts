import type { ComponentHealth } from '@/types'

const reasonMessages: Record<string, string> = {
  authentication_failed: '验证失败，请检查 API Key。',
  permission_denied: '当前凭据没有所需权限。',
  invalid_configuration: '请检查服务地址和提供商配置。',
  invalid_request: '提供商拒绝了当前配置请求。',
  rate_limited: '服务暂时限流，将在稍后恢复。',
  request_timed_out: '请求超时，请检查网络后重试。',
  network_unavailable: '无法连接到服务，请检查网络和服务地址。',
  temporary_unavailable: '服务暂时不可用，将自动重试。',
  runtime_degraded: '服务暂时降级。',
  runtime_error: '服务当前不可用。',
}

export function diagnosticMessage(component: Pick<ComponentHealth, 'reason_code' | 'summary'>): string | null {
  return component.summary ?? (component.reason_code ? reasonMessages[component.reason_code] ?? null : null)
}

export function retryMessage(retryAt: number | null | undefined): string | null {
  if (retryAt == null || !Number.isFinite(retryAt)) return null
  return `下次重试：${new Date(retryAt * 1000).toLocaleTimeString()}`
}
