import { create } from 'zustand'
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from '@/lib/storage'
export { safeGetItem, safeKeys, safeRemoveItem, safeSetItem }
import type {
  ChatTurn, ContextUsage, CompactionReason, CompactionAction,
  TaskReviewState, PermissionMode,
} from '@/types'
import type { ModelInfo, ChatContextUsage } from '@/types/chat'
import { api } from '@/api'
import { isLocalProvider } from '@/utils/provider'
import { createLogger } from '@/utils/logger'
import { parseReferences } from '@/utils/references'

export type { ChatContextUsage, ModelInfo } from '@/types/chat'

const log = createLogger('chat')

export const TURNS_KEY_PREFIX = 'maxma_turns_'

export const DEFAULT_CONTEXT_USAGE: ChatContextUsage = {
  estimatedTokens: 0,
  maxTokens: 128000,
  percentage: 0,
  messageCount: 0,
  modelName: '',
}

// ── COMPAT-STORAGE-001：localStorage 安全访问包装 ───────────────
// Safari「阻止所有 Cookie」/Firefox 严格隐私模式/被禁用的 WebView2 中，
// 访问 localStorage 属性本身即抛 SecurityError，写入时抛 QuotaExceededError。
// 所有读写统一走下列包装，存储不可用时静默降级为「无持久化」。

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== undefined) return number
  }
  return undefined
}

/** Convert both current WS payload formats into the UI's stable camelCase shape. */
export function normalizeContextUsage(payload: unknown, previous: ChatContextUsage = DEFAULT_CONTEXT_USAGE): ChatContextUsage {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}

  const estimatedTokens = Math.max(0, firstFinite(
    data.estimated_tokens, data.estimatedTokens, data.current_tokens,
  ) ?? previous.estimatedTokens)

  // 稳定 maxTokens：同一模型下窗口上限不应来回跳动；只在首次设置、模型切换或值变大时更新。
  const rawMaxTokens = firstFinite(data.max_tokens, data.maxTokens)
  const incomingModelName = typeof data.model_name === 'string' && data.model_name
    ? data.model_name
    : typeof data.modelName === 'string' && data.modelName
      ? data.modelName
      : ''
  const modelChanged = !!incomingModelName && incomingModelName !== previous.modelName
  let maxTokens = previous.maxTokens || DEFAULT_CONTEXT_USAGE.maxTokens
  if (rawMaxTokens !== undefined && (modelChanged || rawMaxTokens > maxTokens || !previous.maxTokens)) {
    maxTokens = Math.max(1, rawMaxTokens)
  }

  const messageCount = Math.max(0, firstFinite(
    data.message_count, data.messageCount,
  ) ?? previous.messageCount)
  const modelName = incomingModelName || previous.modelName

  const rawPercentage = firstFinite(
    data.percentage, data.usage_percent, data.usagePercentage,
  )
  const percentage = rawPercentage === undefined
    ? (estimatedTokens / maxTokens) * 100
    : rawPercentage < 1
      ? rawPercentage * 100
      : rawPercentage

  return {
    estimatedTokens,
    maxTokens,
    percentage: Math.min(100, Math.max(0, percentage)),
    messageCount,
    modelName,
    inputTokens: firstFinite(data.input_tokens, data.inputTokens) ?? previous.inputTokens,
    outputTokens: firstFinite(data.output_tokens, data.outputTokens) ?? previous.outputTokens,
    cacheReadTokens: firstFinite(data.cache_read_tokens, data.cacheReadTokens) ?? previous.cacheReadTokens,
    cacheWriteTokens: firstFinite(data.cache_write_tokens, data.cacheWriteTokens) ?? previous.cacheWriteTokens,
    cacheHitRate: firstFinite(data.cache_hit_rate, data.cacheHitRate) ?? previous.cacheHitRate ?? null,
    outputSpeed: firstFinite(data.output_speed, data.outputSpeed) ?? previous.outputSpeed,
    latencyMs: firstFinite(data.latency_ms, data.latencyMs) ?? previous.latencyMs,
  }
}

