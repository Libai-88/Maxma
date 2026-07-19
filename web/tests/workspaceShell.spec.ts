import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import IconRail from '@/components/IconRail.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/activity', component: { template: '<div />' } },
      { path: '/appearance', component: { template: '<div />' } },
      { path: '/help', component: { template: '<div />' } },
    ],
  })
}

describe('workspace shell', () => {
  it('icon rail exposes real navigation and a session drawer trigger', async () => {
    const router = createTestRouter()
    await router.push('/activity')
    await router.isReady()

    const wrapper = mount(IconRail, {
      global: { plugins: [router] },
    })

    const nav = wrapper.get('nav[aria-label="主导航"]')
    expect(nav.find('a[href="/"]').exists()).toBe(true)
    expect(nav.find('a[href="/activity"]').exists()).toBe(true)
    expect(nav.find('a[href="/appearance"]').exists()).toBe(true)
    expect(nav.find('a[href="/help"]').exists()).toBe(true)
    expect(nav.find('a[href="/activity"]').attributes('aria-current')).toBe('page')

    const sessionTrigger = wrapper.get('button[aria-label="会话"]')
    expect(sessionTrigger.attributes('title')).toBe('会话')

    for (const control of wrapper.findAll('a, button')) {
      expect(control.attributes('aria-label')).toBeTruthy()
      const styles = window.getComputedStyle(control.element)
      expect(parseFloat(styles.minWidth)).toBeGreaterThanOrEqual(44)
      expect(parseFloat(styles.minHeight)).toBeGreaterThanOrEqual(44)
    }

    await sessionTrigger.trigger('click')
    expect(wrapper.emitted('toggle-session-drawer')).toHaveLength(1)
    wrapper.unmount()
  })
})
