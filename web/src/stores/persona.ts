import { create } from 'zustand'
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

interface PersonaState {
  profile: PersonaProfile
  loading: boolean
  error: string | null
  fetchProfile: (force?: boolean) => Promise<void>
  loadProfile: () => Promise<void>
}

const defaultProfile: PersonaProfile = {
  name: 'Maxma',
  description: '温暖体贴又有点调皮的大姐姐',
  nickname: '你',
  scene: '吵闹的小公寓',
  style: 'playful · 直接 · 温暖',
  greeting: '你来啦。',
  avatar: '✦',
}

export const usePersonaStore = create<PersonaState>()((set) => {
  let _loaded = false

  async function fetchProfile(force = false) {
    // PERSONA-STALE-001：默认只在首次加载（_loaded 守卫避免重复请求）；
    // 但保存人设后必须刷新——force=true 绕过守卫强制拉取最新配置，
    // 否则 SoulView 保存走另一条 API，store 里的 profile 永远陈旧。
    if (_loaded && !force) return
    set({ loading: true, error: null })
    try {
      const data = await api.request<PersonaProfile>('/persona/profile')
      if (data && typeof data === 'object') set({ profile: data })
      _loaded = true
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '加载失败' })
      /* use defaults */
    } finally {
      set({ loading: false })
    }
  }

  async function loadProfile() {
    await fetchProfile(true)
  }

  return {
    profile: { ...defaultProfile },
    loading: false,
    error: null,
    fetchProfile,
    loadProfile,
  }
})
