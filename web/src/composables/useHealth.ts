import { ref, onUnmounted } from 'vue'
import { api } from '@/api'
import type { HealthResponse } from '@/types'

export const health = ref<HealthResponse | null>(null)
let _timer: ReturnType<typeof setInterval> | null = null
let _consumers = 0

export async function refreshHealth() {
  try {
    health.value = await api.health()
  } catch {
    health.value = null
  }
}

export function startPolling(intervalMs = 30000) {
  stopPolling()
  // 快速探测阶段：前 3 次 3 秒间隔，让前端尽早感知后端就绪
  let fastPolls = 0
  const fastInterval = 3000
  refreshHealth()
  _timer = setInterval(() => {
    if (fastPolls < 3) {
      fastPolls++
      refreshHealth()
    } else {
      // 切换到常规间隔
      clearInterval(_timer!)
      _timer = setInterval(refreshHealth, intervalMs)
    }
  }, fastInterval)
}

export function stopPolling() {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}

export function useHealth() {
  _consumers++
  onUnmounted(() => {
    _consumers = Math.max(0, _consumers - 1)
    if (_consumers === 0) {
      stopPolling()
    }
  })
  return { health, refreshHealth, startPolling, stopPolling }
}