export interface SessionChannel {
  ws: WebSocket | null
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
  turns: ChatTurn[]
  currentTurn: ChatTurn | null
  error: string | null
  errorCategory: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled' | null
  errorTraceId: string | null
  errorDiagnostic: Record<string, unknown> | null
  contextUsage: ContextUsage | null
  taskTrackerData: Record<string, unknown> | null
  /** 流式任务连续性：用于导航离开后的状态反馈与未读提示。 */
  isChatViewActive: boolean
  streamPhase: 'idle' | 'streaming' | 'awaiting_user' | 'completed' | 'error'
  unreadEvents: number
  streamStartedAt: number | null
  lastActivityAt: number | null
  lastCompletedAt: number | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number
  initialized: boolean
  _awaitingToolName: string | null
  privateMode: boolean
  autoApprove: boolean
  /**
   * PERM-ANNOUNCE-001：内核广播 `record.permissionMode` 的**当前真值**
   * （`permission_mode_updated` 事件），null = 这个通道还没收到过事件、只能信 GET。
   * 「自动执行」开关与权限选择器都从这里收敛，两边不再各存一份档位。
   */
  permissionMode: PermissionMode | null
  _pingTimer: ReturnType<typeof setInterval> | null  // 心跳 ping 定时器
  _lastPongAt: number  // 上次收到 pong 的时间戳（ms），用于检测静默断开
  /** context_compressing 在 currentTurn 为 null 时缓存，待下一轮创建后回放 */
  pendingCompaction?: { reason: CompactionReason; action: CompactionAction }
  /** 最近一次 done 事件的 turn_id（TURN-OWNERSHIP-001：用于丢弃已终结轮次的迟到事件） */
  _lastDoneTurnId: string | null
  /** 轮次看门狗定时器（TURN-WATCHDOG-001）：后端任务挂起时强制复位流式状态 */
  _turnWatchdog: ReturnType<typeof setTimeout> | null
  /** 发送时私密模式（PRIVATE-SWITCH-001）：done 落盘判定用发送时值 */
  _privateAtSend: boolean | null
  /** GAP-B1-001：目标模式状态（goal_updated 事件 / goal_action 回执更新） */
  goalState: GoalChannelState | null
  taskBrief: TaskBriefState | null
  taskReview: TaskReviewState | null
  /** CHAT-UX-012：最近一次失败轮次在 turns 中的索引，供重试定位。 */
  failedTurnIndex?: number | null
}

export interface TaskBriefState {
  turnId: string
  status: 'thinking' | 'clarify' | 'ready' | 'fallback'
  summary?: string
  questions?: string[]
  missing?: string[]
  assumptions?: string[]
  confidence?: number
  riskLevel?: 'low' | 'medium' | 'high'
  executionPrompt?: string
  error?: string
}

/** GAP-B1-001：目标模式状态（与 OMP GoalModeState/Goal 字段对齐的子集） */
export interface GoalChannelState {
  goal: {
    id: string
    objective: string
    status: 'active' | 'paused' | 'budget-limited' | 'complete' | 'dropped'
    tokensUsed?: number
    tokenBudget?: number
  } | null
  state?: { enabled?: boolean; mode?: string } | null
}

function createChannel(): SessionChannel {
  return {
    ws: null, connected: false, isStreaming: false, isAwaitingUser: false,
    turns: [], currentTurn: null, error: null, errorCategory: null,
    errorTraceId: null, errorDiagnostic: null, contextUsage: null, taskTrackerData: null,
    isChatViewActive: false, streamPhase: 'idle', unreadEvents: 0,
    streamStartedAt: null, lastActivityAt: null, lastCompletedAt: null,
    reconnectTimer: null, reconnectAttempts: 0, initialized: false,
    _awaitingToolName: null,
    privateMode: false, autoApprove: false, permissionMode: null, _pingTimer: null, _lastPongAt: 0,
    _lastDoneTurnId: null,
    _turnWatchdog: null,
    _privateAtSend: null,
    goalState: null,
    taskBrief: null,
    taskReview: null,
    failedTurnIndex: null,
  }
}

