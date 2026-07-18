import { defineStore } from 'pinia'
import { ref } from 'vue'
import { tauriFetch } from '@/utils/env'

export interface PersonaProfile {
  name: string
  description: string
  nickname: string
  scene: string
  style: string
  greeting: string
  avatar: string
}

export const usePersonaStore = defineStore('persona', () => {
  const profile = ref<PersonaProfile>({
    name: 'Maxma',
    description: '温暖体贴又有点调皮的大姐姐',
    nickname: '你',
    scene: '吵闹的小公寓',
    style: 'playful · 直接 · 温暖',
    greeting: '你来啦。',
    avatar: '✦',
  })
  const loading = ref(false)
  const error = ref<string | null>(null)
  let _loaded = false

  async function fetchProfile() {
    if (_loaded) return
    loading.value = true
    error.value = null
    try {
      const { getToken } = await import('../api/index')
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      // 修复：Tauri 环境下 WebView2 不允许从 tauri://localhost 向 http:// 发起原生 fetch()，
      // 必须使用 tauriFetch（内部走 @tauri-apps/plugin-http 的 Rust reqwest）。
      const res = await tauriFetch('/api/persona/profile', { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data && typeof data === 'object') profile.value = data
      _loaded = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败'
      /* use defaults */
    }
    finally { loading.value = false }
  }

  async function loadProfile() {
    _loaded = false
    await fetchProfile()
  }

  return { profile, loading, error, fetchProfile, loadProfile }
})
