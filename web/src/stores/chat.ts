import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { ChatTurn, ContextUsage, CompactionReason, CompactionAction } from '@/types'
import type { ModelInfo, ChatContextUsage } from '../types/chat'
// S4-2: api 已被 30+ 文件静态引用进主 chunk，此处动态导入不会触发拆分（纯噪音），改静态
import { api } from '@/api'
import { safeGetItem, safeKeys, safeRemoveItem } from '@/lib/storage'

export const TURNS_KEY_PREFIX = 'maxma_turns_'

const DEFAULT_CONTEXT_USAGE: ChatContextUsage = {
  estimatedTokens: 0,
  maxTokens: 128000,
  percentage: 0,
  messageCount: 0,
  modelName: '',
}

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
  contextUsage: ContextUsage | null
  taskTrackerData: Record<string, unknown> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number
  initialized: boolean
  _awaitingToolName: string | null
  parentSessionId: string | null
  privateMode: boolean
  autoApprove: boolean
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
}

function createChannel(): SessionChannel {
  return {
    ws: null, connected: false, isStreaming: false, isAwaitingUser: false,
    turns: [], currentTurn: null, error: null, errorCategory: null,
    errorTraceId: null, contextUsage: null, taskTrackerData: null,
    reconnectTimer: null, reconnectAttempts: 0, initialized: false,
    _awaitingToolName: null, parentSessionId: null,
    privateMode: false, autoApprove: false, _pingTimer: null, _lastPongAt: 0,
    _lastDoneTurnId: null,
    _turnWatchdog: null,
    _privateAtSend: null,
  }
}