/** allSessionStatuses 单条状态（由 channels 派生）。 */
export interface SessionStatus {
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
  streamPhase: SessionChannel['streamPhase']
  unreadEvents: number
  streamStartedAt: number | null
  lastActivityAt: number | null
}

function computeStatuses(channels: Map<string, SessionChannel>): Record<string, SessionStatus> {
  const map: Record<string, SessionStatus> = {}
  for (const [sid, ch] of channels) {
    map[sid] = {
      connected: ch.connected,
      isStreaming: ch.isStreaming,
      isAwaitingUser: ch.isAwaitingUser,
      streamPhase: ch.streamPhase,
      unreadEvents: ch.unreadEvents,
      streamStartedAt: ch.streamStartedAt,
      lastActivityAt: ch.lastActivityAt,
    }
  }
  return map
}

// ── settings 持久化（R1-SETTINGS-PERSIST-001） ──────────────────
const SETTINGS_STORAGE_KEY = 'maxma_chat_settings'
interface PersistedChatSettings {
  model?: string
  temperature?: number
  maxTokens?: number
  thinking?: boolean
  thinkingLevel?: string
  taskBriefEnabled?: boolean
}
function loadPersistedChatSettings(): PersistedChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
const _persisted = loadPersistedChatSettings()

const _initialModel = typeof _persisted.model === 'string' && _persisted.model ? _persisted.model : 'gpt-4o'
const _initialTemperature = typeof _persisted.temperature === 'number' && Number.isFinite(_persisted.temperature) ? _persisted.temperature : 0.7
const _initialMaxTokens = typeof _persisted.maxTokens === 'number' && Number.isFinite(_persisted.maxTokens) ? _persisted.maxTokens : 4096
// THINKING-LEVELS-001：思考强度从 bool 升级为多级字符串，兼容旧持久化格式（bool → high/off）。
const _initialThinkingLevel = typeof _persisted.thinkingLevel === 'string' && _persisted.thinkingLevel
  ? _persisted.thinkingLevel
  : typeof _persisted.thinking === 'boolean'
    ? (_persisted.thinking ? 'high' : 'off')
    : 'off'

function persistChatSettings(s: {
  currentModel: string; temperature: number; maxTokens: number;
  thinkingLevel: string; taskBriefEnabled: boolean
}) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      model: s.currentModel,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      thinkingLevel: s.thinkingLevel,
      thinking: s.thinkingLevel !== 'off',
      taskBriefEnabled: s.taskBriefEnabled,
    }))
  } catch {
    // 配额超限时静默失败——设置丢失可接受，不阻塞主流程
  }
}

// ── zustand store ───────────────────────────────────────────────
export interface ChatState {
  /** channel 对象保持可变（直接 push/改字段），靠 version 触发 React 重渲染。 */
  channels: Map<string, SessionChannel>
  version: number
  allSessionStatuses: Record<string, SessionStatus>
  currentModel: string
  availableModels: ModelInfo[]
  temperature: number
  maxTokens: number
  thinkingEnabled: boolean
  thinkingLevel: string
  taskBriefEnabled: boolean
  contextUsage: ChatContextUsage

  ensureChannel(sid: string): SessionChannel
  getChannel(sid: string): SessionChannel
  getOrCreateChannel(sid: string): SessionChannel
  removeChannel(sid: string): void
  disconnectChannel(sid: string): void
  bump(): void
  setAllSessionStatuses(statuses: Record<string, SessionStatus>): void
  markSessionView(sid: string, active: boolean): void
  removeTurnsFromStorage(sid: string): void
  loadTurnsFromStorage(sid: string): ChatTurn[] | null
  cleanupOrphanedCaches(validIds: Set<string>): void
  setModel(modelId: string): void
  setTemperature(val: number): void
  setMaxTokens(val: number): void
  toggleThinking(enabled: boolean): void
  setThinkingLevel(level: string): void
  setTaskBriefEnabled(enabled: boolean): void
  updateContextUsage(usage: Partial<ChatContextUsage>): void
  fetchAvailableModels(options?: { force?: boolean }): Promise<void>
}

