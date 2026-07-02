import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { HealthResponse } from '@/types'

export const useHealthStore = defineStore('health', () => {
  const health = ref<HealthResponse | null>(null)
  let _timer: ReturnType<typeof setInterval> | null = null

  async function refresh() {
    try { health.value = await api.health() }
    catch { health.value = null }
  }

  function startPolling(intervalMs = 30000) {
    stopPolling()
    refresh()
    // 快速探测：前 3 次 3s 间隔
    let fastPolls = 0
    _timer = setInterval(() => {
      if (fastPolls < 3) { fastPolls++; refresh() }
      else {
        clearInterval(_timer!)
        _timer = setInterval(refresh, intervalMs)
      }
    }, 3000)
  }

  function stopPolling() {
    if (_timer !== null) { clearInterval(_timer); _timer = null }
  }

  return { health, refresh, startPolling, stopPolling }
})
