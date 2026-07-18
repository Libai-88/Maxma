import type {
  CreateSessionResponse,
  ListSessionsResponse,
  SessionInfo,
  ContextUsage,
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
  DiscoveredServer,
  SkillDetail,
  SkillCreateBody,
  SkillUpdateBody,
  MacroDetail,
  MacroCreateBody,
  MacroUpdateBody,
  MetricsSnapshot,
  MetricsHistoryResponse,
  AuditLogStats,
  AuditLogListResponse,
  ActivityRecentResponse,
  ActivityStatsResponse,
  ActivityClearResponse,
  DeferredRun,
  ListDeferredRunsResponse,
  PermissionMode,
  SessionPermissionModeResponse,
  ListWorkflowRunsResponse,
  WorkflowDefinitionsResponse,
  WorkflowRun,
} from '@/types'
import type {
  CreatePersonaBody,
  CreatePersonaResponse,
  ListPersonasResponse,
  SwitchPersonaResponse,
} from '@/types/persona'
import { ensurePortLoaded, getApiBase, tauriFetch } from '@/utils/env'

// 注意：BASE 在 ensurePortLoaded() 完成后可能因端口冲突回退而变化，
// 因此在 ensureTokenLoaded() 中会重新计算。
let BASE = getApiBase()

/** 运行时从后端获取的 Token。桌面端与浏览器端都以这份为准。 */
let token = ''

/** Token 是否已从运行时接口获取 */
let tokenFetchedAtRuntime = false
let tokenLoadPromise: Promise<void> | null = null
/** 版本号计数器，防止 resetToken() 与 ensureTokenLoaded() 的 finally 块竞态 */
let tokenLoadVersion = 0

export function getToken(): string {
  return token
}

/**
 * 运行时获取 Token（桌面应用模式）。
 * 当构建时未注入 Token 时，首次 API 调用会触发此函数。
 * 导出为 ensureTokenLoaded 供 WebSocket 连接前调用。
 * 失败后自动重试最多 3 次（间隔 1s 递增），全部失败则抛出错误，
 * 防止静默失败导致未认证请求发出。
 */
