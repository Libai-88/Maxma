import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'

import IconRail from '@/components/IconRail.vue'
import ChatHeader from '@/components/ChatHeader.vue'
import SessionDrawer from '@/components/SessionDrawer.vue'
import type { SessionInfo } from '@/types'
import { usePersonaStore } from '@/stores/persona'
import { useSessionStore } from '@/stores/session'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/activity', component: { template: '<div />' } },
      { path: '/appearance', component: { template: '<div />' } },
      { path: '/help', component: { template: '<div />' } },
      { path: '/providers', component: { template: '<div />' } },
      { path: '/mcp', component: { template: '<div />' } },
      { path: '/skills', component: { template: '<div />' } },
      { path: '/soul', component: { template: '<div />' } },
      { path: '/user', component: { template: '<div />' } },
      { path: '/memory', component: { template: '<div />' } },
      { path: '/kb', component: { template: '<div />' } },
      { path: '/path-whitelist', component: { template: '<div />' } },
      { path: '/maxma-blocker', component: { template: '<div />' } },
      { path: '/env-vars', component: { template: '<div />' } },
      { path: '/privacy', component: { template: '<div />' } },
      { path: '/metrics', component: { template: '<div />' } },
      { path: '/audit-log', component: { template: '<div />' } },
    ],
  })
}

