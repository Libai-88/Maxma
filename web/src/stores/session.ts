import { create } from 'zustand'
import { api } from '@/api'
import { useChatStore } from '@/stores/chat'
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from '@/lib/storage'
import { createLogger } from '@/utils/logger'
import type { SessionInfo } from '@/types'

const log = createLogger('session')

const STORAGE_KEY = 'maxma_session_id'
// 与 chat store 的 turns 缓存键前缀保持一致（用于孤儿缓存清理）。
const TURNS_KEY_PREFIX = 'maxma_turns_'

/** @/lib/toast 在旧工程里的全局反馈通道：派发语义正确的 toast 事件。 */
function showError(message: string): void {
  window.dispatchEvent(new CustomEvent('maxma:toast', {
    detail: { message, level: 'error' },
  }))
}

/**
 * 会话删除时断开被删会话的 WS、移除其本地 turns 缓存，并通知内存缓存失效。
 * 通过 `useChatStore.getState()`（而非 hook 调用）在非组件环境访问 store；
 * 以防御式可选调用解耦 chat store 的具体方法名。
 */
function invalidateChatSession(sid: string): void {
  try {
    const chat = useChatStore.getState() as unknown as Record<string, unknown>
    const disconnect = chat.disconnectChannel
    const remove = chat.removeTurnsFromStorage
    if (typeof disconnect === 'function') (disconnect as (id: string) => void)(sid)
    if (typeof remove === 'function') (remove as (id: string) => void)(sid)
  } catch {
    /* chat store 未就绪时静默，不阻断会话删除 */
  }
  // PERF-CACHE-LEAK-001：释放内存 turnsCache（通过事件通知，避免循环依赖）
  window.dispatchEvent(new CustomEvent('maxma:turnscache-invalidate', { detail: { sid } }))
}

interface SessionState {
  sessionId: string
  sessions: SessionInfo[]
  initIfNeeded: (retries?: number, delayMs?: number) => Promise<boolean>
  refreshSessions: () => Promise<void>
  createSession: () => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  batchDelete: (ids: string[]) => Promise<void>
  clearTempSessions: () => Promise<void>
}

