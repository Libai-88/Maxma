import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { MetricsSnapshot, MetricsHistoryResponse } from '@/types'

export const useMetricsStore = defineStore('metrics', () => {
  const snapshot = ref<MetricsSnapshot | null>(null)
  const history = ref<MetricsHistoryResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      snapshot.value = await api.getMetrics()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
      snapshot.value = null
    } finally {
      loading.value = false
    }
  }

  async function loadHistory(windowSeconds: number = 3600) {
    try {
      history.value = await api.getMetricsHistory(windowSeconds)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
      history.value = null
    }
  }

  // 注：轮询由 MetricsView 自行管理（onMounted/onUnmounted 配对），
  // 此 store 不内置定时器（此前 startPolling/stopPolling 无调用者，已移除）

  return { snapshot, history, loading, error, refresh, loadHistory }
})
