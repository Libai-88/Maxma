import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { ChatTurn, ContextUsage } from '@/types'
import type { ModelInfo, ChatContextUsage } from '../types/chat'

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
  const maxTokens = Math.max(1, firstFinite(
    data.max_tokens, data.maxTokens,
  ) ?? (previous.maxTokens || DEFAULT_CONTEXT_USAGE.maxTokens))
  const messageCount = Math.max(0, firstFinite(
    data.message_count, data.messageCount,
  ) ?? previous.messageCount)
  const modelName = typeof data.model_name === 'string' && data.model_name
    ? data.model_name
    : typeof data.modelName === 'string' && data.modelName
      ? data.modelName
      : previous.modelName

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

interface SessionChannel {
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
}

function createChannel(): SessionChannel {
  return {
    ws: null, connected: false, isStreaming: false, isAwaitingUser: false,
    turns: [], currentTurn: null, error: null, errorCategory: null,
    errorTraceId: null, contextUsage: null, taskTrackerData: null,
    reconnectTimer: null, reconnectAttempts: 0, initialized: false,
    _awaitingToolName: null, parentSessionId: null,
    privateMode: false, autoApprove: false, _pingTimer: null, _lastPongAt: 0,
  }
}

export const useChatStore = defineStore('chat', () => {
  const channels = reactive(new Map<string, SessionChannel>())

  // --- New state ---
  const currentModel = ref('gpt-4o')
  const availableModels = ref<ModelInfo[]>([])
  const temperature = ref(0.7)
  const maxTokens = ref(4096)
  const thinkingEnabled = ref(false)
  const contextUsage = ref<ChatContextUsage>({ ...DEFAULT_CONTEXT_USAGE })
  // --- End new state ---

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

  function removeTurnsFromStorage(sid: string) {
    localStorage.removeItem(TURNS_KEY_PREFIX + sid)
  }

  function loadTurnsFromStorage(sid: string): ChatTurn[] | null {
    try {
      const raw = localStorage.getItem(TURNS_KEY_PREFIX + sid)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function cleanupOrphanedCaches(validIds: Set<string>) {
    // 先收集要删除的 key，再统一删除。直接在遍历中 removeItem 会导致
    // localStorage 索引位移，连续的孤儿缓存会被跳过（每隔一个漏删一个）。
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
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

  async function fetchAvailableModels() {
    try {
      const { api } = await import('@/api')
      const data = await api.listProviders()
      const models: ModelInfo[] = []
	      const providers = Array.isArray(data) ? data : (data as unknown as Record<string, unknown>).providers
      if (Array.isArray(providers)) {
        for (const p of providers) {
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
  }
  // --- End new actions ---

  return {
    channels, allSessionStatuses, TURNS_KEY_PREFIX,
    getOrCreateChannel, removeChannel,
    removeTurnsFromStorage, loadTurnsFromStorage,
    cleanupOrphanedCaches,
    // --- New exports ---
    currentModel, availableModels, temperature, maxTokens, thinkingEnabled, contextUsage,
    setModel, setTemperature, setMaxTokens, toggleThinking, updateContextUsage, fetchAvailableModels,
  }
})

