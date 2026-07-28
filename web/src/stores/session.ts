import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import { useChatStore, TURNS_KEY_PREFIX } from '@/stores/chat'
import { createLogger } from '@/utils/logger'
import type { SessionInfo } from '@/types'

const log = createLogger('session')

const STORAGE_KEY = 'maxma_session_id'

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
          const stored = localStorage.getItem(STORAGE_KEY)
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

  async function refreshSessions() {
    // 失败时保留现有数据（不置空），并抛错让调用方决定是否重试
    // 修复：此前失败时 sessions.value = [] 且不抛错，
    // 导致 initIfNeeded 误认为 init 成功不再重试，
    // 页面刷新时如果后端还在启动会话列表永久为空
    const res = await api.listSessions()
    sessions.value = res.sessions
  }

  async function _createSession() {
    const res = await api.createSession()
    sessionId.value = res.session_id
    localStorage.setItem(STORAGE_KEY, res.session_id)
  }

  async function createSession() {
    await _createSession()
    await refreshSessions().catch((err) => log.warn('refreshSessions after create failed:', err))
  }

  async function switchSession(id: string) {
    sessionId.value = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  async function deleteSession(id: string) {
    try {
      await api.deleteSession(id)
    } catch (e) {
      log.warn('deleteSession failed:', e)
      return
    }
    useChatStore().removeTurnsFromStorage(id)
    if (sessionId.value === id) {
      await refreshSessions().catch((err) => log.warn('refreshSessions after delete failed:', err))
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].session_id)
      } else {
        await createSession()
      }
    } else {
      await refreshSessions().catch((err) => log.warn('refreshSessions after delete failed:', err))
    }
  }

  async function constifySession(id: string, name: string) {
    try {
      await api.constifySession(id, name)
    } catch (e) {
      log.warn('constifySession failed:', e)
      return
    }
    await refreshSessions().catch((err) => log.warn('refreshSessions after constify failed:', err))
  }

  async function unconstifySession(id: string) {
    try {
      await api.unconstifySession(id)
    } catch (e) {
      log.warn('unconstifySession failed:', e)
      return
    }
    await refreshSessions().catch((err) => log.warn('refreshSessions after unconstify failed:', err))
  }

  async function generateSessionTitle(id: string): Promise<string> {
    try {
      const res = await api.generateSessionTitle(id)
      return res.title
    } catch (e) {
      log.warn('generateSessionTitle failed:', e)
      return ''
    }
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
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  }

  return {
    sessionId, sessions,
    initIfNeeded, refreshSessions, createSession, switchSession,
    deleteSession, constifySession, unconstifySession, generateSessionTitle,
  }
})
