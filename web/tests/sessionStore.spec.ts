import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api', () => ({
  api: {
    createSession: vi.fn().mockResolvedValue({ session_id: 'test-sid-123' }),
    listSessions: vi.fn().mockRejectedValue(new Error('network down')),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    constifySession: vi.fn().mockResolvedValue(undefined),
    unconstifySession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(undefined),
    generateSessionTitle: vi.fn().mockResolvedValue({ title: 't' }),
  },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: vi.fn(() => ({ removeTurnsFromStorage: vi.fn() })),
  removeTurnsFromStorage: vi.fn(),
  TURNS_KEY_PREFIX: 'maxma_turns_',
}))

import { useSessionStore } from '@/stores/session'

describe('session store', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('logs a warning when refreshSessions fails after createSession', async () => {
    const store = useSessionStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await store.createSession()

    expect(warnSpy).toHaveBeenCalled()
    const [msg] = warnSpy.mock.calls[0]
    expect(String(msg)).toMatch(/refreshSessions/)
    warnSpy.mockRestore()
  })

  it('reports initialization failure after the final retry', async () => {
    const store = useSessionStore()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(store.initIfNeeded(1)).resolves.toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
