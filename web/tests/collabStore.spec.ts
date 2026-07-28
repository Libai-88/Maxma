import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCollabStore } from '@/stores/collab'

vi.mock('@/api', () => ({
  api: {
    listSessionShares: vi.fn(),
    createSessionShare: vi.fn(),
    revokeSessionShare: vi.fn(),
    listSessionSnapshots: vi.fn(),
    createSessionSnapshot: vi.fn(),
    deleteSessionSnapshot: vi.fn(),
  },
}))

import { api } from '@/api'

const mockApi = vi.mocked(api)

describe('useCollabStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('loadShares', () => {
    it('loads shares for a session', async () => {
      const shares = [
        { share_id: 's1', session_id: 'sess1', access_mode: 'read', access_count: 0, password_protected: false, created_by: 'user', created_at: '2026-01-01' },
      ]
      mockApi.listSessionShares.mockResolvedValue(shares as any)

      const store = useCollabStore()
      await store.loadShares('sess1')

      expect(store.shares).toEqual(shares)
      expect(store.loading).toBe(false)
    })
  })

  describe('createShare', () => {
    it('creates and appends share', async () => {
      const newShare = { share_id: 's2', session_id: 'sess1', access_mode: 'edit', access_count: 0, password_protected: false, created_by: 'user', created_at: '2026-01-01' }
      mockApi.createSessionShare.mockResolvedValue(newShare as any)

      const store = useCollabStore()
      const result = await store.createShare({ session_id: 'sess1', access_mode: 'edit' })

      expect(result.share_id).toBe('s2')
      expect(store.shares).toContainEqual(newShare)
    })
  })

  describe('revokeShare', () => {
    it('removes share from list', async () => {
      mockApi.listSessionShares.mockResolvedValue([
        { share_id: 's1', session_id: 'sess1', access_mode: 'read', access_count: 0, password_protected: false, created_by: 'u', created_at: '' },
        { share_id: 's2', session_id: 'sess1', access_mode: 'edit', access_count: 0, password_protected: false, created_by: 'u', created_at: '' },
      ] as any)
      mockApi.revokeSessionShare.mockResolvedValue({ ok: true })

      const store = useCollabStore()
      await store.loadShares('sess1')
      await store.revokeShare('s1')

      expect(store.shares).toHaveLength(1)
      expect(store.shares[0].share_id).toBe('s2')
    })
  })

  describe('activeShares / expiredShares', () => {
    it('separates active and expired shares', async () => {
      const past = new Date(Date.now() - 86400000).toISOString()
      const future = new Date(Date.now() + 86400000).toISOString()
      mockApi.listSessionShares.mockResolvedValue([
        { share_id: 's1', session_id: 'x', expires_at: future, access_mode: 'read', access_count: 0, password_protected: false, created_by: 'u', created_at: '' },
        { share_id: 's2', session_id: 'x', expires_at: past, access_mode: 'read', access_count: 0, password_protected: false, created_by: 'u', created_at: '' },
        { share_id: 's3', session_id: 'x', access_mode: 'read', access_count: 0, password_protected: false, created_by: 'u', created_at: '' },
      ] as any)

      const store = useCollabStore()
      await store.loadShares('x')

      expect(store.activeShares).toHaveLength(2) // future + no expiry
      expect(store.expiredShares).toHaveLength(1) // past
    })
  })

  describe('snapshots', () => {
    it('creates and deletes snapshots', async () => {
      const snapshot = { snapshot_id: 'snap1', session_id: 'sess1', title: 'v1', created_at: '', turn_count: 5, context_usage: { used: 100, capacity: 1000 } }
      mockApi.listSessionSnapshots.mockResolvedValue([] as any)
      mockApi.createSessionSnapshot.mockResolvedValue(snapshot as any)
      mockApi.deleteSessionSnapshot.mockResolvedValue({ ok: true })

      const store = useCollabStore()
      await store.loadSnapshots('sess1')
      expect(store.snapshots).toHaveLength(0)

      await store.createSnapshot('sess1', 'v1')
      expect(store.snapshots).toHaveLength(1)

      await store.deleteSnapshot('snap1')
      expect(store.snapshots).toHaveLength(0)
    })
  })
})
