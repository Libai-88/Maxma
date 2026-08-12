import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { request } from '@/api'
import { createLogger } from '@/utils/logger'

const log = createLogger('onboarding')

export const ONBOARDING_STORAGE_KEY = 'maxma.onboarding.v1'

export interface OnboardingPreferences {
  displayName: string
  language: 'zh-CN' | 'en'
  workspace: 'personal' | 'project'
}

export interface OnboardingSnapshot {
  completed: boolean
  preferences: OnboardingPreferences
}

const defaultPreferences: OnboardingPreferences = {
  displayName: '',
  language: 'zh-CN',
  workspace: 'personal',
}

function copyDefaults(): OnboardingSnapshot {
  return { completed: false, preferences: { ...defaultPreferences } }
}

/** 从后端响应规范化 snapshot（字段白名单与 loadOnboardingSnapshot 保持一致） */
function normalizeSnapshot(data: unknown): OnboardingSnapshot | null {
  if (!data || typeof data !== 'object') return null
  const parsed = data as Partial<OnboardingSnapshot>
  if (typeof parsed.completed !== 'boolean') return null
  const preferences = (parsed.preferences ?? {}) as Partial<OnboardingPreferences>
  return {
    completed: parsed.completed,
    preferences: {
      displayName: typeof preferences.displayName === 'string' ? preferences.displayName.slice(0, 80) : '',
      language: preferences.language === 'en' ? 'en' : 'zh-CN',
      workspace: preferences.workspace === 'project' ? 'project' : 'personal',
    },
  }
}

export function loadOnboardingSnapshot(storage: Storage = localStorage): OnboardingSnapshot {
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return copyDefaults()
    const parsed = JSON.parse(raw) as Partial<OnboardingSnapshot>
    const preferences = (parsed.preferences ?? {}) as Partial<OnboardingPreferences>
    return {
      completed: parsed.completed === true,
      preferences: {
        displayName: typeof preferences.displayName === 'string' ? preferences.displayName.slice(0, 80) : '',
        language: preferences.language === 'en' ? 'en' : 'zh-CN',
        workspace: preferences.workspace === 'project' ? 'project' : 'personal',
      },
    }
  } catch {
    return copyDefaults()
  }
}

export function saveOnboardingSnapshot(snapshot: OnboardingSnapshot, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

// Onboarding 默认启用：未设置环境变量时为 true，仅在显式设置为 'false' 时关闭。
// 这样新用户（特别是 Novice 画像）开箱即可看到首次引导，无需配置 .env。
// 如果发行方想关闭引导，可在构建时显式设置 VITE_ONBOARDING_ENABLED=false。
const rawOnboardingFlag = import.meta.env.VITE_ONBOARDING_ENABLED
export const onboardingEnabled = rawOnboardingFlag === undefined ? true : rawOnboardingFlag === 'true'

export const useOnboardingStore = defineStore('onboarding', () => {
  const snapshot = ref<OnboardingSnapshot>(copyDefaults())
  const initialized = ref(false)
  const shouldShow = computed(() => onboardingEnabled && initialized.value && !snapshot.value.completed)

  // ONBOARDING-PORTABLE-001：引导状态以后端为准（随数据目录走，便携版与
  // 标准版各自独立）。此前仅存 localStorage，WebView2 profile 共享时互相
  // 污染——任一版本点过"跳过/完成"，另一版本首启便直接跳过引导。
  // 后端不可用（旧版本后端/网络异常）时回退 localStorage，保证兼容。
  async function initialize() {
    if (initialized.value) return
    try {
      const data = await request<unknown>('/onboarding/state')
      const normalized = normalizeSnapshot(data)
      // 关键：后端无记录（新用户）时**不信任** localStorage 的 completed——
      // 它可能来自共享 profile 的旧状态。一律按新用户显示引导。
      snapshot.value = normalized ?? copyDefaults()
    } catch (err) {
      log.warn('onboarding state fetch failed, fallback to localStorage:', err)
      snapshot.value = loadOnboardingSnapshot()
    }
    initialized.value = true
  }

  function persist() {
    // localStorage 仅作缓存/兜底（后端不可用时 initialize 仍能恢复最近状态）
    const ok = saveOnboardingSnapshot(snapshot.value)
    if (!ok) {
      log.warn('Failed to persist onboarding snapshot to localStorage')
    }
    // 同步到后端：状态随数据目录持久化
    void request('/onboarding/state', {
      method: 'PUT',
      body: JSON.stringify(snapshot.value),
    }).catch((err) => log.warn('onboarding state persist failed:', err))
  }

  function updatePreferences(preferences: Partial<OnboardingPreferences>) {
    snapshot.value = {
      ...snapshot.value,
      preferences: { ...snapshot.value.preferences, ...preferences },
    }
    persist()
  }

  function complete() {
    snapshot.value = { ...snapshot.value, completed: true }
    persist()
  }

  function restart() {
    snapshot.value = { ...snapshot.value, completed: false }
    persist()
  }

  return { snapshot, initialized, shouldShow, initialize, updatePreferences, complete, restart }
})
