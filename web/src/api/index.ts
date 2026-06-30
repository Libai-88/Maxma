import type {
  CreateSessionResponse,
  ListSessionsResponse,
  SessionInfo,
  NarrativeResponse,
  MomentResponse,
  VignetteResponse,
  ContextUsage,
  DeepSeekBalanceResponse,
  HealthResponse,
  ListProvidersResponse,
  ListNewsResponse,
  ListSkillsResponse,
  ListToolsResponse,
  ListMacrosResponse,
  ProviderConfig,
  TestConnectionResponse,
  DiscoverModelsResponse,
  ConstifyResponse,
  WhitelistEntry,
  ListWhitelistResponse,
  BlockerEntry,
  ListBlockerResponse,
  ListEnvVarsResponse,
  UpdateEnvVarResponse,
} from '@/types'

declare const __API_TOKEN__: string

const BASE = '/api'

/** 从 Vite 编译期注入的 Token（开发模式） */
let token: string = typeof __API_TOKEN__ !== 'undefined' ? __API_TOKEN__ : ''

/** Token 是否已从运行时接口获取 */
let tokenFetchedAtRuntime = false

export function getToken(): string {
  return token
}

/**
 * 运行时获取 Token（桌面应用模式）。
 * 当构建时未注入 Token 时，首次 API 调用会触发此函数。
 * 导出为 ensureTokenLoaded 供 WebSocket 连接前调用。
 */
export async function ensureTokenLoaded(): Promise<void> {
  if (tokenFetchedAtRuntime) return
  try {
    const res = await fetch(`${BASE}/auth/token`)
    if (res.ok) {
      const data = await res.json()
      token = data.token || ''
      tokenFetchedAtRuntime = true
      console.log('[api] Token acquired at runtime')
    }
  } catch (e) {
    console.warn('[api] Failed to fetch token at runtime:', e)
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // 如果没有 Token，先运行时获取
  if (!token && !tokenFetchedAtRuntime) {
    await ensureTokenLoaded()
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['X-Maxma-Token'] = token
  }
  const res = await fetch(`${BASE}${url}`, {
    headers,
    ...options,
  })
  if (!res.ok) {
    let detail = `API ${url} 返回 ${res.status}`
    try {
      const body = await res.json()
      if (body.detail) detail += `: ${body.detail}`
    } catch { /* ignore parse errors */ }
    throw new Error(detail)
  }
  return res.json()
}

export const api = {
  createSession: () =>
    request<CreateSessionResponse>('/sessions', { method: 'POST' }),

  listSessions: () =>
    request<ListSessionsResponse>('/sessions'),

  getSession: (id: string) =>
    request<SessionInfo>(`/sessions/${id}`),

  deleteSession: (id: string) =>
    request<{ status: string }>(`/sessions/${id}`, { method: 'DELETE' }),

  getNarrative: () =>
    request<NarrativeResponse>('/narrative'),

  getMoment: () =>
    request<MomentResponse>('/moment'),

  getMemories: () =>
    request<VignetteResponse>('/memories'),

  getContextUsage: (sessionId: string) =>
    request<ContextUsage & { session_id: string }>(`/sessions/${sessionId}/context-usage`),

  undoMessages: (sessionId: string, n: number = 1) =>
    request<{ deleted_count: number }>(`/sessions/${sessionId}/undo?n=${n}`, { method: 'POST' }),

  getDeepSeekBalance: () =>
    request<DeepSeekBalanceResponse>('/deepseek-balance'),

  health: () =>
    request<HealthResponse>('/health'),

  restart: async () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['X-Maxma-Token'] = token
    try {
      await fetch(`${BASE}/restart`, { method: 'POST', headers })
    } catch { /* server will close connection, expected */ }
  },

  // ── Provider ──

  listProviders: () =>
    request<ListProvidersResponse>('/providers'),

  getProvider: (id: string) =>
    request<ProviderConfig>(`/providers/${id}`),

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

  // ── News ──

  listNews: () =>
    request<ListNewsResponse>('/news'),

  // ── Anthropic Skills ──

  listSkills: () =>
    request<ListSkillsResponse>('/skills'),

  listTools: () =>
    request<ListToolsResponse>('/tools'),

  listMacros: () =>
    request<ListMacrosResponse>('/macros'),

  // ── Const 固定会话 ──

  constifySession: (id: string, name: string) =>
    request<ConstifyResponse>(`/sessions/${id}/const`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  unconstifySession: (id: string) =>
    request<{ status: string }>(`/sessions/${id}/const`, { method: 'DELETE' }),

  generateSessionTitle: (id: string) =>
    request<{ title: string }>(`/sessions/${id}/generate-title`, { method: 'POST' }),

  // ── Persona 人设 ──

  getPersona: (type: 'soul' | 'user') =>
    request<{ content: string; type: string }>(`/persona?type=${type}`),

  updatePersona: (type: 'soul' | 'user', content: string) =>
    request<{ content: string; type: string }>(`/persona?type=${type}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  // ── Path Whitelist 路径白名单 ──

  listWhitelist: () =>
    request<ListWhitelistResponse>('/path-whitelist'),

  addWhitelistEntry: (entry: { path: string; description: string }) =>
    request<WhitelistEntry>('/path-whitelist', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),

  updateWhitelistEntry: (index: number, entry: { path: string; description: string }) =>
    request<WhitelistEntry>(`/path-whitelist/${index}`, {
      method: 'PUT',
      body: JSON.stringify(entry),
    }),

  deleteWhitelistEntry: (index: number) =>
    request<{ status: string }>(`/path-whitelist/${index}`, { method: 'DELETE' }),

  // ── 文件选择器 ──

  selectFile: (type: 'file' | 'folder') =>
    request<{ path: string | null }>(`/select-file?type=${type}`),

  selectFolder: () =>
    request<{ path: string | null }>('/select-file?type=folder'),

  // ── 路径安全检查 ──

  checkPathBlocked: (path: string) =>
    request<{ blocked: boolean; reason: string | null; blocker_path: string | null }>(
      `/check-path-blocked?path=${encodeURIComponent(path)}`
    ),

  // ── MaxmaBlocker 拒止锚 ──

  listBlockers: () =>
    request<ListBlockerResponse>('/maxma-blocker'),

  addBlocker: (entry: { path: string; description: string }) =>
    request<BlockerEntry>('/maxma-blocker', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),

  deleteBlocker: (index: number) =>
    request<{ status: string }>(`/maxma-blocker/${index}`, { method: 'DELETE' }),

  // ── 工具环境变量 ──

  listEnvVars: () =>
    request<ListEnvVarsResponse>('/env-vars'),

  updateEnvVar: (key: string, value: string) =>
    request<UpdateEnvVarResponse>('/env-vars', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),

  batchUpdateEnvVars: (env_vars: { key: string; value: string }[]) =>
    request<{ status: string; updated: { key: string; masked_value: string }[] }>('/env-vars/batch', {
      method: 'PUT',
      body: JSON.stringify({ env_vars }),
    }),
}
