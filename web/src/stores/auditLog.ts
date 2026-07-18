import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import type { AuditLogRecord, AuditLogStats } from '@/types'

export const useAuditLogStore = defineStore('auditLog', () => {
  const records = ref<AuditLogRecord[]>([])
  const stats = ref<AuditLogStats>({
    total: 0,
    by_type: {},
    by_status: {},
    top_targets: [],
  })
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadRecords(opts: { limit?: number; eventType?: string; since?: string } = {}) {
    loading.value = true
    error.value = null
    try {
      const { limit = 100, eventType = '', since = '' } = opts
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      if (eventType) params.set('event_type', eventType)
      if (since) params.set('since', since)
      const res = await api.getAuditLog(`?${params.toString()}`)
      records.value = res.records
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
      records.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadStats() {
    try {
      const res = await api.getAuditStats()
      stats.value = res.stats
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function refreshAll(opts: { limit?: number; eventType?: string; since?: string } = {}) {
    await Promise.all([loadRecords(opts), loadStats()])
  }

  async function clearAll() {
    try {
      const res = await api.clearAuditLog()
      await refreshAll()
      return res.deleted
    } catch (e) {
      console.warn('[auditLog] clearAll failed:', e)
      return 0
    }
  }

  async function encryptKeys() {
    try {
      const res = await api.encryptApiKeys()
      return res.encrypted
    } catch (e) {
      console.warn('[auditLog] encryptKeys failed:', e)
      return 0
    }
  }

  return {
    records,
    stats,
    loading,
    error,
    loadRecords,
    loadStats,
    refreshAll,
    clearAll,
    encryptKeys,
  }
})
