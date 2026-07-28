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
  async function loadShares(sessionId: string) {
    loading.value = true
    error.value = ''
    try {
      shares.value = await api.listSessionShares(sessionId)
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function createShare(request: CreateShareRequest): Promise<SessionShare> {
    try {
      const share = await api.createSessionShare(request)
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
      shares.value = shares.value.filter(s => s.share_id !== shareId)
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    }
  }

  async function loadSnapshots(sessionId: string) {
    loading.value = true
    error.value = ''
    try {
      snapshots.value = await api.listSessionSnapshots(sessionId)
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function createSnapshot(sessionId: string, title: string): Promise<SessionSnapshot> {
    try {
      const snapshot = await api.createSessionSnapshot(sessionId, title)
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
