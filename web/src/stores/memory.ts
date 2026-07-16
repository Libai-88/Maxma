import { defineStore } from 'pinia'
import { ref } from 'vue'

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
      const res = await fetch('/api/memory')
      const data = await res.json()
      facts.value = Array.isArray(data) ? data : []
    } catch { facts.value = [] }
    finally { loading.value = false }
  }

  async function deleteFact(id: string) {
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' })
      facts.value = facts.value.filter(f => f.id !== id)
    } catch {}
  }

  return { facts, loading, fetchFacts, deleteFact }
})