let _modelsFetching: Promise<void> | null = null
const builtinModelNames: Record<string, string> = {
  'mimo-v2.6-flash-free': 'MiMo V2.6 Flash',
  'space-bunny-free': 'Space Bunny',
}

export const useChatStore = create<ChatState>()((set, get) => ({
  channels: new Map<string, SessionChannel>(),
  version: 0,
  allSessionStatuses: {},
  currentModel: _initialModel,
  availableModels: [],
  temperature: _initialTemperature,
  maxTokens: _initialMaxTokens,
  thinkingEnabled: _initialThinkingLevel !== 'off',
  thinkingLevel: _initialThinkingLevel,
  taskBriefEnabled: _persisted.taskBriefEnabled === true,
  contextUsage: { ...DEFAULT_CONTEXT_USAGE },

  /**
   * 取得通道；不存在则原地创建（不触发 set，供 render 期安全调用）。
   * channel 对象稳定可变，所有事件处理直接改它，再由 bump() 通知 React。
   */
  getChannel(sid: string): SessionChannel {
    const s = get()
    let ch = s.channels.get(sid)
    if (!ch) {
      ch = createChannel()
      s.channels.set(sid, ch)
    }
    return ch
  },

  getOrCreateChannel(sid: string): SessionChannel {
    return get().getChannel(sid)
  },

  /** 确保通道存在并 bump（事件处理/连接状态变更后调用）。 */
  ensureChannel(sid: string): SessionChannel {
    const ch = get().getChannel(sid)
    set(s => ({ version: s.version + 1, allSessionStatuses: computeStatuses(s.channels) }))
    return ch
  },

  removeChannel(sid: string): void {
    const s = get()
    s.channels.delete(sid)
    set(st => ({ version: st.version + 1, allSessionStatuses: computeStatuses(st.channels) }))
  },

  /**
   * 完整断开一个会话通道（DELETE-SESSION-001）。
   * 删除会话时必须先断开 WS 并终止进行中的 agent 任务。
   */
  disconnectChannel(sid: string): void {
    const ch = get().channels.get(sid)
    if (!ch) return
    if (ch.reconnectTimer) { clearTimeout(ch.reconnectTimer); ch.reconnectTimer = null }
    if (ch._pingTimer) { clearInterval(ch._pingTimer); ch._pingTimer = null }
    if (ch.ws) {
      ch.ws.onclose = null
      ch.ws.close()
      ch.ws = null
    }
    ch.connected = false
    ch.initialized = false
    get().channels.delete(sid)
    set(st => ({ version: st.version + 1, allSessionStatuses: computeStatuses(st.channels) }))
  },

  /** 每次事件处理/状态变更后调用：递增 version 触发订阅组件重渲染，并刷新派生状态。 */
  bump(): void {
    set(s => ({ version: s.version + 1, allSessionStatuses: computeStatuses(s.channels) }))
  },

  setAllSessionStatuses(statuses: Record<string, SessionStatus>): void {
    set(s => ({ allSessionStatuses: statuses, version: s.version + 1 }))
  },

  /** 标记当前会话是否正在对话页可见；离开时保留任务，回来时清除未读提示。 */
  markSessionView(sid: string, active: boolean): void {
    const ch = get().channels.get(sid)
    if (!ch) return
    ch.isChatViewActive = active
    if (active) ch.unreadEvents = 0
    set(s => ({ version: s.version + 1, allSessionStatuses: computeStatuses(s.channels) }))
  },

  removeTurnsFromStorage(sid: string): void {
    safeRemoveItem(TURNS_KEY_PREFIX + sid)
  },

  loadTurnsFromStorage(sid: string): ChatTurn[] | null {
    try {
      const raw = safeGetItem(TURNS_KEY_PREFIX + sid)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  },

  cleanupOrphanedCaches(validIds: Set<string>): void {
    // 先收集要删除的 key，再统一删除。直接在遍历中 removeItem 会导致
    // localStorage 索引位移，连续的孤儿缓存会被跳过（每隔一个漏删一个）。
    const keysToRemove: string[] = []
    for (const key of safeKeys()) {
      if (key && key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      safeRemoveItem(key)
    }
  },

  setModel(modelId: string): void {
    set(s => {
      const next = { ...s, currentModel: modelId }
      persistChatSettings(next)
      return { currentModel: modelId, version: s.version + 1 }
    })
  },

  setTemperature(val: number): void {
    const temperature = Math.max(0, Math.min(2, val))
    set(s => {
      persistChatSettings({ ...s, temperature })
      return { temperature, version: s.version + 1 }
    })
  },

  // MAXTOKENS-CLAMP-001：输出上限上限 65536
  setMaxTokens(val: number): void {
    const maxTokens = Math.max(256, Math.min(65536, val))
    set(s => {
      persistChatSettings({ ...s, maxTokens })
      return { maxTokens, version: s.version + 1 }
    })
  },

  toggleThinking(enabled: boolean): void {
    const thinkingLevel = enabled ? 'high' : 'off'
    set(s => {
      persistChatSettings({ ...s, thinkingLevel })
      return { thinkingLevel, thinkingEnabled: thinkingLevel !== 'off', version: s.version + 1 }
    })
  },

  setThinkingLevel(level: string): void {
    set(s => {
      persistChatSettings({ ...s, thinkingLevel: level })
      return { thinkingLevel: level, thinkingEnabled: level !== 'off', version: s.version + 1 }
    })
  },

  setTaskBriefEnabled(enabled: boolean): void {
    set(s => {
      persistChatSettings({ ...s, taskBriefEnabled: enabled })
      return { taskBriefEnabled: enabled, version: s.version + 1 }
    })
  },

  updateContextUsage(usage: Partial<ChatContextUsage>): void {
    set(s => ({
      contextUsage: normalizeContextUsage(usage, s.contextUsage),
      version: s.version + 1,
    }))
  },

  async fetchAvailableModels(options?: { force?: boolean }): Promise<void> {
    // PERF-MODELS-DEDUP-001：多组件并发调用时复用同一在途请求。
    if (_modelsFetching && !options?.force) return _modelsFetching
    if (_modelsFetching && options?.force) await _modelsFetching.catch(() => {})
    _modelsFetching = (async () => {
      try {
        const data = await api.listProviders()
        const models: ModelInfo[] = []
        const providers = Array.isArray(data) ? data : (data as unknown as Record<string, unknown>).providers
        if (Array.isArray(providers)) {
          for (const p of providers) {
            const hasApiKey = p.api_key_configured === true || Boolean(p.api_key && p.api_key.trim())
            if (!p.enabled || (!isLocalProvider(p.provider_type, p.base_url) && !hasApiKey)) continue
            if (Array.isArray(p.models)) {
              for (const m of p.models) {
                const modelInfo: ModelInfo = {
                  id: `${p.id}/${m}`,
                  provider: p.id,
                  providerLabel: p.builtin ? 'Maxma 免费模型' : (p.label || p.id),
                  name: m,
                  contextWindow: p.context_window || 128000,
                }
                if (p.builtin && builtinModelNames[m]) modelInfo.displayName = builtinModelNames[m]
                models.push(modelInfo)
              }
            }
          }
        }
        try {
          const pluginModels = await api.listPluginModels('codearts-auth')
          for (const p of Array.isArray(pluginModels?.providers) ? pluginModels.providers : []) {
            for (const m of Array.isArray(p.models) ? p.models : []) {
              // name 必须放模型 id（发往 chat-ws 的 model_name，插件按 id 解析）
              const displayName = m.name && m.name !== m.id ? m.name : undefined
              models.push({
                id: `${p.id}/${m.id}`,
                provider: p.id,
                providerLabel: p.name || p.id,
                name: m.id,
                ...(displayName ? { displayName } : {}),
                contextWindow: 128000,
                source: 'plugin',
              })
            }
          }
        } catch {
          /* 插件不可用时不影响 Maxma 自身模型列表 */
        }
        set(s => ({ availableModels: models, version: s.version + 1 }))
      } catch { /* Use defaults */ }
      finally { _modelsFetching = null }
    })()
    return _modelsFetching
  },
}))

/** 模块级辅助：取当前 zustand store 快照。 */
export function getChatStore() { return useChatStore.getState() }

/** 触发一次 React 重渲染（等价于 useChatStore.getState().bump()）。 */
export function bump() { useChatStore.getState().bump() }

/** Lazy export — 运行时才访问 Store（对齐旧版 getAllSessionStatuses）。 */
export function getAllSessionStatuses(): Record<string, SessionStatus> {
  return useChatStore.getState().allSessionStatuses
}

// ── localStorage turns 缓存 ─────────────────────────────────────
/** 匹配旧格式尾缀（用于 localStorage 迁移） */
export const TIME_SUFFIX_RE = /（\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}）$/

/** 将旧格式 turn（userMessage 含 __refs__ 和时间尾缀）迁移为新格式 */
export function migrateLegacyTurn(turn: Record<string, unknown>): ChatTurn {
  if (Array.isArray(turn.refs)) {
    return { memoryEvents: [], ...turn } as unknown as ChatTurn
  }
  const prevMsg = (turn.userMessage ?? '') as string
  const { cleanText, refs } = parseReferences(prevMsg || '')
  const text = refs.length > 0 ? cleanText : prevMsg.replace(TIME_SUFFIX_RE, '')
  return { ...turn, userMessage: text, refs, memoryEvents: [] } as unknown as ChatTurn
}

// 从 localStorage 恢复所有会话的消息缓存（页面刷新后仍保留）
export function loadAllTurnsFromStorage(): Map<string, ChatTurn[]> {
  const map = new Map<string, ChatTurn[]>()
  try {
    const keysFound = safeKeys()
    for (const key of keysFound) {
      if (!key.startsWith(TURNS_KEY_PREFIX)) continue
      const sid = key.slice(TURNS_KEY_PREFIX.length)
      try {
        const raw = safeGetItem(key) || '[]'
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          const migrated = data.map(migrateLegacyTurn)
          log.debug(`从 localStorage 加载会话 ${sid}: ${data.length} 条 turn (迁移 ${migrated.length}), 序列化长度 ${raw.length}`)
          map.set(sid, migrated)
        } else {
          log.warn(`键 ${key} 的数据不是数组，跳过`)
        }
      } catch (e) {
        log.error(`解析 localStorage 键 ${key} 失败:`, e)
      }
    }
    log.debug(`localStorage 中共 ${keysFound.length} 个 ${TURNS_KEY_PREFIX}* 键, 恢复 ${map.size} 个会话的缓存`)
  } catch (e) {
    log.warn('读取 localStorage 失败（存储不可用？），按空缓存启动:', e)
  }
  return map
}

