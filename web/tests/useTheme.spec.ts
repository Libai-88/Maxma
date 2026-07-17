import { describe, expect, it, vi } from 'vitest'

const mqlAddEventListener = vi.fn()
const mqlRemoveEventListener = vi.fn()
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: mqlAddEventListener,
  removeEventListener: mqlRemoveEventListener,
})))

const { cleanupThemeListener } = await import('@/composables/useTheme')

describe('useTheme', () => {
  it('registers and removes the matchMedia change listener', () => {
    expect(mqlAddEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(mqlRemoveEventListener).not.toHaveBeenCalled()

    cleanupThemeListener()

    expect(mqlRemoveEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
