import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { ChatTurn, ContextUsage } from '@/types'
import type { ModelInfo, ContextUsage as UIUsage } from '../types/chat'

export const TURNS_KEY_PREFIX = 'maxma_turns_'

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
}

function createChannel(): SessionChannel {
  return {
    ws: null, connected: false, isStreaming: false, isAwaitingUser: false,
    turns: [], currentTurn: null, error: null, errorCategory: null,
    errorTraceId: null, contextUsage: null, taskTrackerData: null,
    reconnectTimer: null, reconnectAttempts: 0, initialized: false,
    _awaitingToolName: null, parentSessionId: null,
    privateMode: false, autoApprove: false,
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
  const contextUsage = ref<UIUsage>({
    estimatedTokens: 0,
    maxTokens: 128000,
    percentage: 0,
    messageCount: 0,
    modelName: '',
  })
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

  function saveTurnsToStorage(sid: string, data: ChatTurn[]) {
    try {
      localStorage.setItem(TURNS_KEY_PREFIX + sid, JSON.stringify(data))
    } catch (e) {
      console.error(`[chat:save] localStorage 保存失败:`, e)
    }
  }

  function loadTurnsFromStorage(sid: string): ChatTurn[] | null {
    try {
      const raw = localStorage.getItem(TURNS_KEY_PREFIX + sid)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }

  function cleanupOrphanedCaches(validIds: Set<string>) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) localStorage.removeItem(key)
      }
    }
  }

  // --- New actions ---
  function setModel(modelId: string) { currentModel.value = modelId }
  function setTemperature(val: number) { temperature.value = Math.max(0, Math.min(2, val)) }
  function setMaxTokens(val: number) { maxTokens.value = Math.max(256, Math.min(256000, val)) }
  function toggleThinking(enabled: boolean) { thinkingEnabled.value = enabled }
  function updateContextUsage(usage: UIUsage) { contextUsage.value = usage }

  async function fetchAvailableModels() {
    try {
      const { getToken } = await import('../api/index')
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      const res = await fetch('/api/providers', { headers })
      const data = await res.json()
      const models: ModelInfo[] = []
      if (Array.isArray(data)) {
        for (const p of data) {
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
    removeTurnsFromStorage, saveTurnsToStorage, loadTurnsFromStorage,
    cleanupOrphanedCaches,
    // --- New exports ---
    currentModel, availableModels, temperature, maxTokens, thinkingEnabled, contextUsage,
    setModel, setTemperature, setMaxTokens, toggleThinking, updateContextUsage, fetchAvailableModels,
  }
})

/** 便捷工具函数：从 localStorage 移除指定会话的 turns 缓存 */
export function removeTurnsFromStorage(sid: string) {
  localStorage.removeItem(TURNS_KEY_PREFIX + sid)
}