/** PERF-PERSIST-CAP-001：localStorage 持久化轮次上限（与后端 get_messages limit=500 一致）。 */
export const MAX_PERSISTED_TURNS = 500

/** 模块级缓存：首次 import 时从 localStorage 恢复所有会话的历史消息。 */
export const turnsCache: Map<string, ChatTurn[]> = loadAllTurnsFromStorage()

export function saveTurnsToStorage(sid: string, data: ChatTurn[]): void {
  const key = TURNS_KEY_PREFIX + sid
  const toPersist = data.length > MAX_PERSISTED_TURNS ? data.slice(-MAX_PERSISTED_TURNS) : data
  const tryWrite = () => {
    const serialized = JSON.stringify(toPersist)
    const size = new Blob([serialized]).size
    if (!safeSetItem(key, serialized)) {
      throw new DOMException('storage unavailable', 'QuotaExceededError')
    }
    return size
  }
  try {
    const size = tryWrite()
    log.debug(`保存会话 ${sid} 到 localStorage: ${data.length} 条 turn, 约 ${(size / 1024).toFixed(1)} KB, key=${key}`)
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      log.warn(`localStorage 配额超限，尝试清理其他会话缓存后重试 (key=${key})`)
      const otherKeys = safeKeys().filter(k => k.startsWith(TURNS_KEY_PREFIX) && k !== key)
      const toEvict = otherKeys.slice(0, Math.max(1, Math.ceil(otherKeys.length / 2)))
      for (const k of toEvict) {
        safeRemoveItem(k)
        const evictedSid = k.slice(TURNS_KEY_PREFIX.length)
        turnsCache.delete(evictedSid)
        log.warn(`配额压力下清理会话 ${evictedSid} 的缓存`)
      }
      try {
        const size = tryWrite()
        log.debug(`清理后重试成功: 会话 ${sid}, ${data.length} 条 turn, 约 ${(size / 1024).toFixed(1)} KB`)
      } catch (e2) {
        log.error(`清理后仍无法保存会话 ${sid} (key=${key}):`, e2)
        safeRemoveItem(key)
      }
    } else {
      log.error(`保存会话 ${sid} 到 localStorage 失败 (key=${key}):`, e)
      let total = 0
      for (const k of safeKeys()) {
        total += k.length + (safeGetItem(k) || '').length
      }
      log.warn(`localStorage 当前总估算用量: ${(total * 2 / 1024).toFixed(1)} KB`)
    }
  }
}

