import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'
import type { ToolInfo } from '@/types'

export const useToolsStore = defineStore('tools', () => {
  const tools = ref<ToolInfo[]>([])
  const loading = ref(false)

  async function fetchTools() {
    loading.value = true
    try {
      const data = await api.listTools()
      tools.value = Array.isArray(data) ? data : []
    } catch {
      tools.value = []
    } finally {
      loading.value = false
    }
  }

  const categories = computed(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const t of tools.value) {
      const cat = t.category || 'other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(t)
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, tools: items }))
  })

  return { tools, loading, categories, fetchTools }
})