export const useSessionStore = create<SessionState>()((set, get) => {
  let _initialized = false
  let _initPromise: Promise<boolean> | null = null

  async function initIfNeeded(retries = 5, delayMs = 1000): Promise<boolean> {
    if (_initialized) return true
    if (_initPromise) return _initPromise

    const promise = (async () => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          // 先拉取会话列表判断本地存储的会话是否仍存在，
          // 避免用 getSession 探针——会话被 TTL 清理后探针会 404，
          // 在控制台留下红色报错噪音。refreshSessions 失败会抛错，由外层 catch 重试。
          await refreshSessions()
          const stored = safeGetItem(STORAGE_KEY)
          if (stored && get().sessions.some(s => s.session_id === stored)) {
            set({ sessionId: stored })
          } else {
            await _createSession()
            await refreshSessions()
          }
          cleanupOrphanedCaches()
          _initialized = true
          return true
        } catch (e) {
          log.error(`init failed (attempt ${attempt}/${retries}), retrying in ${delayMs}ms:`, e)
          _initialized = false
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs))
            delayMs *= 1.5 // 指数退避
          } else {
            log.error('init failed after all retries')
          }
        }
      }
      return false
    })()

    _initPromise = promise
    try {
      return await promise
    } finally {
      if (_initPromise === promise) _initPromise = null
    }
  }

  let _refreshInFlight: Promise<void> | null = null
  async function refreshSessions() {
    // SESSION-REFRESH-RACE-001：in-flight 去重——复用同一个在途 promise，
    // 同一时刻只允许一个列表请求。失败时保留现有数据（不置空）并抛错。
    if (_refreshInFlight) return _refreshInFlight
    _refreshInFlight = (async () => {
      try {
        const res = await api.listSessions()
        set({ sessions: res.sessions })
      } finally {
        _refreshInFlight = null
      }
    })()
    return _refreshInFlight
  }

  async function _createSession() {
    const res = await api.createSession()
    set({ sessionId: res.session_id })
    // COMPAT-STORAGE-001：存储不可用时静默降级
    safeSetItem(STORAGE_KEY, res.session_id)
  }

  // UX-CREATE-DEDUP-001：创建请求在途标记（防连点）
  let _createInFlight = false

  async function createSession() {
    // UX-CREATE-DEDUP-001：新建会话防连点（快速双击会创建一串空会话）
    if (_createInFlight) return
    _createInFlight = true
    try {
      await _createSession()
      await refreshSessions().catch((err) => log.warn('refreshSessions after create failed:', err))
    } finally {
      _createInFlight = false
    }
  }

  async function switchSession(id: string) {
    set({ sessionId: id })
    safeSetItem(STORAGE_KEY, id)
  }

  async function deleteSession(id: string) {
    try {
      await api.deleteSession(id)
    } catch (e) {
      log.warn('deleteSession failed:', e)
      // UX-FEEDBACK-001：删除失败必须可见
      showError('删除会话失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    // 修复 DELETE-SESSION-001：先断开被删会话的 WS（终止后台 agent 任务、
    // 防止事件继续到达把已删缓存重新写回），再删缓存。
    invalidateChatSession(id)
    if (get().sessionId === id) {
      await refreshSessions().catch((err) => log.warn('refreshSessions after delete failed:', err))
      // 兜底优先选主会话——subagent 会话是只读的，不应被自动切入
      const fallback = get().sessions.find((s) => !s.is_subagent) ?? get().sessions[0]
      if (fallback) {
        await switchSession(fallback.session_id)
      } else {
        await createSession()
      }
    } else {
      await refreshSessions().catch((err) => log.warn('refreshSessions after delete failed:', err))
    }
  }

  async function batchDelete(ids: string[]) {
    if (!ids.length) return
    try {
      await api.batchDeleteSessions(ids)
    } catch (e) {
      log.warn('batchDelete failed:', e)
      // UX-FEEDBACK-001：批量删除失败给出可见反馈
      showError('批量删除失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    ids.forEach((id) => {
      // 修复 DELETE-SESSION-001：批量删除同样先断开再删缓存
      invalidateChatSession(id)
    })
    // 若当前会话被删，切到剩余第一个主会话（subagent 只读，不自动切入）
    if (get().sessionId && ids.includes(get().sessionId)) {
      await refreshSessions().catch((err) => log.warn('refreshSessions after batchDelete failed:', err))
      const fallback = get().sessions.find((s) => !s.is_subagent) ?? get().sessions[0]
      if (fallback) {
        await switchSession(fallback.session_id)
      } else {
        await createSession()
      }
    } else {
      await refreshSessions().catch((err) => log.warn('refreshSessions after batchDelete failed:', err))
    }
  }

  async function clearTempSessions() {
    try {
      await api.clearTempSessions()
    } catch (e) {
      log.warn('clearTempSessions failed:', e)
      return
    }
    await refreshSessions().catch((err) => log.warn('refreshSessions after clearTemp failed:', err))
    if (get().sessionId && !get().sessions.some((s) => s.session_id === get().sessionId)) {
      const fallback = get().sessions.find((s) => !s.is_subagent) ?? get().sessions[0]
      if (fallback) {
        await switchSession(fallback.session_id)
      } else {
        await createSession()
      }
    }
  }

  function cleanupOrphanedCaches() {
    const validIds = new Set(get().sessions.map((s) => s.session_id))
    // 防御：sessions 为空时（可能是后端不可用或 refreshSessions 失败），
    // 不清空缓存，避免后端短暂不可用时丢失所有会话历史
    if (validIds.size === 0) {
      log.warn('cleanupOrphanedCaches: sessions 列表为空，跳过清理（可能是后端不可用）')
      return
    }
    // 先收集要删除的 key，再统一删除。直接在遍历中 removeItem 会导致
    // localStorage 索引位移，连续的孤儿缓存会被跳过（每隔一个漏删一个）。
    const keysToRemove: string[] = []
    for (const key of safeKeys()) {
      if (key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      safeRemoveItem(key)
    }
  }

  return {
    sessionId: '',
    sessions: [],
    initIfNeeded,
    refreshSessions,
    createSession,
    switchSession,
    deleteSession,
    batchDelete,
    clearTempSessions,
  }
})

// MULTI-WINDOW-001：跨窗口会话同步。storage 事件只由"其他窗口"的写入触发
// （本窗口写入不会收到自身事件），窗口 B 切换会话后，窗口 A 的 sessionId
// 随之切换。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    const current = useSessionStore.getState()
    if (event.newValue !== current.sessionId) {
      log.debug(`另一窗口切换会话: "${current.sessionId}" → "${event.newValue}"`)
      useSessionStore.setState({ sessionId: event.newValue })
    }
  })
}
