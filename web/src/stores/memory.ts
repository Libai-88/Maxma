import { create } from 'zustand'
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

interface MemoryState {
  facts: MemoryFact[]
  loading: boolean
  fetchFacts: () => Promise<void>
  deleteFact: (id: string) => Promise<void>
}

export const useMemoryStore = create<MemoryState>()((set, get) => {
  async function fetchFacts() {
    set({ loading: true })
    try {
      const data: unknown = await api.request<unknown>('/memory')
      let facts: MemoryFact[] = []
      if (Array.isArray(data)) {
        facts = data as MemoryFact[]
      } else if (
        data && typeof data === 'object' && 'facts' in data &&
        Array.isArray((data as Record<string, unknown>).facts)
      ) {
        facts = (data as Record<string, unknown>).facts as MemoryFact[]
      }
      set({ facts })
    } catch {
      set({ facts: [] })
    } finally {
      set({ loading: false })
    }
  }

  async function deleteFact(id: string) {
    try {
      await api.request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
      set({ facts: get().facts.filter(f => f.id !== id) })
    } catch (e) {
      log.warn('deleteFact failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return {
    facts: [],
    loading: false,
    fetchFacts,
    deleteFact,
  }
})
