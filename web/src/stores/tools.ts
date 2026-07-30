import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'

export interface ToolInfo {
  name: string
  label: string
  description: string
  category: string
  builtin: boolean
}

export const useToolsStore = defineStore('tools', () => {
  const tools = ref<ToolInfo[]>([])
  const loading = ref(false)

  async function fetchTools() {
    loading.value = true
    try {
      const data: unknown = await api.request<unknown>('/tools')
      if (Array.isArray(data)) {
        tools.value = data
      } else if (data && typeof data === 'object' && 'tools' in data && Array.isArray((data as Record<string, unknown>).tools)) {
        tools.value = (data as Record<string, unknown>).tools as ToolInfo[]
      } else {
        tools.value = []
      }
    } catch {
      tools.value = []
    } finally {
      loading.value = false
    }
  }

  const categories = computed(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const t of tools.value) {
      if (!map.has(t.category)) map.set(t.category, [])
      map.get(t.category)!.push(t)
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, tools: items }))
  })

  return { tools, loading, categories, fetchTools }
})
