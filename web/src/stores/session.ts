import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import { removeTurnsFromStorage, TURNS_KEY_PREFIX } from '@/stores/chat'
import type { SessionInfo } from '@/types'

const STORAGE_KEY = 'maxma_session_id'

export const useSessionStore = defineStore('session', () => {
  const sessionId = ref('')
  const sessions = ref<SessionInfo[]>([])
  let _initialized = false
  let _initPromise: Promise<void> | null = null

  async function initIfNeeded(retries = 5, delayMs = 1000) {
    if (_initialized) return
    if (_initPromise) { await _initPromise; return }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          try {
            await api.getSession(stored)
            sessionId.value = stored
          } catch {
            await _createSession()
          }
        } else {
          await _createSession()
        }
        await refreshSessions()
        cleanupOrphanedCaches()
        _initialized = true
        return
      } catch (e) {
        console.error(`[session] init failed (attempt ${attempt}/${retries}), retrying in ${delayMs}ms:`, e)
        _initialized = false
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, delayMs))
          delayMs *= 1.5  // 指数退避
        } else {
          console.error('[session] init failed after all retries')
        }
      }
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
    await refreshSessions().catch(() => {})
  }

  async function switchSession(id: string) {
    sessionId.value = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  async function deleteSession(id: string) {
    await api.deleteSession(id)
    removeTurnsFromStorage(id)
    if (sessionId.value === id) {
      await refreshSessions().catch(() => {})
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].session_id)
      } else {
        await createSession()
      }
    } else {
      await refreshSessions().catch(() => {})
    }
  }

  async function constifySession(id: string, name: string) {
    await api.constifySession(id, name)
    await refreshSessions().catch(() => {})
  }

  async function unconstifySession(id: string) {
    await api.unconstifySession(id)
    await refreshSessions().catch(() => {})
  }

  async function generateSessionTitle(id: string): Promise<string> {
    const res = await api.generateSessionTitle(id)
    return res.title
  }

  function cleanupOrphanedCaches() {
    const validIds = new Set(sessions.value.map(s => s.session_id))
    // 防御：sessions 为空时（可能是后端不可用或 refreshSessions 失败），
    // 不清空缓存，避免后端短暂不可用时丢失所有会话历史
    if (validIds.size === 0) {
      console.warn('[session] cleanupOrphanedCaches: sessions 列表为空，跳过清理（可能是后端不可用）')
      return
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TURNS_KEY_PREFIX)) {
        const sid = key.slice(TURNS_KEY_PREFIX.length)
        if (sid && !validIds.has(sid)) localStorage.removeItem(key)
      }
    }
  }

  return {
    sessionId, sessions,
    initIfNeeded, refreshSessions, createSession, switchSession,
    deleteSession, constifySession, unconstifySession, generateSessionTitle,
  }
})
