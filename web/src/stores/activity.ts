// web/src/stores/activity.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, getToken } from '@/api'
import { getBackendOrigin } from '@/utils/env'
import type { ActivityRecord, ActivityStatsResponse } from '@/types'

export const useActivityStore = defineStore('activity', () => {
  const records = ref<ActivityRecord[]>([])
  const stats = ref<ActivityStatsResponse | Record<string, unknown>>({})
  const connected = ref(false)
  let eventSource: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchRecent(limit = 100) {
    try {
      const data = await api.getActivityRecent(limit)
      records.value = data.records || []
    } catch (e) {
      console.error('Failed to fetch activity:', e)
    }
  }

  async function fetchStats() {
    try {
      stats.value = await api.getActivityStats()
    } catch (e) {
      console.error('Failed to fetch activity stats:', e)
    }
  }

  function startStream() {
    if (eventSource) eventSource.close()
    try {
      // 构造 SSE URL：EventSource 不支持自定义头，token 通过 query 传递
      const base = getBackendOrigin()
      const token = getToken()
      const url = `${base}/api/activity/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
      eventSource = new EventSource(url)
      eventSource.addEventListener('activity', (ev: MessageEvent) => {
        try {
          const record = JSON.parse(ev.data) as ActivityRecord
          records.value.push(record)
          // 限制前端保留 500 条
          if (records.value.length > 500) {
            records.value = records.value.slice(-500)
          }
        } catch { /* noop */ }
      })
      eventSource.onopen = () => {
        connected.value = true
        // SSE 重连成功后清理降级轮询，避免重复请求
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }
      eventSource.onerror = () => {
        connected.value = false
        // SSE 断开后降级为轮询
        if (!pollTimer) {
          pollTimer = setInterval(() => fetchRecent(100), 5000)
        }
      }
    } catch {
      // EventSource 不支持时降级为轮询
      if (!pollTimer) {
        pollTimer = setInterval(() => fetchRecent(100), 5000)
      }
    }
  }

  function stopStream() {
    if (eventSource) { eventSource.close(); eventSource = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    connected.value = false
  }

  async function clear() {
    try {
      await api.clearActivity()
      records.value = []
    } catch (e) {
      console.error('Failed to clear activity:', e)
    }
  }

  return { records, stats, connected, fetchRecent, fetchStats, startStream, stopStream, clear }
})
