import type {
  CreateSessionResponse,
  ListSessionsResponse,
  HealthResponse,
  ListProvidersResponse,
  ListNewsResponse,
  ProviderConfig,
  TestConnectionResponse,
  ProviderHealthCheckResponse,
  DiscoverModelsResponse,
  ConstifyResponse,
  BlockerEntry,
  ListBlockerResponse,
  MCPServerInfo,
  MCPServerConfig,
  MCPServerCreateBody,
  MCPServerUpdateBody,
  ListMCPServersResponse,
  MCPServerToolsResponse,
  DiscoveredServer,
  RegistryListResponse,
  RegistryInstallResponse,
  OAuthAuthorizeResponse,
  OAuthStatusResponse,
  MetricsSnapshot,
  MetricsHistoryResponse,
  AuditLogStats,
  AuditLogListResponse,
  ActivityRecentResponse,
  ActivityStatsResponse,
  ActivityClearResponse,
  DeferredRun,
  WorkflowDefinitionsResponse,
  ListWorkflowRunsResponse,
  WorkflowRun,
  PermissionMode,
  SessionPermissionModeResponse,
  CapabilitiesResponse,
} from '@/types'
import type {
  CreatePersonaBody,
  CreatePersonaResponse,
  ListPersonasResponse,
  SwitchPersonaResponse,
} from '@/types/persona'
import type {
  Plugin,
  PluginDetail,
  InstallPluginRequest,
  InstallPluginResponse,
} from '@/types/plugin'
import type {
  SessionShare,
  CreateShareRequest,
  SessionSnapshot,
} from '@/types/collab'
import { ensurePortLoaded, getApiBase, tauriFetch } from '@/utils/env'

// ── Panel Config 类型 ──

export interface HindsightConfig {
  enabled: boolean
  retention_days: number
  importance_threshold: number
  processing_mode: 'auto' | 'manual' | 'scheduled'
  prompt_template: string
}

// GAP-A2-001：TTS 提供商收敛为 system（WebView2 speechSynthesis 系统语音，
// 零 API 成本）。edge-tts/openai-tts 为历史假配置（从未接线），后端读取时
// 会规范化为 system（见 settings_panels.py）。
export interface TtsConfig {
  enabled: boolean
  provider: 'system' | 'custom'
  voice: string
  speed: number
  pitch: number
  auto_read: boolean
}

export interface BrowserToolsConfig {
  enabled: boolean
  chrome_path: string
  headless: boolean
  viewport_width: number
  viewport_height: number
  block_tracking: boolean
  allowed_domains: string[]
}

