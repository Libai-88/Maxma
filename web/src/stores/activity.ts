// web/src/stores/activity.ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, getToken, ensureTokenLoaded } from '@/api'
import { getBackendOrigin, tauriFetch } from '@/utils/env'
import type { ActivityRecord, ActivityStatsResponse } from '@/types'

/**
 * 简易 SSE 行读取器。将 ReadableStream<Uint8Array> 按 \n 分割成行，
 * 通过 onLine 回调逐行返回，完全遵循 SSE 协议（text/event-stream）的行格式。
 * 使用 TextDecoder 处理流式 UTF-8 分片，保证中文等多字节字符不被截断。
 */
function createSSELineReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onLine: (line: string) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
) {
  const decoder = new TextDecoder()
  let buffer = ''

  function pump(): Promise<void> {
    return reader.read().then(({ done, value }) => {
      if (done) { onDone(); return }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // 最后一个元素可能是不完整的行，保留到下次
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
      return pump()
    }).catch(onError)
  }

  pump()
}

export const useActivityStore = defineStore('activity', () => {
  const records = ref<ActivityRecord[]>([])
  const stats = ref<ActivityStatsResponse | Record<string, unknown>>({})
  const connected = ref(false)
  // 三态视觉反馈：连接中 / 已连接 / 已降级（轮询）。初始为 connecting 让首屏 UI 不显示「离线」误导 Novice。
  const connecting = ref(true)
  // 最近一次收到 SSE 事件的时间戳（ms）。组件据此显示「新事件」脉冲，区分静默与活跃流。
  const lastEventAt = ref<number | null>(null)

  let abortController: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let _intentionalClose = false
  // 重连退避间隔（ms）。必须是 store 级变量：若作为 _onDisconnect 局部变量，
  // 每次断开都会被重置为 1000，指数退避失效、重连永远间隔 1s。连接成功时重置。
  let reconnectDelay = 1000

  /** 连接三态：'connecting' | 'online' | 'offline'。供 UI 显示不同视觉反馈。 */
  const connectionState = computed<'connecting' | 'online' | 'offline'>(() => {
    if (connected.value) return 'online'
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

  /** SSE 事件缓冲区：当前正在累积的 event 行和 data 行 */
  let _currentEventType = ''
  let _currentData = ''

  function _resetSSEBuffer() {
    _currentEventType = ''
    _currentData = ''
  }

  /** 处理一行 SSE 协议文本 */
  function _processSSELine(line: string) {
    if (line.startsWith('event: ')) {
      _currentEventType = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      _currentData += line.slice(6)
    } else if (line === '' && _currentData) {
      // 空行 = 事件分隔符 → 派发
      if (_currentEventType === 'activity') {
        try {
          const record = JSON.parse(_currentData) as ActivityRecord
          records.value.push(record)
          lastEventAt.value = Date.now()
          if (records.value.length > 500) {
            records.value = records.value.slice(-500)
          }
        } catch { /* noop */ }
      }
      _resetSSEBuffer()
    }
    // 以 ':' 开头的行是注释，SSE 规范要求忽略
  }

  async function _connect() {
    if (_intentionalClose) return
    connecting.value = true
    connected.value = false

    try {
      const base = getBackendOrigin()
      abortController = new AbortController()

      // 15s 超时：覆盖 ensureTokenLoaded + fetch 全过程
      // ensureTokenLoaded 首次可能需 6s+（3 次重试），fetch 需 ~1s，合计 ~8-10s
      const timeoutId = setTimeout(() => abortController?.abort(), 15000)

      // 确保 Token 已加载
      await ensureTokenLoaded()

      // 再次读取 token（ensureTokenLoaded 可能更新了它）
      const tokenToUse = getToken()

      // 必须用 tauriFetch 而非原生 fetch：Tauri 桌面端页面 origin 为 tauri://localhost，
      // WebView2 禁止其向 http:// 发起原生 fetch，会导致 SSE 连接永远失败、
      // 状态在「连接中/离线」间反复横跳。tauriFetch 在浏览器模式下自动回退为原生 fetch。
      const response = await tauriFetch(`${base}/api/activity/stream`, {
        headers: tokenToUse ? { 'X-Maxma-Token': tokenToUse } : undefined,
        signal: abortController.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`)
      }

      const body = response.body
      if (!body) {
        throw new Error('SSE response body is null — browser may not support ReadableStream')
      }

      connected.value = true
      connecting.value = false
      reconnectDelay = 1000  // 连接成功，重置退避间隔
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }

      _resetSSEBuffer()
      const reader = body.getReader()

      createSSELineReader(
        reader,
        (line) => _processSSELine(line),
        () => { /* stream ended */ _onDisconnect(); },
        (err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          _onDisconnect()
        },
      )
    } catch (err) {
      // 超时 abort = 连接失败，走降级轮询；主动 stopStream 的 abort 静默忽略
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (_intentionalClose) return
        // 超时触发：走降级
        _onDisconnect()
        return
      }
      if (_intentionalClose) return
      _onDisconnect()
    }
  }

  function _onDisconnect() {
    if (_intentionalClose) return
    connected.value = false
    connecting.value = false

    // 进入降级轮询
    if (!pollTimer) {
      pollTimer = setInterval(() => fetchRecent(100), 5000)
    }

    // 尝试重连（指数退避：1s → 2s → 4s → 8s，最长 30s）。
    // reconnectDelay 为 store 级变量，跨多次断开持续递增，连接成功后重置。
    function tryReconnect() {
      if (_intentionalClose) return
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        if (_intentionalClose) return
        // 如果轮询还在运行，先清理
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        _connect()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    }
    tryReconnect()
  }

  function startStream() {
    // 清理旧连接
    _intentionalClose = false
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    _connect()
  }

  function stopStream() {
    _intentionalClose = true
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    connected.value = false
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
