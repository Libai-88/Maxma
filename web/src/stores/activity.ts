import { create } from 'zustand'
import { api, getToken, ensureTokenLoaded } from '@/api'
import { getBackendOrigin } from '@/utils/env'
import { createLogger } from '@/utils/logger'
import type { ActivityRecord, ActivityStatsResponse } from '@/types'

const log = createLogger('activity')

type ActivityStats = ActivityStatsResponse | Record<string, unknown>
type ConnectionState = 'connecting' | 'online' | 'offline'

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

interface ActivityState {
  records: ActivityRecord[]
  stats: ActivityStats
  connected: boolean
  connecting: boolean
  lastEventAt: number | null
  connectionState: ConnectionState
  fetchRecent: (limit?: number) => Promise<void>
  fetchStats: () => Promise<void>
  startStream: () => void
  stopStream: () => void
  clear: () => Promise<void>
}

export const useActivityStore = create<ActivityState>()((set, get) => {
  let abortController: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let _intentionalClose = false
  // 修复 RACE-001：连接代数。每次 _connect 递增；旧连接被清理 abort 后，
  // 其 catch 若发现代数已落后（startStream 已发起新连接），直接静默放弃。
  let _connectGeneration = 0
  // 重连退避间隔（ms）。必须是 store 级变量：连接成功时重置。
  let reconnectDelay = 1000

  function setConn(connected: boolean, connecting: boolean) {
    const connectionState: ConnectionState = connected ? 'online' : connecting ? 'connecting' : 'offline'
    set({ connected, connecting, connectionState })
  }

  async function fetchRecent(limit = 100) {
    try {
      const data = await api.getActivityRecent(limit)
      const snapshot = data.records || []
      // ACTIVITY-MERGE-001：快照全量替换会覆盖 SSE push 的新记录——
      // 合并策略：保留本地时间戳晚于快照最新时间的记录，与快照按时间升序合并去重。
      const snapshotLatest = snapshot.length > 0
        ? Math.max(...snapshot.map(r => r.timestamp ?? 0))
        : 0
      const localNewer = get().records.filter(r => (r.timestamp ?? 0) > snapshotLatest)
      const seen = new Set<string>()
      const merged = [...localNewer, ...snapshot].filter((r) => {
        const key = `${r.timestamp}-${r.category}-${r.event_type}-${r.session_id}-${r.tool_name}-${r.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      set({ records: merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).slice(-500) })
    } catch (e) {
      log.error('Failed to fetch activity:', e)
    }
  }

  async function fetchStats() {
    try {
      set({ stats: await api.getActivityStats() })
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
          set((s) => {
            const records = [...s.records, record]
            return {
              records: records.length > 500 ? records.slice(-500) : records,
              lastEventAt: Date.now(),
            }
          })
        } catch { /* noop */ }
      }
      _resetSSEBuffer()
    }
    // 以 ':' 开头的行是注释，SSE 规范要求忽略
  }

  async function _connect() {
    if (_intentionalClose) return
    const gen = ++_connectGeneration
    setConn(false, true)

    try {
      const base = getBackendOrigin()
      abortController = new AbortController()

      // 15s 超时：覆盖 ensureTokenLoaded + fetch 全过程
      const timeoutId = setTimeout(() => abortController?.abort(), 15000)

      // 确保 Token 已加载
      await ensureTokenLoaded()

      // 再次读取 token（ensureTokenLoaded 可能更新了它）
      const tokenToUse = getToken()

      // 同源页面（后端托管 web/dist / Electron 加载后端 origin），原生 fetch 即可；
      // getBackendOrigin() 恒为空串，拼接结果是页面 origin 下的相对路径。
      const response = await fetch(`${base}/api/activity/stream`, {
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

      // 硬超时兜底：20s 内未收到任何 SSE 事件行，主动断开降级到轮询。
      let _streamActive = false
      const streamTimeoutId = setTimeout(() => {
        if (!_streamActive) {
          log.warn('[activity] stream idle timeout (20s) — falling back to polling')
          reader.cancel().catch(() => {})
          _onDisconnect()
        }
      }, 20000)

      setConn(true, false)
      reconnectDelay = 1000 // 连接成功，重置退避间隔
      // 修复 RACE-001：成功路径必须清理挂起的重连定时器。
      clearInterval(pollTimer!)
      pollTimer = null
      clearTimeout(reconnectTimer!)
      reconnectTimer = null

      const wrappedOnLine = (line: string) => {
        if (!_streamActive) _streamActive = true // 收到首行数据，取消 idle 超时
        _processSSELine(line)
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (_intentionalClose || gen !== _connectGeneration) return
        _onDisconnect()
        return
      }
      if (_intentionalClose || gen !== _connectGeneration) return
      _onDisconnect()
    }
  }

  function _onDisconnect() {
    if (_intentionalClose) return
    setConn(false, false)

    // 进入降级轮询
    if (!pollTimer) {
      pollTimer = setInterval(() => void fetchRecent(100), 5000)
    }

    // 尝试重连（指数退避：1s → 2s → 4s → 8s，最长 30s）。
    function tryReconnect() {
      if (_intentionalClose) return
      clearTimeout(reconnectTimer!)
      reconnectTimer = setTimeout(() => {
        if (_intentionalClose) return
        // 如果轮询还在运行，先清理
        clearInterval(pollTimer!)
        pollTimer = null
        void _connect()
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
    clearTimeout(reconnectTimer!)
    reconnectTimer = null
    clearInterval(pollTimer!)
    pollTimer = null
    void _connect()
  }

  function stopStream() {
    _intentionalClose = true
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    clearTimeout(reconnectTimer!)
    reconnectTimer = null
    clearInterval(pollTimer!)
    pollTimer = null
    setConn(false, false)
  }

  async function clear() {
    try {
      await api.clearActivity()
      set({ records: [], lastEventAt: null })
    } catch (e) {
      log.error('Failed to clear activity:', e)
    }
  }

  return {
    records: [],
    stats: {},
    connected: false,
    // 三态视觉反馈：初始 connecting 让首屏 UI 不显示「离线」误导 Novice。
    connecting: true,
    lastEventAt: null,
    connectionState: 'connecting',
    fetchRecent,
    fetchStats,
    startStream,
    stopStream,
    clear,
  }
})
