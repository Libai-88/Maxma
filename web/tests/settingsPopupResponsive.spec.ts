import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import AppSettingsMenu from '@/components/AppSettingsMenu.vue'

const defaultInnerHeight = window.innerHeight
let mountedWrapper: ReturnType<typeof mount> | null = null

function setViewportHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  })
}

function mountSettingsMenu() {
  mountedWrapper = mount(AppSettingsMenu, {
    attachTo: document.body,
    props: { onboardingEnabled: false },
    global: {
      plugins: [createPinia()],
      stubs: {
        Icon: true,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
  return mountedWrapper
}

afterEach(() => {
  mountedWrapper?.unmount()
  mountedWrapper = null
  document.body.querySelectorAll('.settings-popup').forEach(node => node.remove())
  setViewportHeight(defaultInnerHeight)
})

describe('AppSettingsMenu responsive popup', () => {
  it('opens above a bottom trigger and keeps the long menu inside a scrollable viewport', async () => {
    setViewportHeight(640)
    const wrapper = mountSettingsMenu()
    const trigger = wrapper.get('.settings-area').element
    const triggerRect = {
      top: 560,
      bottom: 604,
      left: 12,
      right: 56,
      width: 44,
      height: 44,
      x: 12,
      y: 560,
      toJSON: () => ({}),
    } as DOMRect
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(triggerRect)

    await wrapper.get('button[aria-label="设置"]').trigger('click')
    const popup = document.body.querySelector<HTMLElement>('.settings-popup')
    expect(popup).toBeTruthy()

    const top = Number.parseFloat(popup?.style.top ?? '')
    const bottom = Number.parseFloat(popup?.style.bottom ?? '')
    expect(Number.isNaN(top) || top >= triggerRect.bottom).toBe(true)
    expect(bottom).toBeGreaterThan(window.innerHeight - triggerRect.top)

    const maxHeight = Number.parseFloat(popup?.style.maxHeight ?? '')
    expect(maxHeight).toBeGreaterThan(0)
    expect(maxHeight).toBeLessThanOrEqual(triggerRect.top - 16)
    expect(getComputedStyle(popup as HTMLElement).overflowY).toBe('auto')

  })
})
