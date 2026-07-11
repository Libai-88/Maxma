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

export const onboardingEnabled = import.meta.env.VITE_ONBOARDING_ENABLED === 'true'

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
    saveOnboardingSnapshot(snapshot.value)
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
