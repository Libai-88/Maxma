import { create } from 'zustand'
import { api } from '@/api'
import type { MetricsSnapshot, MetricsHistoryResponse } from '@/types'

interface MetricsState {
  snapshot: MetricsSnapshot | null
  history: MetricsHistoryResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  loadHistory: (windowSeconds?: number) => Promise<void>
}

export const useMetricsStore = create<MetricsState>()((set) => {
  async function refresh() {
    set({ loading: true, error: null })
    try {
      const snapshot = await api.getMetrics()
      set({ snapshot })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), snapshot: null })
    } finally {
      set({ loading: false })
    }
  }

  async function loadHistory(windowSeconds: number = 3600) {
    try {
      const history = await api.getMetricsHistory(windowSeconds)
      set({ history })
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), history: null })
    }
  }

  // 注：轮询由 MetricsView 自行管理（onMounted/onUnmounted 配对），
  // 此 store 不内置定时器（此前 startPolling/stopPolling 无调用者，已移除）

  return {
    snapshot: null,
    history: null,
    loading: false,
    error: null,
    refresh,
    loadHistory,
  }
})
