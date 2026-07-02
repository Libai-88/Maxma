import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { ChatTurn, ContextUsage } from '@/types'

const TURNS_KEY_PREFIX = 'maxma_turns_'

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

  return {
    channels, allSessionStatuses,
    getOrCreateChannel, removeChannel,
    removeTurnsFromStorage, saveTurnsToStorage, loadTurnsFromStorage,
    cleanupOrphanedCaches,
  }
})
