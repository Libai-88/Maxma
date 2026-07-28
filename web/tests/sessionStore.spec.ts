import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionStore } from '@/stores/session'

// Mock api module
vi.mock('@/api', () => ({
  api: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    constifySession: vi.fn(),
    unconstifySession: vi.fn(),
    generateSessionTitle: vi.fn(),
  },
}))

// Mock logger to avoid side effects
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { api } from '@/api'

const mockApi = vi.mocked(api)

function makeSession(overrides: Partial<{ session_id: string; message_count: number; created_at: number }> = {}) {
  return {
    session_id: 'sess-1',
    message_count: 5,
    created_at: Date.now(),
    ...overrides,
  }
}

describe('useSessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('refreshSessions (loadSessions)', () => {
    it('loads sessions from api', async () => {
      const sessions = [makeSession({ session_id: 'a' }), makeSession({ session_id: 'b' })]
      mockApi.listSessions.mockResolvedValue({ sessions } as any)

      const store = useSessionStore()
      await store.refreshSessions()

      expect(store.sessions).toEqual(sessions)
      expect(mockApi.listSessions).toHaveBeenCalledTimes(1)
    })

    it('throws on api failure so callers can retry', async () => {
      mockApi.listSessions.mockRejectedValue(new Error('Network error'))

      const store = useSessionStore()
      await expect(store.refreshSessions()).rejects.toThrow('Network error')
    })

    it('preserves existing sessions on failure', async () => {
      const sessions = [makeSession({ session_id: 'a' })]
      mockApi.listSessions.mockResolvedValueOnce({ sessions } as any)

      const store = useSessionStore()
      await store.refreshSessions()
      expect(store.sessions).toHaveLength(1)

      mockApi.listSessions.mockRejectedValueOnce(new Error('fail'))
      await expect(store.refreshSessions()).rejects.toThrow()
      // sessions should still hold the previous data
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].session_id).toBe('a')
    })
  })

  describe('createSession', () => {
    it('creates a session and sets sessionId', async () => {
      mockApi.createSession.mockResolvedValue({ session_id: 'new-1', created_at: Date.now() } as any)
      mockApi.listSessions.mockResolvedValue({ sessions: [makeSession({ session_id: 'new-1' })] } as any)

      const store = useSessionStore()
      await store.createSession()

      expect(store.sessionId).toBe('new-1')
      expect(localStorage.getItem('maxma_session_id')).toBe('new-1')
      expect(mockApi.createSession).toHaveBeenCalledTimes(1)
    })

    it('refreshes session list after creation', async () => {
      mockApi.createSession.mockResolvedValue({ session_id: 'new-2', created_at: Date.now() } as any)
      mockApi.listSessions.mockResolvedValue({ sessions: [] } as any)

      const store = useSessionStore()
      await store.createSession()

      expect(mockApi.listSessions).toHaveBeenCalled()
    })
  })

  describe('deleteSession', () => {
    it('deletes a non-current session and refreshes list', async () => {
      const sessions = [makeSession({ session_id: 'a' }), makeSession({ session_id: 'b' })]
      mockApi.listSessions.mockResolvedValue({ sessions } as any)
      mockApi.deleteSession.mockResolvedValue({ status: 'ok' } as any)

      const store = useSessionStore()
      await store.refreshSessions()
      store.sessionId = 'a'

      await store.deleteSession('b')

      expect(mockApi.deleteSession).toHaveBeenCalledWith('b')
      expect(mockApi.listSessions).toHaveBeenCalled()
    })

    it('switches to first remaining session when deleting current session', async () => {
      const sessions = [makeSession({ session_id: 'a' }), makeSession({ session_id: 'b' })]
      mockApi.listSessions.mockResolvedValue({ sessions } as any)
      mockApi.deleteSession.mockResolvedValue({ status: 'ok' } as any)

      const store = useSessionStore()
      await store.refreshSessions()
      store.sessionId = 'a'

      // After deleting 'a', refreshSessions returns only 'b'
      mockApi.listSessions.mockResolvedValue({ sessions: [makeSession({ session_id: 'b' })] } as any)
      await store.deleteSession('a')

      expect(store.sessionId).toBe('b')
      expect(localStorage.getItem('maxma_session_id')).toBe('b')
    })

    it('creates a new session when deleting the only session', async () => {
      mockApi.listSessions.mockResolvedValue({ sessions: [makeSession({ session_id: 'a' })] } as any)
      mockApi.deleteSession.mockResolvedValue({ status: 'ok' } as any)

      const store = useSessionStore()
      await store.refreshSessions()
      store.sessionId = 'a'

      // After delete, no sessions remain; createSession is called
      mockApi.listSessions.mockResolvedValue({ sessions: [] } as any)
      mockApi.createSession.mockResolvedValue({ session_id: 'fresh', created_at: Date.now() } as any)
      await store.deleteSession('a')

      expect(mockApi.createSession).toHaveBeenCalled()
      expect(store.sessionId).toBe('fresh')
    })

    it('does not throw when api.deleteSession fails', async () => {
      mockApi.deleteSession.mockRejectedValue(new Error('forbidden'))

      const store = useSessionStore()
      store.sessionId = 'x'

      // Should not throw
      await expect(store.deleteSession('x')).resolves.toBeUndefined()
    })
  })

  describe('switchSession', () => {
    it('updates sessionId and persists to localStorage', async () => {
      const store = useSessionStore()
      await store.switchSession('target-id')

      expect(store.sessionId).toBe('target-id')
      expect(localStorage.getItem('maxma_session_id')).toBe('target-id')
    })
  })

  describe('constifySession (rename/pin)', () => {
    it('constifies and refreshes sessions', async () => {
      mockApi.constifySession.mockResolvedValue({ session_id: 'a', is_const: true, const_name: 'My Chat' } as any)
      mockApi.listSessions.mockResolvedValue({ sessions: [makeSession({ session_id: 'a' })] } as any)

      const store = useSessionStore()
      await store.constifySession('a', 'My Chat')

      expect(mockApi.constifySession).toHaveBeenCalledWith('a', 'My Chat')
      expect(mockApi.listSessions).toHaveBeenCalled()
    })

    it('does not throw on failure', async () => {
      mockApi.constifySession.mockRejectedValue(new Error('fail'))

      const store = useSessionStore()
      await expect(store.constifySession('a', 'name')).resolves.toBeUndefined()
    })
  })

  describe('unconstifySession', () => {
    it('unconstifies and refreshes sessions', async () => {
      mockApi.unconstifySession.mockResolvedValue({ status: 'ok' } as any)
      mockApi.listSessions.mockResolvedValue({ sessions: [] } as any)

      const store = useSessionStore()
      await store.unconstifySession('a')

      expect(mockApi.unconstifySession).toHaveBeenCalledWith('a')
      expect(mockApi.listSessions).toHaveBeenCalled()
    })

    it('does not throw on failure', async () => {
      mockApi.unconstifySession.mockRejectedValue(new Error('fail'))

      const store = useSessionStore()
      await expect(store.unconstifySession('a')).resolves.toBeUndefined()
    })
  })

  describe('generateSessionTitle', () => {
    it('returns generated title', async () => {
      mockApi.generateSessionTitle.mockResolvedValue({ title: 'Discussion about Vue' } as any)

      const store = useSessionStore()
      const title = await store.generateSessionTitle('sess-1')

      expect(title).toBe('Discussion about Vue')
      expect(mockApi.generateSessionTitle).toHaveBeenCalledWith('sess-1')
    })

    it('returns empty string on failure', async () => {
      mockApi.generateSessionTitle.mockRejectedValue(new Error('timeout'))

      const store = useSessionStore()
      const title = await store.generateSessionTitle('sess-1')

      expect(title).toBe('')
    })
  })

  describe('initIfNeeded', () => {
    it('reports initialization failure after the final retry', async () => {
      mockApi.listSessions.mockRejectedValue(new Error('network down'))

      const store = useSessionStore()
      const result = await store.initIfNeeded(1, 10)

      expect(result).toBe(false)
    })

    it('initializes successfully when stored session exists', async () => {
      const sessions = [makeSession({ session_id: 'stored-id' })]
      mockApi.listSessions.mockResolvedValue({ sessions } as any)
      localStorage.setItem('maxma_session_id', 'stored-id')

      const store = useSessionStore()
      const result = await store.initIfNeeded(1, 10)

      expect(result).toBe(true)
      expect(store.sessionId).toBe('stored-id')
    })

    it('creates a new session when stored session no longer exists', async () => {
      mockApi.listSessions.mockResolvedValue({ sessions: [makeSession({ session_id: 'other' })] } as any)
      mockApi.createSession.mockResolvedValue({ session_id: 'brand-new', created_at: Date.now() } as any)
      localStorage.setItem('maxma_session_id', 'gone-id')

      const store = useSessionStore()
      const result = await store.initIfNeeded(1, 10)

      expect(result).toBe(true)
      expect(mockApi.createSession).toHaveBeenCalled()
      expect(store.sessionId).toBe('brand-new')
    })
  })
})
