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
  ProviderHealthCheckResponse,
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
  MCPServerToolsResponse,
  SkillDetail,
  SkillCreateBody,
  SkillUpdateBody,
  MacroDetail,
  MacroCreateBody,
  MacroUpdateBody,
  KbDocument,
  KbSearchResult,
  MetricsSnapshot,
  MetricsHistoryResponse,
  AuditLogRecord,
  AuditLogStats,
  AuditLogListResponse,
  ActivityRecentResponse,
  ActivityStatsResponse,
  ActivityClearResponse,
} from '@/types'
import { ensurePortLoaded, getApiBase, tauriFetch } from '@/utils/env'

// 注意：BASE 在 ensurePortLoaded() 完成后可能因端口冲突回退而变化，
// 因此在 ensureTokenLoaded() 中会重新计算。
let BASE = getApiBase()

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
        // 先加载运行时端口（Tauri 端口冲突回退），再构造请求 URL
        await ensurePortLoaded()
        BASE = getApiBase()
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
  const res = await tauriFetch(`${BASE}/upload`, {
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

  getMessages: (id: string) =>
    request<{ session_id: string; messages: { role: string; content: string }[] }>(`/sessions/${id}/messages`),

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

  /** 手动触发会话上下文压缩 */
  compressSession: (sessionId: string) =>
    request<{
      compressed: boolean
      removed_count?: number
      summary_preview?: string
      context_usage_before?: number
      context_usage_after?: number
    }>(`/sessions/${sessionId}/compress`, { method: 'POST' }),

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

  // 阶段 3.3：按需触发健康检查并同步运行时健康状态（影响 fallback 链路）
  checkProviderHealth: (id: string) =>
    request<ProviderHealthCheckResponse>(`/providers/${id}/health`, {
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

  // 阶段 4.1：列出某 MCP 服务器加载的所有工具名（供前端勾选 allowlist）
  listMcpServerTools: (serverId: string) =>
    request<MCPServerToolsResponse>(`/mcp/servers/${encodeURIComponent(serverId)}/tools`),

  // 测试 MCP 服务器连接（stdio 命令解析 + 子进程启动探测）
  testMcpConnection: (body: { command: string; args: string[]; env: Record<string, string> }) =>
    request<{ success: boolean; error: string | null; resolved_command: string }>('/mcp/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // 阶段 4.2：MCP 调用审计聚合统计
  getMcpAuditSummary: () =>
    request<{ summary: any[]; event_type: string }>('/audit-log/mcp-summary'),

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
    request<AuditLogListResponse>(`/audit-log${params}`),

  getAuditStats: () =>
    request<{ stats: AuditLogStats }>('/audit-log/stats'),

  clearAuditLog: () =>
    request<{ status: string; deleted: number }>('/audit-log/clear', { method: 'POST' }),

  encryptApiKeys: () =>
    request<{ status: string; encrypted: number }>('/audit-log/encrypt-keys', {
      method: 'POST',
    }),

  // ── 运行时指标 Metrics ──

  getMetrics: () =>
    request<MetricsSnapshot>('/metrics'),

  getMetricsHistory: (windowSeconds: number = 3600) =>
    request<MetricsHistoryResponse>(`/metrics/history?window=${windowSeconds}`),

  // ── Knowledge Base 知识库 ──

  listKbDocuments: () =>
    request<{ items: KbDocument[] }>('/kb/documents'),

  getKbDocument: (docId: string) =>
    request<KbDocument>(`/kb/documents/${encodeURIComponent(docId)}`),

  deleteKbDocument: (docId: string) =>
    request<{ status: string; doc_id: string }>(`/kb/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' }),

  uploadKbDocument: (file: File, docId?: string) => {
    const form = new FormData()
    form.append('file', file)
    const headers: Record<string, string> = {}
    if (token) headers['X-Maxma-Token'] = token
    if (docId) form.append('doc_id', docId)
    return tauriFetch(`${BASE}/kb/documents`, { method: 'POST', headers, body: form })
      .then(res => { if (!res.ok) throw new Error(`上传失败: ${res.status}`); return res.json() })
  },

  indexKbText: (body: { content: string; doc_id: string; filename?: string; source?: string }) =>
    request<{ doc_id: string; chunks: number; status: string }>('/kb/documents/text', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  importKbUrl: (body: { url: string; doc_id?: string }) =>
    request<{ doc_id: string; chunks: number; status: string }>('/kb/documents/url', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  searchKb: (body: { query: string; top_k?: number; threshold?: number }) =>
    request<{ query: string; count: number; items: KbSearchResult[] }>('/kb/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── 诊断与错误日志导出 ──

  /** 导出完整错误报告（JSON 格式，含系统信息 + 内存收集 + 日志扫描） */
  getErrorLog: () =>
    request<{
      generated_at: string
      system_info: Record<string, unknown>
      errors: Array<{
        timestamp: string
        level: string
        category: string
        message: string
        trace_id?: string
        session_id?: string
        request_id?: string
        logger_name?: string
        exception?: string
        extra?: Record<string, unknown>
        source_file?: string
        source_line?: number
      }>
      stats: {
        memory_error_count: number
        log_file_error_count: number
        merged_total: number
        uptime_seconds: number
        buffer_capacity: number
      }
    }>('/diagnostics/error-log'),

  /** 导出纯文本错误报告（便于下载或复制粘贴反馈给开发者） */
  getErrorLogText: async (): Promise<string> => {
    if (!tokenFetchedAtRuntime) {
      await ensureTokenLoaded()
    }
    const headers: Record<string, string> = {}
    if (token) {
      headers['X-Maxma-Token'] = token
    }
    const res = await tauriFetch(`${BASE}/diagnostics/error-log/text`, { headers })
    if (!res.ok) {
      throw new Error(`导出错误日志失败: ${res.status}`)
    }
    return await res.text()
  },

  /** 清空内存缓冲区中的错误记录 */
  clearErrorLog: () =>
    request<{ status: string; deleted: number }>('/diagnostics/error-log', {
      method: 'DELETE',
    }),

  // ── Activity 活动中心 ──

  /** 获取最近的活动记录 */
  getActivityRecent: (limit = 100) =>
    request<ActivityRecentResponse>(`/activity/recent?limit=${limit}`),

  /** 获取活动统计信息 */
  getActivityStats: () =>
    request<ActivityStatsResponse>('/activity/stats'),

  /** 清空所有活动记录 */
  clearActivity: () =>
    request<ActivityClearResponse>('/activity', { method: 'DELETE' }),
}

export { request }