// ── 持久化防抖（PERF-002） ──────────────────────────────────────
const PERSIST_DEBOUNCE_MS = 800
const _persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function persistTurns(sid: string): void {
  const ch = useChatStore.getState().channels.get(sid)
  if (!ch) {
    log.warn(`跳过保存 sid="${sid}": 通道不存在`)
    return
  }
  const snapshot = [...ch.turns]
  log.debug(`持久化会话 ${sid}: ${snapshot.length} 条 turn (防抖 ${PERSIST_DEBOUNCE_MS}ms)`)
  turnsCache.set(sid, snapshot)
  const existing = _persistTimers.get(sid)
  if (existing) clearTimeout(existing)
  _persistTimers.set(sid, setTimeout(() => {
    _persistTimers.delete(sid)
    saveTurnsToStorage(sid, snapshot)
  }, PERSIST_DEBOUNCE_MS))
  bump()
}

/** 同步落盘：取消挂起的防抖定时器并立即写入（切会话/WS 断开/组件卸载前调用）。 */
export function flushPersistTurns(sid: string): void {
  const timer = _persistTimers.get(sid)
  if (timer) {
    clearTimeout(timer)
    _persistTimers.delete(sid)
  }
  const ch = useChatStore.getState().channels.get(sid)
  if (!ch) return
  const snapshot = [...ch.turns]
  turnsCache.set(sid, snapshot)
  saveTurnsToStorage(sid, snapshot)
  bump()
}

/**
 * 页面离开（刷新/关闭窗口）兜底落盘（PAGE-LEAVE-001）。
 * pagehide 在刷新/关闭前同步触发，localStorage 为同步 API 可安全写入。
 */
export function flushAllTurnsOnPageLeave(): void {
  const store = useChatStore.getState()
  for (const [sid, ch] of store.channels) {
    if (!ch.initialized) continue
    if (ch.isStreaming && ch.currentTurn) {
      const interrupted = ch.currentTurn
      if (!interrupted.finalAnswer) {
        interrupted.finalAnswer = '（连接中断，回复未完成）'
      }
      ch.turns.push(interrupted)
      ch.currentTurn = null
      ch.isStreaming = false
      ch.streamPhase = ch.error ? 'error' : 'idle'
      ch.streamStartedAt = null
      ch.isAwaitingUser = false
      ch._awaitingToolName = null
      if (!ch.privateMode) {
        flushPersistTurns(sid)
      }
    } else if (ch.turns.length > 0) {
      flushPersistTurns(sid)
    }
  }
}

/** 清空会话时失效内存 turnsCache，防止切回会话后已清空的消息复活。 */
export function invalidateTurnsCache(sid: string): void {
  turnsCache.delete(sid)
}
