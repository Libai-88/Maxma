import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import { useChatStore, TURNS_KEY_PREFIX } from '@/stores/chat'
import { safeGetItem, safeKeys, safeRemoveItem, safeSetItem } from '@/lib/storage'
import { createLogger } from '@/utils/logger'
import { showError } from '@/lib/toast'
import type { SessionInfo } from '@/types'

const log = createLogger('session')

const STORAGE_KEY = 'maxma_session_id'

// MULTI-WINDOW-001：跨窗口会话同步。storage 事件只由"其他窗口"的写入触发
// （本窗口写入不会收到自身事件），窗口 B 切换会话后，窗口 A 的 sessionId
// 随之切换——此前无任何监听，两窗口的 maxma_session_id 互相覆盖且各自
// 不知道，刷新后跳回另一窗口选的会话。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    const current = useSessionStore()
    if (event.newValue !== current.sessionId) {
      log.debug(`另一窗口切换会话: "${current.sessionId}" → "${event.newValue}"`)
      current.sessionId = event.newValue
    }
  })
}

export const useSessionStore = defineStore('session', () => {
  const sessionId = ref('')
  const sessions = ref<SessionInfo[]>([])
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
          // 在控制台留下红色报错噪音（属正常情况，不应显示为错误）。
          // refreshSessions 失败会抛错，由外层 catch 重试，语义不变。
          await refreshSessions()
          const stored = safeGetItem(STORAGE_KEY)
          if (stored && sessions.value.some(s => s.session_id === stored)) {
            sessionId.value = stored
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
            delayMs *= 1.5  // 指数退避
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
    // SESSION-REFRESH-RACE-001：in-flight 去重——调用方众多且互不协调
    // （健康恢复 watch / done 事件 / sub_session_created / 删除流程），
    // 并发请求时慢响应后到会覆盖新列表（刚删的会话复活、新建会话消失）。
    // 复用同一个在途 promise，同一时刻只允许一个列表请求。
    if (_refreshInFlight) return _refreshInFlight
    _refreshInFlight = (async () => {
      try {
        // 失败时保留现有数据（不置空），并抛错让调用方决定是否重试
        // 修复：此前失败时 sessions.value = [] 且不抛错，
        // 导致 initIfNeeded 误认为 init 成功不再重试，
        // 页面刷新时如果后端还在启动会话列表永久为空
        const res = await api.listSessions()
        sessions.value = res.sessions
      } finally {
        _refreshInFlight = null
      }
    })()
    return _refreshInFlight
  }

  async function _createSession() {
    const res = await api.createSession()
    sessionId.value = res.session_id
    // COMPAT-STORAGE-001：存储不可用时静默降级（会话仍可用，仅刷新后不恢复选择）
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
    sessionId.value = id
    safeSetItem(STORAGE_KEY, id)
  }

  async function deleteSession(id: string) {
    try {
      await api.deleteSession(id)
    } catch (e) {
      log.warn('deleteSession failed:', e)
      // UX-FEEDBACK-001：删除失败必须可见（此前静默 return，用户走完
      // 确认对话框后列表毫无变化、不知道发生了什么）
      showError('删除会话失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    // 修复 DELETE-SESSION-001：先断开被删会话的 WS（终止后台 agent 任务、
    // 防止事件继续到达把已删缓存重新写回），再删缓存。
    useChatStore().disconnectChannel(id)
    useChatStore().removeTurnsFromStorage(id)
    // PERF-CACHE-LEAK-001：释放内存 turnsCache（useChat 模块级缓存，
    // 直接 import 会循环依赖，通过事件通知）
    window.dispatchEvent(new CustomEvent('maxma:turnscache-invalidate', { detail: { sid: id } }))
    if (sessionId.value === id) {
      await refreshSessions().catch((err) => log.warn('refreshSessions after delete failed:', err))
      // 兜底优先选主会话——subagent 会话是只读的，不应被自动切入
      const fallback = sessions.value.find((s) => !s.is_subagent) ?? sessions.value[0]
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
      useChatStore().disconnectChannel(id)
      useChatStore().removeTurnsFromStorage(id)
      // PERF-CACHE-LEAK-001：释放内存 turnsCache
      window.dispatchEvent(new CustomEvent('maxma:turnscache-invalidate', { detail: { sid: id } }))
    })
    // 若当前会话被删，切到剩余第一个主会话（subagent 只读，不自动切入）
    if (sessionId.value && ids.includes(sessionId.value)) {
      await refreshSessions().catch((err) => log.warn('refreshSessions after batchDelete failed:', err))
      const fallback = sessions.value.find((s) => !s.is_subagent) ?? sessions.value[0]
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
    if (sessionId.value && !sessions.value.some((s) => s.session_id === sessionId.value)) {
      const fallback = sessions.value.find((s) => !s.is_subagent) ?? sessions.value[0]
      if (fallback) {
        await switchSession(fallback.session_id)
      } else {
        await createSession()
      }
    }
  }

  async function constifySession(id: string, name: string) {
    try {
      await api.constifySession(id, name)
    } catch (e) {
      log.warn('constifySession failed:', e)
      // UX-FEEDBACK-001：固定失败必须可见（后端 409「Agent 仍在运行中」等
      // 原因文案需透传；此前静默 return，用户点确定后卡片关闭毫无变化）
      showError('固定会话失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    await refreshSessions().catch((err) => log.warn('refreshSessions after constify failed:', err))
  }

  async function unconstifySession(id: string) {
    try {
      await api.unconstifySession(id)
    } catch (e) {
      log.warn('unconstifySession failed:', e)
      showError('取消固定失败: ' + (e instanceof Error ? e.message : String(e)))
      return
    }
    await refreshSessions().catch((err) => log.warn('refreshSessions after unconstify failed:', err))
  }

  async function generateSessionTitle(id: string): Promise<string> {
    // 失败时向上抛出——此前吞错返回 ''，调用方（SessionSidebar）会把
    // 用户已输入的会话名覆盖为空且自己的 catch/toast 永不触发
    const res = await api.generateSessionTitle(id)
    return res.title
  }

  function cleanupOrphanedCaches() {
    const validIds = new Set(sessions.value.map(s => s.session_id))
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
    sessionId, sessions,
    initIfNeeded, refreshSessions, createSession, switchSession,
    deleteSession, batchDelete, clearTempSessions,
    constifySession, unconstifySession, generateSessionTitle,
  }
})
