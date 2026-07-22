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

  async function fetchProfile() {
    if (_loaded) return
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
    _loaded = false
    await fetchProfile()
  }

  return { profile, loading, error, fetchProfile, loadProfile }
})
