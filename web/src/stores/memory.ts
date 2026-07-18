import { defineStore } from 'pinia'
import { ref } from 'vue'
import { tauriFetch } from '@/utils/env'

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
      // 修复：Tauri 环境下 WebView2 不允许从 tauri://localhost 向 http:// 发起原生 fetch()，
      // 必须使用 tauriFetch（内部走 @tauri-apps/plugin-http 的 Rust reqwest）。
      const res = await tauriFetch('/api/memory', { headers })
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
      // 修复：同上，使用 tauriFetch 替代原生 fetch。
      const res = await tauriFetch(`/api/memory/${id}`, { method: 'DELETE', headers })
      if (!res.ok) return
      facts.value = facts.value.filter(f => f.id !== id)
    } catch (e) {
      console.warn('[memory] deleteFact failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return { facts, loading, fetchFacts, deleteFact }
})
