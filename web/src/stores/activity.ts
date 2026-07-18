// web/src/stores/activity.ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, getToken } from '@/api'
import { getBackendOrigin } from '@/utils/env'
import type { ActivityRecord, ActivityStatsResponse } from '@/types'

export const useActivityStore = defineStore('activity', () => {
  const records = ref<ActivityRecord[]>([])
  const stats = ref<ActivityStatsResponse | Record<string, unknown>>({})
  const connected = ref(false)
  // 三态视觉反馈：连接中 / 已连接 / 已降级（轮询）。初始为 connecting 让首屏 UI 不显示「离线」误导 Novice。
  const connecting = ref(true)
  // 最近一次收到 SSE 事件的时间戳（ms）。组件据此显示「新事件」脉冲，区分静默与活跃流。
  const lastEventAt = ref<number | null>(null)
  let eventSource: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  // 标记是否为主动关闭（stopStream 触发），用于区分「主动 close」与「真实连接错误」，
  // 避免组件卸载时 close() 触发 onerror 后启动无意义的降级轮询（产生 net::ERR_ABORTED 噪声）
  let _intentionalClose = false

  /** 连接三态：'connecting' | 'online' | 'offline'。供 UI 显示不同视觉反馈。 */
  const connectionState = computed<'connecting' | 'online' | 'offline'>(() => {
    if (connected.value) return 'online'
    // 未连上且仍在 connecting 阶段（startStream 后 onopen/onerror 任一触发前）→ 显示连接中
    if (connecting.value) return 'connecting'
    return 'offline'
  })

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
    _intentionalClose = false
    // 进入 connecting 三态：onopen 成功 → online；onerror 失败 → offline（轮询降级）
    connecting.value = true
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
          // 标记最近事件时间，供 UI 显示「新事件到达」脉冲
          lastEventAt.value = Date.now()
          // 限制前端保留 500 条
          if (records.value.length > 500) {
            records.value = records.value.slice(-500)
          }
        } catch { /* noop */ }
      })
      eventSource.onopen = () => {
        connected.value = true
        // onopen 触发后离开 connecting 阶段
        connecting.value = false
        // SSE 重连成功后清理降级轮询，避免重复请求
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      }
      eventSource.onerror = (event) => {
        // 主动关闭（stopStream）或连接已 CLOSED 时静默返回，不启动降级轮询
        // — 浏览器在 CONNECTING 状态下 close() 会触发 net::ERR_ABORTED，此处静默处理
        const readyState = (event.target as EventSource | null)?.readyState
        if (_intentionalClose || readyState === EventSource.CLOSED) {
          return
        }
        connected.value = false
        // onerror 触发后离开 connecting 阶段（进入 offline 轮询降级）
        connecting.value = false
        // SSE 断开后降级为轮询
        if (!pollTimer) {
          pollTimer = setInterval(() => fetchRecent(100), 5000)
        }
      }
    } catch {
      // EventSource 不支持时降级为轮询
      connecting.value = false
      if (!pollTimer) {
        pollTimer = setInterval(() => fetchRecent(100), 5000)
      }
    }
  }

  function stopStream() {
    // 标记主动关闭，阻止 onerror 启动降级轮询
    _intentionalClose = true
    if (eventSource) {
      // 移除事件处理器，避免 close() 触发 onerror/onsession 回调
      eventSource.onerror = null
      eventSource.onopen = null
      eventSource.close()
      eventSource = null
    }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    connected.value = false
    // 主动断开后离开 connecting 阶段
    connecting.value = false
  }

  async function clear() {
    try {
      await api.clearActivity()
      records.value = []
      lastEventAt.value = null
    } catch (e) {
      console.error('Failed to clear activity:', e)
    }
  }

  return { records, stats, connected, connecting, lastEventAt, connectionState, fetchRecent, fetchStats, startStream, stopStream, clear }
})
