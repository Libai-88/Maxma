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
  MCPServerInfo,
  MCPServerConfig,
  MCPServerCreateBody,
  MCPServerUpdateBody,
  ListMCPServersResponse,
  SkillDetail,
  SkillCreateBody,
  SkillUpdateBody,
  MacroDetail,
  MacroCreateBody,
  MacroUpdateBody,
} from '@/types'
import { getApiBase, tauriFetch } from '@/utils/env'

const BASE = getApiBase()

/** 运行时从后端获取的 Token。桌面端与浏览器端都以这份为准。 */
let token = ''

/** Token 是否已从运行时接口获取 */
let tokenFetchedAtRuntime = false
let tokenLoadPromise: Promise<void> | null = null

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
  if (!tokenLoadPromise) {
    tokenLoadPromise = (async () => {
      try {
        const res = await tauriFetch(`${BASE}/auth/token`)
        if (res.ok) {
          const data = await res.json()
          token = data.token || ''
          tokenFetchedAtRuntime = true
          console.log('[api] Token acquired at runtime')
        }
      } catch (e) {
        console.warn('[api] Failed to fetch token at runtime:', e)
      } finally {
        tokenLoadPromise = null
      }
    })()
  }
  await tokenLoadPromise
}

/** 强制清除 Token 缓存，下次请求时重新获取（用于 auth 失败后刷新） */
export function resetToken(): void {
  tokenFetchedAtRuntime = false
  token = ''
  tokenLoadPromise = null
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // 桌面端始终以运行时 Token 为准，避免构建期 token 过期或串台。
  if (!tokenFetchedAtRuntime) {
    await ensureTokenLoaded()
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['X-Maxma-Token'] = token
  }
  const res = await tauriFetch(`${BASE}${url}`, {
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

/** 上传图片文件（multipart/form-data），返回服务端路径 */
async function uploadImage(file: File): Promise<{ file_id: string; filename: string; path: string }> {
  if (!tokenFetchedAtRuntime) {
    await ensureTokenLoaded()
  }
  const form = new FormData()
  form.append('file', file)
  const headers: Record<string, string> = {}
  if (token) {
    headers['X-Maxma-Token'] = token
  }
  const res = await tauriFetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) {
    throw new Error(`图片上传失败: ${res.status}`)
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

  updateMemory: (id: string, content: string, section: string) =>
    request<{ status: string }>(`/memories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ content, section }),
    }),

  getContextUsage: (sessionId: string) =>
    request<ContextUsage & { session_id: string }>(`/sessions/${sessionId}/context-usage`),

  undoMessages: (sessionId: string, n: number = 1) =>
    request<{ deleted_count: number }>(`/sessions/${sessionId}/undo?n=${n}`, { method: 'POST' }),

  getDeepSeekBalance: () =>
    request<DeepSeekBalanceResponse>('/deepseek-balance'),

  health: () =>
    request<HealthResponse>('/health'),

  restart: async () => {
    if (!tokenFetchedAtRuntime) {
      await ensureTokenLoaded()
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['X-Maxma-Token'] = token
    try {
      await tauriFetch(`${BASE}/restart`, { method: 'POST', headers })
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

  // ── Anthropic Skills & Macros ──

  listSkills: () =>
    request<ListSkillsResponse>('/skills'),

  getSkill: (id: string) =>
    request<SkillDetail>(`/skills/${encodeURIComponent(id)}`),

  createSkill: (body: SkillCreateBody) =>
    request<SkillDetail>('/skills', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSkill: (id: string, body: SkillUpdateBody) =>
    request<{ id: string; status: string }>(`/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteSkill: (id: string) =>
    request<{ id: string; status: string }>(`/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listMacros: () =>
    request<ListMacrosResponse>('/macros'),

  getMacro: (id: string) =>
    request<MacroDetail>(`/macros/${encodeURIComponent(id)}`),

  createMacro: (body: MacroCreateBody) =>
    request<MacroDetail>('/macros', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMacro: (id: string, body: MacroUpdateBody) =>
    request<{ id: string; status: string }>(`/macros/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteMacro: (id: string) =>
    request<{ id: string; status: string }>(`/macros/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listTools: () =>
    request<ListToolsResponse>('/tools'),

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

  getPersona: (type: 'soul' | 'user', variant?: string) =>
    request<{ content: string; type: string }>(`/persona?type=${type}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`),

  updatePersona: (type: 'soul' | 'user', content: string, variant?: string) =>
    request<{ content: string; type: string }>(`/persona?type=${type}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  listPersonas: () =>
    request<{ personas: { id: string; file: string; name: string; description: string; active: boolean }[]; active_file: string }>('/personas'),

  switchPersona: (file: string) =>
    request<{ status: string; active_file: string }>('/personas/active', {
      method: 'PUT',
      body: JSON.stringify({ file }),
    }),

  createPersona: (body: { name: string; description?: string; tools?: string; memory?: string }) =>
    request<{ status: string; file: string; memory_mode: string; tools: string }>('/personas', {
      method: 'POST',
      body: JSON.stringify(body),
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

  // ── MCP 服务器管理 ──

  listMcpServers: () =>
    request<ListMCPServersResponse>('/mcp/servers'),

  getMcpServer: (serverId: string) =>
    request<MCPServerConfig>(`/mcp/servers/${encodeURIComponent(serverId)}`),

  createMcpServer: (body: MCPServerCreateBody) =>
    request<MCPServerConfig & { status: string; servers: MCPServerInfo[]; tool_count: number }>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMcpServer: (serverId: string, body: MCPServerUpdateBody) =>
    request<MCPServerConfig & { status: string; servers: MCPServerInfo[]; tool_count: number }>(`/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteMcpServer: (serverId: string) =>
    request<{ status: string; removed: string; servers: MCPServerInfo[]; tool_count: number }>(`/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
    }),

  reloadMcp: () =>
    request<{ status: string; servers: MCPServerInfo[]; tool_count: number }>('/mcp/reload', {
      method: 'POST',
    }),

  uploadImage,

  // Event Hooks
  listHooks: () =>
    request<{ hooks: any[] }>('/event-hooks'),

  getHook: (hookId: string) =>
    request<any>(`/event-hooks/${hookId}`),

  createHook: (body: { name: string; hook_type: string; config: Record<string, any>; action: string }) =>
    request<{ status: string; hook: any }>('/event-hooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateHook: (hookId: string, body: Record<string, any>) =>
    request<{ status: string; hook: any }>(`/event-hooks/${hookId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteHook: (hookId: string) =>
    request<{ status: string }>(`/event-hooks/${hookId}`, { method: 'DELETE' }),

  getHookHistory: (limit: number = 50) =>
    request<{ history: any[] }>(`/event-hooks/history?limit=${limit}`),

  // Audit Log
  getAuditLog: (params: string = '?limit=50') =>
    request<{ records: any[] }>(`/audit-log${params}`),

  getAuditStats: () =>
    request<{ stats: any }>('/audit-log/stats'),

  clearAuditLog: () =>
    request<{ status: string; deleted: number }>('/audit-log/clear', { method: 'POST' }),

  encryptApiKeys: () =>
    request<{ status: string; encrypted: number }>('/audit-log/encrypt-keys', { method: 'POST' }),
}

export { request }
