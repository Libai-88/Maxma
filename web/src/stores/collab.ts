import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import type {
  SessionShare,
  CreateShareRequest,
  SessionSnapshot,
  CollabUser,
} from '@/types/collab'

export const useCollabStore = defineStore('collab', () => {
  // ── State ──
  const shares = ref<SessionShare[]>([])
  const snapshots = ref<SessionSnapshot[]>([])
  const activeUsers = ref<CollabUser[]>([])
  const loading = ref(false)
  const error = ref('')

  // ── Computed ──
  const activeShares = computed(() =>
    shares.value.filter(s => !s.expires_at || new Date(s.expires_at) > new Date())
  )

  const expiredShares = computed(() =>
    shares.value.filter(s => s.expires_at && new Date(s.expires_at) <= new Date())
  )

  // ── Actions ──
  // 会话切换竞态守卫（COLLAB-RACE-001）：快速 A→B→A 切换时慢响应后到会
  // 覆盖新会话数据。每次加载递增 seq，响应返回时 seq 已变化则丢弃。
  // shares/snapshots 各用独立计数器（loadCollabData 并发调用互不失效）。
  let _sharesSeq = 0
  let _snapshotsSeq = 0

  async function loadShares(sessionId: string) {
    const seq = ++_sharesSeq
    loading.value = true
    error.value = ''
    try {
      const data = await api.listSessionShares(sessionId)
      if (seq !== _sharesSeq) return // 已被更新的加载取代
      shares.value = data
    } catch (e) {
      if (seq !== _sharesSeq) return
      error.value = toErrorMessage(e)
      throw e
    } finally {
      if (seq === _sharesSeq) loading.value = false
    }
  }

  async function createShare(request: CreateShareRequest): Promise<SessionShare> {
    try {
      const share = await api.createSessionShare(request)
      // COLLAB-MUTATE-RACE-001：mutation 后递增 seq，作废在途 loadShares
      // 响应——否则旧响应（不含新 share）后到会覆盖掉刚创建的 share
      _sharesSeq++
      shares.value.push(share)
      return share
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    }
  }

  async function revokeShare(shareId: string) {
    try {
      await api.revokeSessionShare(shareId)
      // COLLAB-MUTATE-RACE-001：mutation 后递增 seq，作废在途 loadShares
      // 响应——否则旧响应（仍含该 share）后到会让被撤销的 share 复活
      _sharesSeq++
      shares.value = shares.value.filter(s => s.share_id !== shareId)
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    }
  }

  async function loadSnapshots(sessionId: string) {
    const seq = ++_snapshotsSeq
    loading.value = true
    error.value = ''
    try {
      const data = await api.listSessionSnapshots(sessionId)
      if (seq !== _snapshotsSeq) return
      snapshots.value = data
    } catch (e) {
      if (seq !== _snapshotsSeq) return
      error.value = toErrorMessage(e)
      throw e
    } finally {
      if (seq === _snapshotsSeq) loading.value = false
    }
  }

  async function createSnapshot(sessionId: string, title: string): Promise<SessionSnapshot> {
    try {
      const snapshot = await api.createSessionSnapshot(sessionId, title)
      // COLLAB-MUTATE-RACE-001：同 shares，作废在途 loadSnapshots 响应
      _snapshotsSeq++
      snapshots.value.push(snapshot)
      return snapshot
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    }
  }

  async function deleteSnapshot(snapshotId: string) {
    try {
      await api.deleteSessionSnapshot(snapshotId)
      // COLLAB-MUTATE-RACE-001：同 shares，作废在途 loadSnapshots 响应
      _snapshotsSeq++
      snapshots.value = snapshots.value.filter(s => s.snapshot_id !== snapshotId)
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    }
  }

  function clearError() {
    error.value = ''
  }

  return {
    // state
    shares,
    snapshots,
    activeUsers,
    loading,
    error,
    // computed
    activeShares,
    expiredShares,
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
