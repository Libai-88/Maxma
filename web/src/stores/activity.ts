// web/src/stores/activity.ts
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, getToken, ensureTokenLoaded } from '@/api'
import { getBackendOrigin, tauriFetch } from '@/utils/env'
import { createLogger } from '@/utils/logger'
import type { ActivityRecord, ActivityStatsResponse } from '@/types'

const log = createLogger('activity')

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
  // 修复 RACE-001：连接代数。每次 _connect 递增；旧连接被清理 abort 后，
  // 其 catch 若发现代数已落后（startStream 已发起新连接），直接静默放弃，
  // 不再依据全局 _intentionalClose 标志判断（该标志会被 startStream 重置，
  // 导致旧连接的 AbortError 被误判为「非主动关闭」→ 调度多余重连 → 双连接）。
  let _connectGeneration = 0
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
      const snapshot = data.records || []
      // ACTIVITY-MERGE-001：快照全量替换会覆盖 SSE push 的新记录——
      // 若 SSE 事件在 fetch 间隙到达，随后到达的旧快照会把它们抹掉。
      // 合并策略：保留本地时间戳晚于快照最新时间的记录（SSE 实时推送
      // 尚未进入后端快照），与快照按时间升序合并去重。
      const snapshotLatest = snapshot.length > 0
        ? Math.max(...snapshot.map(r => r.timestamp ?? 0))
        : 0
      const localNewer = records.value.filter(r => (r.timestamp ?? 0) > snapshotLatest)
      const seen = new Set<string>()
      const merged = [...localNewer, ...snapshot].filter((r) => {
        const key = `${r.timestamp}-${r.category}-${r.event_type}-${r.session_id}-${r.tool_name}-${r.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      records.value = merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).slice(-500)
    } catch (e) {
      log.error('Failed to fetch activity:', e)
    }
  }

  async function fetchStats() {
    try {
      stats.value = await api.getActivityStats()
    } catch (e) {
      log.error('Failed to fetch activity stats:', e)
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
    const gen = ++_connectGeneration
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

      _resetSSEBuffer()
      const reader = body.getReader()

      // 硬超时兜底：tauriFetch 的 ReadableStream 可能在 getReader 后永久挂起
      // （WebView2 / @tauri-apps/plugin-http 偶现 bug），导致 UI 永远停在「连接中」。
      // 若 20s 内未收到任何 SSE 事件行，主动断开降级到轮询。
      let _streamActive = false
      const streamTimeoutId = setTimeout(() => {
        if (!_streamActive) {
          log.warn('[activity] stream idle timeout (20s) — falling back to polling')
          reader.cancel().catch(() => {})
          _onDisconnect()
        }
      }, 20000)

      connected.value = true
      connecting.value = false
      reconnectDelay = 1000  // 连接成功，重置退避间隔
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      // 修复 RACE-001：成功路径必须清理挂起的重连定时器。此前仅清 pollTimer，
      // 若旧连接 abort 的 catch 已在 startStream 之后调度了 reconnectTimer，
      // 新连接成功后该定时器仍会触发 → 第二路 SSE 与第一路并存。
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }

      const origOnLine = (line: string) => _processSSELine(line)
      const wrappedOnLine = (line: string) => {
        if (!_streamActive) _streamActive = true  // 收到首行数据，取消 idle 超时
        origOnLine(line)
      }

      createSSELineReader(
        reader,
        (line) => wrappedOnLine(line),
        () => { clearTimeout(streamTimeoutId); /* stream ended */ _onDisconnect(); },
        (err) => {
          clearTimeout(streamTimeoutId)
          if (err instanceof DOMException && err.name === 'AbortError') return
          _onDisconnect()
        },
      )
    } catch (err) {
      // 超时 abort = 连接失败，走降级轮询；主动 stopStream/startStream 清理的
      // abort 静默忽略。判断依据：代数落后（已有新连接接管）或主动关闭标志。
      // 修复 RACE-001：不能用全局 _intentionalClose 单独判断——startStream
      // 会先把它重置为 false 再发起新连接，旧连接 abort 的 catch 在此刻读到
      // false，会把「主动清理」误判为「连接失败」而调度多余重连。
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (_intentionalClose || gen !== _connectGeneration) return
        // 超时触发：走降级
        _onDisconnect()
        return
      }
      if (_intentionalClose || gen !== _connectGeneration) return
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
      log.error('Failed to clear activity:', e)
    }
  }

  return { records, stats, connected, connecting, lastEventAt, connectionState, fetchRecent, fetchStats, startStream, stopStream, clear }
})
