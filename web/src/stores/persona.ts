import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/api'

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

  async function fetchProfile(force = false) {
    // PERSONA-STALE-001：默认只在首次加载（_loaded 守卫避免重复请求）；
    // 但保存人设后必须刷新——force=true 绕过守卫强制拉取最新配置，
    // 否则 SoulView 保存走另一条 API，store 里的 profile 永远陈旧。
    if (_loaded && !force) return
    loading.value = true
    error.value = null
    try {
      const data = await api.request<PersonaProfile>('/persona/profile')
      if (data && typeof data === 'object') profile.value = data
      _loaded = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败'
      /* use defaults */
    }
    finally { loading.value = false }
  }

  async function loadProfile() {
    await fetchProfile(true)
  }

  return { profile, loading, error, fetchProfile, loadProfile }
})
