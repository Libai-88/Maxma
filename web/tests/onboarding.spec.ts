import { beforeEach, describe, expect, it } from 'vitest'
import { ONBOARDING_STORAGE_KEY, loadOnboardingSnapshot, onboardingEnabled, saveOnboardingSnapshot } from '@/stores/onboarding'

describe('onboarding persistence', () => {
  beforeEach(() => localStorage.clear())
  it('is disabled unless explicitly enabled at build time', () => expect(onboardingEnabled).toBe(false))
  it('starts incomplete without stored state', () => expect(loadOnboardingSnapshot()).toMatchObject({ completed: false, preferences: { language: 'zh-CN', workspace: 'personal' } }))
  it('persists completion and local-only preferences', () => {
    saveOnboardingSnapshot({ completed: true, preferences: { displayName: 'Ada', language: 'en', workspace: 'project' } })
    expect(loadOnboardingSnapshot()).toEqual({ completed: true, preferences: { displayName: 'Ada', language: 'en', workspace: 'project' } })
  })
  it('recovers from malformed persisted state', () => { localStorage.setItem(ONBOARDING_STORAGE_KEY, '{invalid'); expect(loadOnboardingSnapshot().completed).toBe(false) })
})
