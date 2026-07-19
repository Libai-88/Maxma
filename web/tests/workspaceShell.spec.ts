import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'

import IconRail from '@/components/IconRail.vue'
import SessionDrawer from '@/components/SessionDrawer.vue'
import type { SessionInfo } from '@/types'

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

  it('opens the session drawer, focuses close, and closes on escape or scrim', async () => {
    const wrapper = mount(SessionDrawer, {
      props: { open: true, sessions: [] },
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })

    await wrapper.vm.$nextTick()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(wrapper.get('aside[aria-label="会话抽屉"]')).toBeTruthy()
    expect(document.activeElement).toBe(wrapper.get('.session-drawer__close').element)

    await wrapper.get('.session-drawer__scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.get('aside[aria-label="会话抽屉"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })

  it('forwards session CRUD actions without mounting chat again', async () => {
    const session: SessionInfo = {
      session_id: 'session-1',
      message_count: 2,
      created_at: 1,
      last_active: 2,
      is_const: false,
    }
    const wrapper = mount(SessionDrawer, {
      props: { open: true, sessions: [session] },
      global: { plugins: [createPinia()] },
    })

    await wrapper.get('button[aria-label="新建会话"]').trigger('click')
    await wrapper.get('.session-item').trigger('click')
    await wrapper.get('.btn-delete').trigger('click')
    const deleteConfirm = document.querySelector<HTMLButtonElement>('.delete-confirm-btn.confirm')
    expect(deleteConfirm).toBeTruthy()
    deleteConfirm?.click()

    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('switch')?.[0]).toEqual(['session-1'])
    expect(wrapper.emitted('delete')?.[0]).toEqual(['session-1'])
    expect(wrapper.findComponent({ name: 'ModelSettingsPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ToolPanel' }).exists()).toBe(false)
    expect(wrapper.find('.session-intro-card').exists()).toBe(false)
    wrapper.unmount()
  })
})