export async function ensureTokenLoaded(): Promise<void> {
  if (tokenFetchedAtRuntime) return
  const myVersion = tokenLoadVersion
  if (!tokenLoadPromise) {
    const capturedVersion = tokenLoadVersion
    tokenLoadPromise = (async () => {
      // 先加载运行时端口（Tauri 端口冲突回退），再构造请求 URL
      await ensurePortLoaded()
      BASE = getApiBase()
      let lastError: unknown
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await tauriFetch(`${BASE}/auth/token`)
          // 版本已变化 — resetToken() 在此期间被调用，此次 fetch 结果已过时，静默丢弃
          if (tokenLoadVersion !== capturedVersion) {
            console.log('[api] Token fetch result discarded due to resetToken()')
            return
          }
          if (res.ok) {
            const data = await res.json()
            token = data.token || ''
            tokenFetchedAtRuntime = true
            console.log('[api] Token acquired at runtime')
            return
          } else {
            lastError = new Error(`Token fetch returned ${res.status}`)
          }
        } catch (e) {
          lastError = e
          console.warn(`[api] Failed to fetch token at runtime (attempt ${attempt}/3):`, e)
        }
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }
      // 版本检查：resetToken() 期间发生的最终失败也无需抛错（新 promise 会处理）
      if (tokenLoadVersion !== capturedVersion) return
      // 所有重试失败，抛出错误而非静默失败
      throw new Error(
        `获取认证 Token 失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      )
    })()
  }
  try {
    await tokenLoadPromise
  } finally {
    // 仅在版本未变化时清除 promise，防止 resetToken() 后旧 finally 误清新创建的 promise
    if (tokenLoadVersion === myVersion) {
      tokenLoadPromise = null
    }
  }
}

/** 强制清除 Token 缓存，下次请求时重新获取（用于 auth 失败后刷新） */
export function resetToken(): void {
  tokenFetchedAtRuntime = false
  token = ''
  tokenLoadVersion++  // 递增版本号，使 in-flight finally 跳过清除 tokenLoadPromise
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
    const userMsg = `API 请求失败 (${res.status})`
    try {
      const body = await res.json()
      // 将后端详情输出到 console 便于调试，不向用户暴露内部细节
      if (body.detail) console.warn(`[api] ${url} detail:`, body.detail)
    } catch { /* ignore parse errors */ }
    throw new Error(userMsg)
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
    let detail = `图片上传失败: ${res.status}`
    try { const body = await res.json(); if (body.detail) detail += `: ${body.detail}` } catch { /* ignore */ }
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
    request<SessionInfo>(`/sessions/${encodeURIComponent(id)}`),

  getMessages: (id: string) =>
    request<{ session_id: string; messages: { role: string; content: string }[] }>(`/sessions/${encodeURIComponent(id)}/messages`),

  deleteSession: (id: string) =>
    request<{ status: string }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getSessionPermissionMode: (sessionId: string) =>
    request<SessionPermissionModeResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/permission-mode`,
    ),

  setSessionPermissionMode: (sessionId: string, permissionMode: PermissionMode) =>
    request<SessionPermissionModeResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/permission-mode`,
      {
        method: 'PUT',
        body: JSON.stringify({ permission_mode: permissionMode }),
      },
    ),

  // Server-side feature flag controls availability. No client-side opt-in is needed.
  listDeferredRuns: (sessionId: string) =>
    request<ListDeferredRunsResponse>(`/sessions/${encodeURIComponent(sessionId)}/deferred-runs`),

  getDeferredRun: (sessionId: string, runId: string) =>
    request<DeferredRun>(
      `/sessions/${encodeURIComponent(sessionId)}/deferred-runs/${encodeURIComponent(runId)}`,
    ),

  cancelDeferredRun: (sessionId: string, runId: string) =>
    request<DeferredRun>(
      `/sessions/${encodeURIComponent(sessionId)}/deferred-runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
    ),

  // Workflows are server-flagged and registry-backed; callers can only select a listed ID.
  listWorkflowDefinitions: () =>
    request<WorkflowDefinitionsResponse>('/workflows/definitions'),

  listWorkflowRuns: (sessionId: string) =>
    request<ListWorkflowRunsResponse>(`/sessions/${encodeURIComponent(sessionId)}/workflows`),

  startWorkflow: (sessionId: string, workflowId: string, parentTurnId?: string) =>
    request<WorkflowRun>(`/sessions/${encodeURIComponent(sessionId)}/workflows`, {
      method: 'POST',
      body: JSON.stringify({ workflow_id: workflowId, ...(parentTurnId ? { parent_turn_id: parentTurnId } : {}) }),
    }),

  getWorkflowRun: (sessionId: string, runId: string) =>
    request<WorkflowRun>(
      `/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}`,
    ),

  cancelWorkflowRun: (sessionId: string, runId: string) =>
    request<WorkflowRun>(
      `/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
    ),

  resumeWorkflowRun: (sessionId: string, runId: string) =>
    request<WorkflowRun>(
      `/sessions/${encodeURIComponent(sessionId)}/workflows/${encodeURIComponent(runId)}/resume`,
      { method: 'POST' },
    ),

  getContextUsage: (sessionId: string) =>
    request<ContextUsage & { session_id: string }>(`/sessions/${encodeURIComponent(sessionId)}/context-usage`),

  undoMessages: (sessionId: string, n: number = 1) =>
    request<{ deleted_count: number }>(`/sessions/${encodeURIComponent(sessionId)}/undo?n=${n}`, { method: 'POST' }),

  /** 手动触发会话上下文压缩 */
  compressSession: (sessionId: string) =>
    request<{
      compressed: boolean
      removed_count?: number
      summary_preview?: string
      context_usage_before?: number
      context_usage_after?: number
    }>(`/sessions/${encodeURIComponent(sessionId)}/compress`, { method: 'POST' }),

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

  constifySession: (sessionId: string, name: string) =>
    request<ConstifyResponse>(`/sessions/${encodeURIComponent(sessionId)}/const`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  unconstifySession: (sessionId: string) =>
    request<{ status: string }>(`/sessions/${encodeURIComponent(sessionId)}/const`, { method: 'DELETE' }),

  generateSessionTitle: (sessionId: string) =>
    request<{ title: string }>(`/sessions/${encodeURIComponent(sessionId)}/generate-title`, { method: 'POST' }),

  // ── Persona 人设 ──

  getPersona: (type: 'soul' | 'user', variant?: string) =>
    request<{ content: string; type: string }>(`/persona?type=${type}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`),

  updatePersona: (type: 'soul' | 'user', content: string, variant?: string) =>
    request<{ content: string; type: string }>(`/persona?type=${type}${variant ? `&variant=${encodeURIComponent(variant)}` : ''}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  listPersonas: () =>
    request<ListPersonasResponse>('/personas'),

  switchPersona: (file: string) =>
    request<SwitchPersonaResponse>('/personas/active', {
      method: 'PUT',
      body: JSON.stringify({ file }),
    }),

  createPersona: (body: CreatePersonaBody) =>
    request<CreatePersonaResponse>('/personas', {
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

  // 获取 OMP 自动发现的 MCP 服务器
  listMcpDiscovered: () =>
    request<DiscoveredServer[]>('/mcp/discovered'),

  // 测试 MCP 服务器连接（stdio 命令解析 + 子进程启动探测）
  testMcpConnection: (body: { command: string; args: string[]; env: Record<string, string> }) =>
    request<{ success: boolean; error: string | null; resolved_command: string }>('/mcp/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  uploadImage,

  // Audit Log
  getAuditLog: (params: string = '?limit=50') =>
    request<AuditLogListResponse>(`/audit-log${params}`),

  getAuditStats: () =>
    request<{ stats: AuditLogStats }>('/audit-log/stats'),

  clearAuditLog: () =>
    request<{ status: string; deleted: number }>('/audit-log/clear', { method: 'POST' }),

  encryptApiKeys: () =>
    request<{ status: string; encrypted: number }>('/providers/encrypt-keys', {
      method: 'POST',
    }),

  // ── 运行时指标 Metrics ──

  getMetrics: () =>
    request<MetricsSnapshot>('/metrics'),

  getMetricsHistory: (windowSeconds: number = 3600) =>
    request<MetricsHistoryResponse>(`/metrics/history?window=${windowSeconds}`),

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

  /** 获取日志文件列表及大小 */
  getLogFiles: () =>
    request<{ status: string; logs_dir: string; files: Array<{ name: string; size_bytes: number; size_mb: number; path: string }>; count: number; total_bytes: number; total_mb: number }>('/diagnostics/logs'),

  /** 清理旧日志轮转文件（保留当前日志） */
  clearOldLogs: () =>
    request<{ status: string; deleted_count: number; freed_bytes: number; freed_mb: number; deleted_files: string[] }>('/diagnostics/logs', {
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
