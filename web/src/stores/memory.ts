import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getApiBase, tauriFetch } from '@/utils/env'

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
      const { getToken } = await import('../api/index')
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      const BASE = getApiBase()
      const res = await tauriFetch(`${BASE}/memory`, { headers })
      if (!res.ok) {
        facts.value = []
        return
      }
      const data = await res.json()
      facts.value = Array.isArray(data) ? data : []
    } catch { facts.value = [] }
    finally { loading.value = false }
  }

  async function deleteFact(id: string) {
    try {
      const { getToken } = await import('../api/index')
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      const res = await tauriFetch(`${getApiBase()}/memory/${id}`, { method: 'DELETE', headers })
      if (!res.ok) return
      facts.value = facts.value.filter(f => f.id !== id)
    } catch (e) {
      console.warn('[memory] deleteFact failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return { facts, loading, fetchFacts, deleteFact }
})
