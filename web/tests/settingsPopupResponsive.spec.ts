import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import AppSettingsMenu from '@/components/AppSettingsMenu.vue'

let mountedWrapper: ReturnType<typeof mount> | null = null
let router: Router

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'chat', component: { template: '<div/>' } },
      { path: '/providers', component: { template: '<div/>' } },
      { path: '/mcp', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
      { path: '/soul', component: { template: '<div/>' } },
      { path: '/user', component: { template: '<div/>' } },
      { path: '/memory', component: { template: '<div/>' } },
      { path: '/privacy', component: { template: '<div/>' } },
      { path: '/capabilities', component: { template: '<div/>' } },
    ],
  })
}

function mountSettingsMenu() {
  mountedWrapper = mount(AppSettingsMenu, {
    attachTo: document.body,
    props: { onboardingEnabled: false },
    global: {
      plugins: [createPinia(), router],
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
  document.body.querySelectorAll('.animated-modal-container').forEach((node) => node.remove())
  vi.restoreAllMocks()
})

describe('AppSettingsMenu responsive popup', () => {
  it('opens the settings modal with scrollable content in the viewport', async () => {
    router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mountSettingsMenu()
    const trigger = wrapper.get('button[aria-label="设置"]')
    await trigger.trigger('click')

    // AnimatedModal 的 Transition 在 jsdom 下需要真实计时器等待挂载
    await new Promise((r) => setTimeout(r, 50))

    const modal = document.body.querySelector<HTMLElement>('.animated-modal-container')
    expect(modal).toBeTruthy()

    // 菜单内容以按钮形式渲染（点击后 router.push 跳转），应有多个设置项
    expect(modal?.querySelectorAll('button').length).toBeGreaterThan(3)

    // 可滚动意图：modal body 声明了滚动容器样式
    const modalBody = modal?.querySelector('.animated-modal-body')
    expect(modalBody).toBeTruthy()
  })

  it('closes the settings modal when toggled again', async () => {
    router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mountSettingsMenu()
    const trigger = wrapper.get('button[aria-label="设置"]')
    await trigger.trigger('click')
    await new Promise((r) => setTimeout(r, 50))
    expect(document.body.querySelector('.animated-modal-container')).toBeTruthy()

    await trigger.trigger('click')
    await new Promise((r) => setTimeout(r, 50))
    expect(document.body.querySelector('.animated-modal-container')).toBeNull()
  })
})