export const useChatStore = defineStore('chat', () => {
  const channels = reactive(new Map<string, SessionChannel>())

  // --- New state ---
  // R1-SETTINGS-PERSIST-001：模型/温度/输出上限/思考开关此前全部为内存态，
  // 页面刷新（Tauri 崩溃恢复/重启）后全部回默认。现在持久化到 localStorage，
  // 初始化时恢复、变更时保存。
  const SETTINGS_STORAGE_KEY = 'maxma_chat_settings'
  function loadPersistedChatSettings(): { model?: string; temperature?: number; maxTokens?: number; thinking?: boolean } {
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

  const currentModel = ref<string>(typeof _persisted.model === 'string' && _persisted.model ? _persisted.model : 'gpt-4o')
  const availableModels = shallowRef<ModelInfo[]>([])
  const temperature = ref<number>(typeof _persisted.temperature === 'number' && Number.isFinite(_persisted.temperature) ? _persisted.temperature : 0.7)
  const maxTokens = ref<number>(typeof _persisted.maxTokens === 'number' && Number.isFinite(_persisted.maxTokens) ? _persisted.maxTokens : 4096)
  const thinkingEnabled = ref<boolean>(typeof _persisted.thinking === 'boolean' ? _persisted.thinking : false)
  const contextUsage = ref<ChatContextUsage>({ ...DEFAULT_CONTEXT_USAGE })
  // --- End new state ---

  function persistChatSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        model: currentModel.value,
        temperature: temperature.value,
        maxTokens: maxTokens.value,
        thinking: thinkingEnabled.value,
      }))
    } catch {
      // 配额超限时静默失败——设置丢失可接受，不阻塞主流程
    }
  }
  watch([currentModel, temperature, maxTokens, thinkingEnabled], persistChatSettings)

  const allSessionStatuses = computed(() => {
    const map: Record<string, { connected: boolean; isStreaming: boolean; isAwaitingUser: boolean }> = {}
    for (const [sid, ch] of channels) {
      map[sid] = { connected: ch.connected, isStreaming: ch.isStreaming, isAwaitingUser: ch.isAwaitingUser }
    }
    return map
  })

  function getOrCreateChannel(sid: string): SessionChannel {
    if (!channels.has(sid)) {
      channels.set(sid, createChannel())
    }
    return channels.get(sid)!
  }

  function removeChannel(sid: string) {
    channels.delete(sid)
  }

  /**
   * 完整断开一个会话通道（DELETE-SESSION-001）。
   * 删除会话时必须先断开 WS 并终止进行中的 agent 任务——此前只删 localStorage
   * 缓存，被删会话的 channel 仍存活：流式中删除时任务在后台继续跑、事件继续
   * 到达、persistTurns 把已删缓存重新写回（缓存复活）。
   * 放这里而非 useChat.ts：session store 删除流程需要调用，避免循环依赖。
   */
  function disconnectChannel(sid: string) {
    const ch = channels.get(sid)
    if (!ch) return
    if (ch.reconnectTimer) {
      clearTimeout(ch.reconnectTimer)
      ch.reconnectTimer = null
    }
    if (ch._pingTimer) {
      clearInterval(ch._pingTimer)
      ch._pingTimer = null
    }
    if (ch.ws) {
      ch.ws.onclose = null
      ch.ws.close()
      ch.ws = null
    }
    ch.connected = false
    ch.initialized = false
    channels.delete(sid)
  }

  function removeTurnsFromStorage(sid: string) {
    // COMPAT-STORAGE-001：安全删除（存储不可用时静默）
    safeRemoveItem(TURNS_KEY_PREFIX + sid)
  }

  function loadTurnsFromStorage(sid: string): ChatTurn[] | null {
    try {
      const raw = safeGetItem(TURNS_KEY_PREFIX + sid)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function cleanupOrphanedCaches(validIds: Set<string>) {
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
  }

  // --- New actions ---
  function setModel(modelId: string) { currentModel.value = modelId }
  function setTemperature(val: number) { temperature.value = Math.max(0, Math.min(2, val)) }
  function setMaxTokens(val: number) { maxTokens.value = Math.max(256, Math.min(256000, val)) }
  function toggleThinking(enabled: boolean) { thinkingEnabled.value = enabled }
  function updateContextUsage(usage: Partial<ChatContextUsage>) {
    contextUsage.value = normalizeContextUsage(usage, contextUsage.value)
  }

  let _modelsFetching: Promise<void> | null = null
  async function fetchAvailableModels() {
    // PERF-MODELS-DEDUP-001：多组件（ChatView/ModelSelector/ProvidersView）
    // 并发调用时复用同一在途请求，避免重复拉取 provider 列表
    if (_modelsFetching) return _modelsFetching
    _modelsFetching = (async () => {
      try {
        const data = await api.listProviders()
        const models: ModelInfo[] = []
        const providers = Array.isArray(data) ? data : (data as unknown as Record<string, unknown>).providers
        if (Array.isArray(providers)) {
          for (const p of providers) {
            // 只包含已启用且有 api_key 的 provider（过滤掉默认模板和未配置的 provider）
            if (!p.enabled || !p.api_key || p.api_key.trim() === '') {
              continue
            }
            if (Array.isArray(p.models)) {
              for (const m of p.models) {
                models.push({
                  id: `${p.id}/${m}`,
                  provider: p.id,
                  name: m,
                  contextWindow: p.context_window || 128000,
                })
              }
            }
          }
        }
        availableModels.value = models
      } catch { /* Use defaults */ }
      finally { _modelsFetching = null }
    })()
    return _modelsFetching
  }
  // --- End new actions ---

  return {
    channels, allSessionStatuses, TURNS_KEY_PREFIX,
    getOrCreateChannel, removeChannel, disconnectChannel,
    removeTurnsFromStorage, loadTurnsFromStorage,
    cleanupOrphanedCaches,
    // --- New exports ---
    currentModel, availableModels, temperature, maxTokens, thinkingEnabled, contextUsage,
    setModel, setTemperature, setMaxTokens, toggleThinking, updateContextUsage, fetchAvailableModels,
  }
})

