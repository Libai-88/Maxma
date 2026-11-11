import { create } from 'zustand'
import { api } from '@/api'
import type { ToolInfo } from '@/types'

export interface ToolCategoryGroup {
  category: string
  tools: ToolInfo[]
}

interface ToolsState {
  tools: ToolInfo[]
  loading: boolean
  categories: ToolCategoryGroup[]
  fetchTools: () => Promise<void>
}

function deriveCategories(tools: ToolInfo[]): ToolCategoryGroup[] {
  const map = new Map<string, ToolInfo[]>()
  for (const t of tools) {
    const cat = t.category || 'other'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(t)
  }
  return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, tools: items }))
}

export const useToolsStore = create<ToolsState>()((set) => {
  async function fetchTools() {
    set({ loading: true })
    try {
      const data = await api.listTools()
      const tools = Array.isArray(data) ? data : []
      set({ tools, categories: deriveCategories(tools) })
    } catch {
      set({ tools: [], categories: [] })
    } finally {
      set({ loading: false })
    }
  }

  return {
    tools: [],
    loading: false,
    categories: [],
    fetchTools,
  }
})
