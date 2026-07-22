import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'

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
      const data = await api.request<unknown>('/memory')
      facts.value = Array.isArray(data) ? data : []
    } catch { facts.value = [] }
    finally { loading.value = false }
  }

  async function deleteFact(id: string) {
    try {
      await api.request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
      facts.value = facts.value.filter(f => f.id !== id)
    } catch (e) {
      console.warn('[memory] deleteFact failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return { facts, loading, fetchFacts, deleteFact }
})
