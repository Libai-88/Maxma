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

  async function initIfNeeded() {
    if (_initialized) return
    if (_initPromise) { await _initPromise; return }

    _initPromise = (async () => {
      const stored = localStorage.getItem(STORAGE_KEY)
      try {
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
      } catch (e) {
        console.error('[session] init failed, will retry:', e)
        _initialized = false
      } finally {
        _initPromise = null
      }
    })()
    await _initPromise
  }

  async function refreshSessions() {
    try {
      const res = await api.listSessions()
      sessions.value = res.sessions
    } catch {
      sessions.value = []
    }
  }

  async function _createSession() {
    const res = await api.createSession()
    sessionId.value = res.session_id
    localStorage.setItem(STORAGE_KEY, res.session_id)
  }

  async function createSession() {
    await _createSession()
    await refreshSessions()
  }

  async function switchSession(id: string) {
    sessionId.value = id
    localStorage.setItem(STORAGE_KEY, id)
  }

  async function deleteSession(id: string) {
    await api.deleteSession(id)
    removeTurnsFromStorage(id)
    if (sessionId.value === id) {
      await refreshSessions()
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].session_id)
      } else {
        await createSession()
      }
    } else {
      await refreshSessions()
    }
  }

  async function constifySession(id: string, name: string) {
    await api.constifySession(id, name)
    await refreshSessions()
  }

  async function unconstifySession(id: string) {
    await api.unconstifySession(id)
    await refreshSessions()
  }

  async function generateSessionTitle(id: string): Promise<string> {
    const res = await api.generateSessionTitle(id)
    return res.title
  }

  function cleanupOrphanedCaches() {
    const validIds = new Set(sessions.value.map(s => s.session_id))
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
