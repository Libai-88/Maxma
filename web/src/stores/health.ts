import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'
import type { HealthResponse } from '@/types'

export const useHealthStore = defineStore('health', () => {
  const health = ref<HealthResponse | null>(null)
  // Stable reason codes are safe to render; raw diagnostic text remains optional.
  const componentStatuses = computed(() => {
    if (!health.value) return []
    const base = [
      ['llm', health.value.llm],
      ['memory', health.value.memory],
      ['native_tools', health.value.native_tools],
      ['mcp_tools', health.value.mcp_tools],
    ] as const
    const providers = Object.entries(health.value.providers ?? {})
      .map(([name, component]) => [`provider:${name}`, component] as const)
    return [...base, ...providers]
  })
  let _timer: ReturnType<typeof setInterval> | null = null
  let _fetching = false

  async function refresh() {
    if (_fetching) return
    _fetching = true
    try { health.value = await api.health() }
    catch { health.value = null }
    finally { _fetching = false }
  }

  function startPolling(intervalMs = 30000) {
    stopPolling()
    refresh()
    // 快速探测：前 3 次 3s 间隔
    let fastPolls = 0
    _timer = setInterval(() => {
      if (_fetching) return
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

  return { health, componentStatuses, refresh, startPolling, stopPolling }
})
