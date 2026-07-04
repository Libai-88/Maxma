import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { MetricsSnapshot, MetricsHistoryResponse } from '@/types'

export const useMetricsStore = defineStore('metrics', () => {
  const snapshot = ref<MetricsSnapshot | null>(null)
  const history = ref<MetricsHistoryResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let _timer: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      snapshot.value = await api.getMetrics()
    } catch (e: any) {
      error.value = e?.message || String(e)
      snapshot.value = null
    } finally {
      loading.value = false
    }
  }

  async function loadHistory(windowSeconds: number = 3600) {
    try {
      history.value = await api.getMetricsHistory(windowSeconds)
    } catch (e: any) {
      error.value = e?.message || String(e)
      history.value = null
    }
  }

  function startPolling(intervalMs: number = 15000) {
    stopPolling()
    refresh()
    _timer = setInterval(refresh, intervalMs)
  }

  function stopPolling() {
    if (_timer !== null) {
      clearInterval(_timer)
      _timer = null
    }
  }

  return { snapshot, history, loading, error, refresh, loadHistory, startPolling, stopPolling }
})
