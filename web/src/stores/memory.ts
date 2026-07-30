import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'
import { createLogger } from '@/utils/logger'

const log = createLogger('memory')

export interface MemoryFact {
  id: string
  content: string
  category: string
  confidence: number
  updatedAt: string
}

export const useMemoryStore = defineStore('memory', () => {
  const facts = ref<MemoryFact[]>([])
  const loading = ref(false)

  async function fetchFacts() {
    loading.value = true
    try {
      const data: unknown = await api.request<unknown>('/memory')
      if (Array.isArray(data)) {
        facts.value = data
      } else if (data && typeof data === 'object' && 'facts' in data && Array.isArray((data as Record<string, unknown>).facts)) {
        facts.value = (data as Record<string, unknown>).facts as MemoryFact[]
      } else {
        facts.value = []
      }
    } catch { facts.value = [] }
    finally { loading.value = false }
  }

  async function deleteFact(id: string) {
    try {
      await api.request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
      facts.value = facts.value.filter(f => f.id !== id)
    } catch (e) {
      log.warn('deleteFact failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return { facts, loading, fetchFacts, deleteFact }
})
