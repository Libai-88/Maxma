import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

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

  function initialize() {
    if (initialized.value) return
    snapshot.value = loadOnboardingSnapshot()
    initialized.value = true
  }

  function persist() {
    const ok = saveOnboardingSnapshot(snapshot.value)
    if (!ok) {
      console.warn('[onboarding] Failed to persist onboarding snapshot to localStorage')
    }
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
