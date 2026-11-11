import { create } from 'zustand'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import type {
  SessionShare,
  CreateShareRequest,
  SessionSnapshot,
  CollabUser,
} from '@/types/collab'

interface CollabDerived {
  activeShares: SessionShare[]
  expiredShares: SessionShare[]
}

interface CollabState extends CollabDerived {
  shares: SessionShare[]
  snapshots: SessionSnapshot[]
  activeUsers: CollabUser[]
  loading: boolean
  error: string
  loadShares: (sessionId: string) => Promise<void>
  createShare: (request: CreateShareRequest) => Promise<SessionShare>
  revokeShare: (shareId: string) => Promise<void>
  loadSnapshots: (sessionId: string) => Promise<void>
  createSnapshot: (sessionId: string, title: string) => Promise<SessionSnapshot>
  deleteSnapshot: (snapshotId: string) => Promise<void>
  clearError: () => void
}

function derive(shares: SessionShare[]): CollabDerived {
  const now = new Date()
  return {
    activeShares: shares.filter(s => !s.expires_at || new Date(s.expires_at) > now),
    expiredShares: shares.filter(s => s.expires_at && new Date(s.expires_at) <= now),
  }
}

export const useCollabStore = create<CollabState>()((set, get) => {
  // 会话切换竞态守卫（COLLAB-RACE-001）：快速 A→B→A 切换时慢响应后到会
  // 覆盖新会话数据。每次加载递增 seq，响应返回时 seq 已变化则丢弃。
  // shares/snapshots 各用独立计数器（loadCollabData 并发调用互不失效）。
  let _sharesSeq = 0
  let _snapshotsSeq = 0

  // 统一 set：shares 变化时重算 activeShares/expiredShares（computed 以值形式暴露）。
  function patch(p: Partial<CollabState>) {
    set((s) => {
      const shares = p.shares ?? s.shares
      return { ...p, ...derive(shares) }
    })
  }

  async function loadShares(sessionId: string) {
    const seq = ++_sharesSeq
    patch({ loading: true, error: '' })
    try {
      const data = await api.listSessionShares(sessionId)
      if (seq !== _sharesSeq) return // 已被更新的加载取代
      patch({ shares: data })
    } catch (e) {
      if (seq !== _sharesSeq) return
      patch({ error: toErrorMessage(e) })
      throw e
    } finally {
      if (seq === _sharesSeq) patch({ loading: false })
    }
  }

  async function createShare(request: CreateShareRequest): Promise<SessionShare> {
    try {
      const share = await api.createSessionShare(request)
      // COLLAB-MUTATE-RACE-001：mutation 后递增 seq，作废在途 loadShares
      // 响应——否则旧响应（不含新 share）后到会覆盖掉刚创建的 share
      _sharesSeq++
      patch({ shares: [...get().shares, share] })
      return share
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  async function revokeShare(shareId: string) {
    try {
      await api.revokeSessionShare(shareId)
      // COLLAB-MUTATE-RACE-001：mutation 后递增 seq，作废在途 loadShares
      // 响应——否则旧响应（仍含该 share）后到会让被撤销的 share 复活
      _sharesSeq++
      patch({ shares: get().shares.filter(s => s.share_id !== shareId) })
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  async function loadSnapshots(sessionId: string) {
    const seq = ++_snapshotsSeq
    patch({ loading: true, error: '' })
    try {
      const data = await api.listSessionSnapshots(sessionId)
      if (seq !== _snapshotsSeq) return
      patch({ snapshots: data })
    } catch (e) {
      if (seq !== _snapshotsSeq) return
      patch({ error: toErrorMessage(e) })
      throw e
    } finally {
      if (seq === _snapshotsSeq) patch({ loading: false })
    }
  }

  async function createSnapshot(sessionId: string, title: string): Promise<SessionSnapshot> {
    try {
      const snapshot = await api.createSessionSnapshot(sessionId, title)
      // COLLAB-MUTATE-RACE-001：同 shares，作废在途 loadSnapshots 响应
      _snapshotsSeq++
      patch({ snapshots: [...get().snapshots, snapshot] })
      return snapshot
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  async function deleteSnapshot(snapshotId: string) {
    try {
      await api.deleteSessionSnapshot(snapshotId)
      // COLLAB-MUTATE-RACE-001：同 shares，作废在途 loadSnapshots 响应
      _snapshotsSeq++
      patch({ snapshots: get().snapshots.filter(s => s.snapshot_id !== snapshotId) })
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  function clearError() {
    patch({ error: '' })
  }

  return {
    // state
    shares: [],
    snapshots: [],
    activeUsers: [],
    loading: false,
    error: '',
    // computed（以值形式暴露）
    activeShares: [],
    expiredShares: [],
    // actions
    loadShares,
    createShare,
    revokeShare,
    loadSnapshots,
    createSnapshot,
    deleteSnapshot,
    clearError,
  }
})