describe('workspace shell', () => {
  it('header ownership keeps only active context controls and truncates long titles', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/ChatView.vue'), 'utf8')
    const chatInputSource = readFileSync(resolve(process.cwd(), 'src/components/ChatInput.vue'), 'utf8')
    const modelSelectorSource = readFileSync(resolve(process.cwd(), 'src/components/ModelSelector.vue'), 'utf8')
    const headerBlock = source.match(/<ChatHeader>[\s\S]*?<\/ChatHeader>/)?.[0] ?? ''
    const chatInputTemplate = chatInputSource.match(/<template>[\s\S]*?<\/template>/)?.[0] ?? ''

    expect(headerBlock).not.toContain('<ModelSelector')
    expect(headerBlock).not.toContain('<ContextUsageBadge')
    expect(headerBlock).toContain('<StatusBadge')
    expect(headerBlock).toContain('aria-label="更多会话操作"')
    expect(headerBlock).toContain('aria-label="工作台"')
    expect(headerBlock).toContain('class="session-task-status"')
    expect(headerBlock).toContain('v-if="taskTrackerData"')
    const menuStart = headerBlock.indexOf('class="session-actions-menu"')
    const taskStatusIndex = headerBlock.indexOf('<TaskTrackerBar')
    expect(menuStart).toBeGreaterThanOrEqual(0)
    expect(taskStatusIndex).toBeGreaterThan(menuStart)

    expect((chatInputTemplate.match(/<ModelSelector\b/g) ?? [])).toHaveLength(1)
    expect((chatInputTemplate.match(/<ContextUsageBadge\b/g) ?? [])).toHaveLength(1)
    expect(chatInputTemplate).not.toContain('provider-select')
    expect(chatInputTemplate).not.toContain('<DsSelect')
    expect((modelSelectorSource.match(/class="composer-model-selector"/g) ?? [])).toHaveLength(1)
    expect((modelSelectorSource.match(/<DsSelect\b/g) ?? [])).toHaveLength(1)
  })

  it('keeps Composer keyboard, send payload, and layout boundaries intact', () => {
    const chatInputSource = readFileSync(resolve(process.cwd(), 'src/components/ChatInput.vue'), 'utf8')
    const chatViewSource = readFileSync(resolve(process.cwd(), 'src/views/ChatView.vue'), 'utf8')
    const chatInputTemplate = chatInputSource.match(/<template>[\s\S]*?<\/template>/)?.[0] ?? ''

    expect((chatInputTemplate.match(/class="input-area"/g) ?? [])).toHaveLength(1)
    expect(chatInputTemplate).toContain('@keydown="onKeydown"')
    expect(chatInputSource).toContain('if (e.isComposing || e.keyCode === 229) return')
    expect(chatInputSource).toContain("if (e.key === 'Enter' && !e.shiftKey)")
    expect(chatInputSource).toContain('e.preventDefault()')
    expect(chatInputTemplate).toContain('v-if="!isStreaming"')
    expect(chatInputTemplate).toContain('class="btn-stop"')
    expect(chatInputTemplate).toContain('chatInput.stop()')
    expect(chatInputTemplate).toContain('@click="pickFile"')
    expect(chatInputTemplate).toContain('@click="pickFolder"')
    expect(chatInputTemplate).toContain('@click="pickImage"')
    expect(chatInputTemplate).toContain('@click="startLinkInput"')
    expect(chatInputTemplate).toContain('class="quoted-selections-bar"')
    expect(chatInputTemplate).toContain('<ThinkPathChooser')
    expect(chatInputTemplate).toContain('<AutocompletePanel')
    expect(chatInputTemplate).toContain('<StickerPicker')
    expect(chatInputSource).toContain('refs.value')
    expect(chatInputSource).toContain('selectedThinkPathId.value || undefined')
    expect(chatViewSource).toContain('send(text, [...refs, ...quoteRefs], providerId, modelName, thinkPathId)')
    expect(chatInputSource).toContain('text.value += stickerTag')

    const chatInputStyle = chatInputSource.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''
    expect(chatInputStyle).toContain('min-width: 0')
    expect(chatInputStyle).toContain('max-height: min(42vh, 420px)')
    expect(chatInputStyle).toContain('.input-body')
    expect(chatInputStyle).toContain('overflow-y: auto')
  })

  it('keeps the conversation stream as the primary responsive scroll boundary', () => {
    const chatViewSource = readFileSync(resolve(process.cwd(), 'src/views/ChatView.vue'), 'utf8')
    const chatWindowSource = readFileSync(resolve(process.cwd(), 'src/components/ChatWindow.vue'), 'utf8')
    const messageBubbleSource = readFileSync(resolve(process.cwd(), 'src/components/MessageBubble.vue'), 'utf8')
    const workflowSource = readFileSync(resolve(process.cwd(), 'src/components/WorkflowCard.vue'), 'utf8')

    const chatViewStyle = chatViewSource.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''
    const chatWindowStyle = chatWindowSource.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''
    const messageBubbleStyle = messageBubbleSource.match(/<style scoped>[\s\S]*?<\/style>/)?.[0] ?? ''

    expect(chatViewStyle).toContain('.chat-workbench-layout')
    expect(chatViewStyle).toContain('display: flex')
    expect(chatViewStyle).toContain('flex: 1')
    expect(chatViewStyle).toContain('min-width: 0')
    expect(chatViewStyle).toContain('min-height: 0')
    expect(chatViewStyle).toContain('overflow: hidden')
    expect(chatViewStyle).toContain('.chat-main-column')

    expect(chatWindowStyle).toContain('.chat-window')
    expect(chatWindowStyle).toContain('min-width: 0')
    expect(chatWindowStyle).toContain('min-height: 0')
    expect(chatWindowStyle).toContain('.messages-list')
    expect(chatWindowStyle).toContain('overflow-y: auto')
    expect(chatWindowStyle).toContain('overflow-x: hidden')

    expect(messageBubbleStyle).toContain('max-width: min(100%, 760px)')
    expect(messageBubbleStyle).toContain('overflow-wrap: anywhere')
    expect(chatWindowSource).toContain(':sticker-url="turn.stickerUrl"')
    expect(messageBubbleSource).toContain('stripStickerDirectives')
    expect(messageBubbleSource).toContain('<StickerInline')

    expect(workflowSource).toContain('v-if="available"')
    expect(workflowSource).toContain('workflowIds.value.length > 0 || runs.value.length > 0')
  })

  it('keeps real WelcomeScreen starts wired to ChatView and removes actionless shells', () => {
    const welcomeSource = readFileSync(resolve(process.cwd(), 'src/components/WelcomeScreen.vue'), 'utf8')
    const chatViewSource = readFileSync(resolve(process.cwd(), 'src/views/ChatView.vue'), 'utf8')

    expect(welcomeSource).not.toContain('capability-strip')
    expect(welcomeSource).not.toContain('const capabilities')
    expect(welcomeSource).toContain('@click="$emit(\'start\', ex.text)"')
    expect((welcomeSource.match(/\$emit\('start'/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(chatViewSource).toContain('<WelcomeScreen v-else @start="handleQuickStart" />')
    expect(chatViewSource).toContain('chatInputInstance.send(message)')
  })

  it('shows a short current session title while keeping the full context in title', () => {
    const pinia = createPinia()
    const persona = usePersonaStore(pinia)
    const sessions = useSessionStore(pinia)
    const longScene = '一个非常长的场景描述，用于验证顶部标题不会撑破布局'
    persona.profile = {
      ...persona.profile,
      description: '一段非常长的人设描述，用于验证标题截断',
      scene: longScene,
    }
    sessions.sessionId = 'session-1'
    sessions.sessions = [{
      session_id: 'session-1',
      message_count: 2,
      created_at: 1,
      last_active: 2,
      is_const: true,
      const_name: '一个很长很长的会话标题用于验证截断行为',
    }]

    const wrapper = mount(ChatHeader, { global: { plugins: [pinia] } })
    const header = wrapper.get('.header-left')
    expect(wrapper.find('.header-details').exists()).toBe(false)
    expect(header.attributes('title')).toContain(longScene)
    expect(wrapper.get('.header-session').text()).toContain('一个很长很长的会话标题')
    wrapper.unmount()
  })

  it('icon rail exposes real navigation and a session drawer trigger', async () => {
    const router = createTestRouter()
    await router.push('/activity')
    await router.isReady()

    const wrapper = mount(IconRail, {
      props: { onboardingEnabled: true },
      global: { plugins: [router, createPinia()] },
    })

    const nav = wrapper.get('nav[aria-label="主导航"]')
    expect(nav.find('a[href="/"]').exists()).toBe(true)
    expect(nav.find('a[href="/activity"]').exists()).toBe(true)
    expect(nav.find('a[href="/appearance"]').exists()).toBe(false)
    expect(nav.find('a[href="/help"]').exists()).toBe(true)
    expect(nav.find('a[href="/activity"]').attributes('aria-current')).toBe('page')

    const settingsTrigger = wrapper.get('button[aria-label="设置"]')
    expect(settingsTrigger.attributes('title')).toBe('设置')

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

    await settingsTrigger.trigger('click')
    await nextTick()
    const settingsPopup = document.body.querySelector('.settings-popup')
    expect(settingsPopup).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/providers"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/mcp"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/skills"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/soul"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/user"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/memory"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/kb"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('a[href="/audit-log"]')).toBeTruthy()
    expect(settingsPopup?.querySelector('button')?.textContent).toContain('重新开始引导')
    wrapper.unmount()
  })

  it('opens the session drawer with dialog semantics, traps focus, and restores focus', async () => {
    const opener = document.createElement('button')
    opener.type = 'button'
    document.body.appendChild(opener)
    opener.focus()

    const wrapper = mount(SessionDrawer, {
      props: { open: false, sessions: [] },
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    const drawer = wrapper.get('aside[aria-label="会话抽屉"]')
    expect(drawer.attributes('role')).toBe('dialog')
    expect(drawer.attributes('aria-modal')).toBe('true')
    expect(drawer.attributes('aria-labelledby')).toBe('session-drawer-title')
    expect(document.activeElement).toBe(wrapper.get('.session-drawer__close').element)

    const focusable = wrapper.findAll('aside button')
    expect(focusable.length).toBeGreaterThanOrEqual(2)
    const first = focusable[0].element
    const last = focusable[focusable.length - 1].element

    last.focus()
    await drawer.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    await drawer.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    const childInput = document.createElement('input')
    childInput.className = 'constify-input'
    drawer.element.appendChild(childInput)
    childInput.focus()
    childInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toBeUndefined()
    childInput.remove()

    await drawer.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })

  it('closes from the scrim and keeps the existing CRUD actions', async () => {
    const wrapper = mount(SessionDrawer, {
      props: { open: true, sessions: [] },
      global: { plugins: [createPinia()] },
      attachTo: document.body,
    })
    await wrapper.get('.session-drawer__scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
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
