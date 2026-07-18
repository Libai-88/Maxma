import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getToken } from '@/api'
import { tauriFetch } from '@/utils/env'

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
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      // 修复：Tauri 环境下 WebView2 不允许从 tauri://localhost 向 http:// 发起原生 fetch()，
      // 必须使用 tauriFetch（内部走 @tauri-apps/plugin-http 的 Rust reqwest）。
      const res = await tauriFetch('/api/tools', { headers })
      if (!res.ok) {
        tools.value = []
        return
      }
      const data = await res.json()
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
      if (!map.has(t.category)) map.set(t.category, [])
      map.get(t.category)!.push(t)
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, tools: items }))
  })

  return { tools, loading, categories, fetchTools }
})
