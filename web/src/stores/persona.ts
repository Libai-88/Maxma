import { defineStore } from 'pinia'
import { ref } from 'vue'

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

  async function fetchProfile() {
    loading.value = true
    try {
      const { getToken } = await import('../api/index')
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['X-Maxma-Token'] = token
      const res = await fetch('/api/persona/profile', { headers })
      const data = await res.json()
      if (data) profile.value = data
    } catch { /* use defaults */ }
    finally { loading.value = false }
  }

  return { profile, loading, fetchProfile }
})
