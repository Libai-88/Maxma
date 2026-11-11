import { create } from 'zustand'
import { api } from '@/api'
import type { HealthResponse, ComponentHealth } from '@/types'

export type ComponentStatusEntry = readonly [string, ComponentHealth]

interface HealthState {
  health: HealthResponse | null
  componentStatuses: ComponentStatusEntry[]
  refresh: () => Promise<void>
  startPolling: (intervalMs?: number) => void
  stopPolling: () => void
}

function deriveComponentStatuses(health: HealthResponse | null): ComponentStatusEntry[] {
  if (!health) return []
  const base = [
    ['llm', health.llm],
    ['memory', health.memory],
    ['native_tools', health.native_tools],
    ['mcp_tools', health.mcp_tools],
  ] as const
  const providers = Object.entries(health.providers ?? {})
    .map(([name, component]) => [`provider:${name}`, component] as const)
  return [...base, ...providers]
}

export const useHealthStore = create<HealthState>()((set) => {
  let _timer: ReturnType<typeof setInterval> | null = null
  let _fetching = false

  async function refresh() {
    if (_fetching) return
    _fetching = true
    try {
      const health = await api.health()
      set({ health, componentStatuses: deriveComponentStatuses(health) })
    } catch {
      set({ health: null, componentStatuses: [] })
    } finally {
      _fetching = false
    }
  }

  function startPolling(intervalMs = 30000) {
    stopPolling()
    void refresh()
    // 快速探测：前 3 次 3s 间隔
    let fastPolls = 0
    _timer = setInterval(() => {
      if (_fetching) return
      if (fastPolls < 3) {
        fastPolls++
        void refresh()
      } else {
        clearInterval(_timer!)
        _timer = setInterval(() => void refresh(), intervalMs)
      }
    }, 3000)
  }

  function stopPolling() {
    clearInterval(_timer!)
    _timer = null
  }

  return {
    health: null,
    componentStatuses: [],
    refresh,
    startPolling,
    stopPolling,
  }
})