export interface SubAgentConfig {
  enabled: boolean
  max_concurrent: number
  auto_approve: boolean
  model: string
  timeout_seconds: number
  show_progress: boolean
}

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
  const capturedPromise = tokenLoadPromise
  try {
    await capturedPromise
  } finally {
    // 仅当当前 promise 仍是本调用创建的 promise 时才清除，防止 resetToken()
    // 或并发 ensureTokenLoaded() 误清洗新创建的 promise。
    if (tokenLoadPromise === capturedPromise) {
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

/** 普通请求超时（ms）。修复 TIMEOUT-001：此前 request 无任何超时，
 *  后端挂起（sidecar 死锁等）时 saving/loading 状态永久卡死无法恢复。 */
const REQUEST_TIMEOUT_MS = 30000

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
  // COMPAT-ABORT-001：AbortSignal.timeout 需 Chrome/Edge≥103、Safari≥16、
  // Firefox≥100——旧环境直接调用会 ReferenceError 导致所有请求崩溃。
  // 不支持时用 AbortController + setTimeout 手动实现相同语义。
  function timeoutSignal(ms: number): AbortSignal {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), ms)
    return controller.signal
  }
  const doFetch = () => tauriFetch(`${BASE}${url}`, {
    headers,
    ...options,
    // 调用方自带 signal 时优先（如取消语义），否则使用统一超时
    signal: options?.signal ?? timeoutSignal(REQUEST_TIMEOUT_MS),
  })

  let res = await doFetch()
  // 修复 AUTH-001：401（token 轮换/失效）→ 刷新 Token 后重试一次。
  // 与 WS 关闭码 4001 的处理对齐；此前仅 WS 路径有刷新，无 WS 连接时
  // 所有 HTTP 请求持续 401，用户只能整页重启。
  if (res.status === 401) {
    console.warn(`[api] ${url} 401，刷新 Token 后重试一次`)
    resetToken()
    await ensureTokenLoaded()
    res = await doFetch()
  }
  if (!res.ok) {
    // 修复 RATE-LIMIT-HINT-001：429（限流）给出可理解的提示，
    // 其余状态保持通用文案（detail 只进 console 不暴露内部细节）
    // UX-API-DETAIL-001：4xx 业务错误（如 409 冲突）的 detail 是后端编写
    // 的用户可读中文文案（如"当前正在使用的人格不可删除"），应直接展示；
    // 5xx 内部错误 detail 可能含路径/堆栈，只进 console。
    let userMsg = res.status === 429
      ? '操作过于频繁，请稍后再试'
      : `API 请求失败 (${res.status})`
    try {
      const body = await res.json()
      if (body.detail) {
        console.warn(`[api] ${url} detail:`, body.detail)
        if (res.status >= 400 && res.status < 500) {
          userMsg = typeof body.detail === 'string' ? body.detail : userMsg
        }
      }
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
  // UX-UPLOAD-TIMEOUT-001：上传显式 60s 超时——此前无 AbortSignal/超时，
  // 后端处理挂起（如磁盘满）时前端无限等待，预览图一直显示"上传中"
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let res: Response
  try {
    res = await tauriFetch(`${BASE}/upload`, {
      method: 'POST',
      headers,
      body: form,
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('图片上传超时（60s），请检查网络或文件大小后重试')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    // 修复 LEAK-DETAIL-001：与 request() 的策略对齐——后端 detail 只进
    // console 便于调试，不拼进用户可见错误（可能暴露内部路径/服务名）。
    const detailMsg = `图片上传失败: ${res.status}`
    try {
      const body = await res.json()
      if (body.detail) console.warn(`[api] /upload detail:`, body.detail)
    } catch { /* ignore */ }
    throw new Error(detailMsg)
  }
  return res.json()
}

export const api = {
  request,

  createSession: () =>
    request<CreateSessionResponse>('/sessions', { method: 'POST' }),

  listSessions: () =>
    request<ListSessionsResponse>('/sessions'),

  getMessages: (id: string, limit: number = 50) =>
    request<{ session_id: string; messages: { role: string; content: string }[]; total?: number; source?: string }>(`/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`),

  deleteSession: (id: string) =>
    request<{ status: string }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  batchDeleteSessions: (sessionIds: string[]) =>
    request<{ deleted: string[], count: number }>(`/sessions/batch-delete`, {
      method: 'POST',
      body: JSON.stringify({ session_ids: sessionIds }),
    }),

  clearTempSessions: () =>
    request<{ deleted: string[], count: number }>(`/sessions/clear-temp`, { method: 'POST' }),

  // UX-CLEAR-001：清空会话消息（后端销毁 sidecar 会话 + 清空持久化历史）
  clearSessionMessages: (id: string) =>
    request<{ status: string, cleared_turns: number }>(`/sessions/${encodeURIComponent(id)}/messages`, { method: 'DELETE' }),

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

  undoMessages: (sessionId: string, n: number = 1) =>
    request<{ deleted_count: number }>(`/sessions/${encodeURIComponent(sessionId)}/undo?n=${n}`, { method: 'POST' }),

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

  // 后端 GET /tools 返回裸数组 ToolInfo[]（非 {tools:[]} 包裹）。
  listTools: () =>
    request<import('@/types').ToolInfo[]>('/tools'),

  // ── OMP Settings ──

  getSettings: (paths?: string[]) => {
    const qs = paths ? `?paths=${encodeURIComponent(paths.join(','))}` : ''
    return request<Record<string, unknown>>(`/settings${qs}`)
  },

  setSetting: (path: string, value: unknown) =>
    request<{ ok: boolean }>('/settings', {
      method: 'PUT',
      body: JSON.stringify({ path, value }),
    }),

  // ── Panel Configs（Hindsight / TTS / Browser Tools / Sub-agents） ──

  getHindsightConfig: () =>
    request<HindsightConfig>('/memory/hindsight-config'),

  updateHindsightConfig: (config: Partial<HindsightConfig>) =>
    request<HindsightConfig>('/memory/hindsight-config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getTtsConfig: () =>
    request<TtsConfig>('/settings/tts'),

  updateTtsConfig: (config: Partial<TtsConfig>) =>
    request<TtsConfig>('/settings/tts', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getBrowserToolsConfig: () =>
    request<BrowserToolsConfig>('/settings/browser-tools'),

  updateBrowserToolsConfig: (config: Partial<BrowserToolsConfig>) =>
    request<BrowserToolsConfig>('/settings/browser-tools', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

  getSubAgentConfig: () =>
    request<SubAgentConfig>('/settings/sub-agents'),

  updateSubAgentConfig: (config: Partial<SubAgentConfig>) =>
    request<SubAgentConfig>('/settings/sub-agents', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),

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

  // UX-SOUL-MANAGE-001：人设删除 / 重命名
  deletePersona: (file: string) =>
    request<{ status: string; file: string }>(`/personas/${encodeURIComponent(file)}`, { method: 'DELETE' }),

  renamePersona: (file: string, newName: string) =>
    request<{ status: string; file: string }>(`/personas/${encodeURIComponent(file)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ new_name: newName }),
    }),

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
    request<MCPServerConfig & { status: string; servers: MCPServerInfo[]; tool_count: number }>(`/mcp/servers/${encodeURIComponent(serverId)}`, {
      method: 'DELETE',
    }),

  // 阶段 4.1：列出某 MCP 服务器加载的所有工具名（供前端勾选 allowlist）
  listMcpServerTools: (serverId: string) =>
    request<MCPServerToolsResponse>(`/mcp/servers/${encodeURIComponent(serverId)}/tools`),

  // MCP-WIRE-001：热加载 MCP 配置到所有活跃会话（保存/删除/启停后调用，
  // 否则新配置仅在新会话生效）
  reloadMcp: () =>
    request<{ status: string; reloaded: number }>('/mcp/reload', { method: 'POST' }),

  // 获取 OMP 自动发现的 MCP 服务器
  listMcpDiscovered: () =>
    request<DiscoveredServer[]>('/mcp/discovered'),

  // 测试 MCP 服务器连接（stdio 命令解析 + 子进程启动探测 / URL 类 HTTP 可达性探测）
  testMcpConnection: (body: { command: string; args: string[]; env: Record<string, string>; transport?: string; url?: string }) =>
    request<{ success: boolean; error: string | null; resolved_command: string }>('/mcp/test-connection', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── MCP Registry 市场（Smithery 代理） ──

  getMcpRegistry: (params?: { q?: string; page?: number; page_size?: number }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.page) qs.set('page', String(params.page))
    if (params?.page_size) qs.set('page_size', String(params.page_size))
    const query = qs.toString()
    return request<RegistryListResponse>(`/mcp/registry${query ? `?${query}` : ''}`)
  },

  installMcpFromRegistry: (name: string, body?: { server_id?: string; config?: Record<string, unknown> }) =>
    request<RegistryInstallResponse>('/mcp/registry/install', {
      method: 'POST',
      body: JSON.stringify({ name, ...body }),
    }),

  // ── MCP OAuth 授权 ──

  mcpOAuthAuthorize: (serverName: string, options?: { client_id?: string; auth_endpoint?: string; redirect_uri?: string; scope?: string }) =>
    request<OAuthAuthorizeResponse>('/mcp/oauth/authorize', {
      method: 'POST',
      body: JSON.stringify({ server_name: serverName, ...options }),
    }),

  mcpOAuthStatus: (serverName: string) =>
    request<OAuthStatusResponse>(`/mcp/oauth/status/${encodeURIComponent(serverName)}`),

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

  // ── Capabilities 能力仪表盘 ──

  /** 获取能力仪表盘数据 */
  getCapabilities: () =>
    request<CapabilitiesResponse>('/capabilities'),

  // ── Plugin 管理 ──

  listPlugins: () =>
    request<Plugin[]>('/plugins'),

  getPluginDetail: (name: string) =>
    request<PluginDetail>(`/plugins/${encodeURIComponent(name)}`),

  installPlugin: (body: InstallPluginRequest) =>
    request<InstallPluginResponse>('/plugins/install', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  uninstallPlugin: (name: string) =>
    request<{ ok: boolean }>(`/plugins/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  togglePlugin: (name: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/plugins/${encodeURIComponent(name)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),

  updatePluginConfig: (name: string, config: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/plugins/${encodeURIComponent(name)}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),

  getPluginConfig: (name: string) =>
    request<{ config: Record<string, unknown> }>(`/plugins/${encodeURIComponent(name)}/config`),

  // ── Collaboration 协作 ──

  listSessionShares: (sessionId: string) =>
    request<SessionShare[]>(`/sessions/${encodeURIComponent(sessionId)}/shares`),

  createSessionShare: (body: CreateShareRequest) =>
    request<SessionShare>(`/sessions/${encodeURIComponent(body.session_id)}/shares`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeSessionShare: (shareId: string) =>
    request<{ ok: boolean }>(`/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
    }),

  listSessionSnapshots: (sessionId: string) =>
    request<SessionSnapshot[]>(`/sessions/${encodeURIComponent(sessionId)}/snapshots`),

  createSessionSnapshot: (sessionId: string, title: string) =>
    request<SessionSnapshot>(`/sessions/${encodeURIComponent(sessionId)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  deleteSessionSnapshot: (snapshotId: string) =>
    request<{ ok: boolean }>(`/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
    }),

  // ── Rules 质量规则管理 ──

  createRule: (body: {
    id?: string
    name: string
    description: string
    language: string
    severity: 'error' | 'warning' | 'info'
    pattern?: string
    enabled?: boolean
  }) =>
    request<{
      id: string
      name: string
      description: string
      language: string
      severity: string
      pattern: string
      enabled: boolean
      source: 'custom'
      editable: true
    }>('/rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRule: (ruleId: string, body: {
    name?: string
    description?: string
    language?: string
    severity?: 'error' | 'warning' | 'info'
    pattern?: string
    enabled?: boolean
  }) =>
    request<{
      id: string
      name: string
      description: string
      language: string
      severity: string
      pattern: string
      enabled: boolean
      source: 'custom'
      editable: true
    }>(`/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  deleteRule: (ruleId: string) =>
    request<{ status: string; id: string }>(`/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    }),

  toggleRule: (ruleId: string, enabled: boolean) =>
    request<{
      id: string
      name: string
      description: string
      language: string
      severity: string
      pattern: string
      enabled: boolean
      source: 'builtin' | 'custom'
      editable: boolean
    }>(`/rules/${encodeURIComponent(ruleId)}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
}

export { request }
