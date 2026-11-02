// QUICKCHAT-CLOSE-001 回归测试
//
// 缺陷：QuickChat 的 ✕ 按钮调用 `await import('@tauri-apps/api/core')` +
// `invoke('toggle_quick_chat')`，外面套一层空 catch。Tauri 壳已随阶段 2 删除，
// 两种已发布形态（Web 便携包 / Electron 单窗口壳，无 preload·IPC 桥）都永远
// 走不到那个模块 —— 按钮点了什么也不发生，却写得像能用。
//
// 现在的行为：`window.close()`（页面被脚本打开时真关窗口），随后无条件进入
// 「已收起」状态：关成功时文档已销毁、无副作用；关不掉时（浏览器安全规则 /
// Electron 沙箱渲染进程不覆写 close）用户看到确定反馈，并可一键返回。
//
// 断言分两层：行为层（点击确实改变了界面状态）+ 源码层（Tauri 依赖不得复活，
// 剥注释后再断言，防止只在注释里提一句就骗过测试 —— 对齐 tests/agentTasksGating.spec.ts）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  cancel: vi.fn(),
  initIfNeeded: vi.fn(),
  createSession: vi.fn(),
  // jsdom 的 window.close() 会真的销毁窗口，必须换成可断言的替身
  close: vi.fn(),
}))

vi.mock('@/composables/useChat', async () => {
  const { ref } = await import('vue')
  return {
    useChat: () => ({
      turns: ref([]),
      currentTurn: ref(null),
      isStreaming: ref(false),
      send: mocks.send,
      cancel: mocks.cancel,
    }),
  }
})

vi.mock('@/stores/session', () => ({
  useSessionStore: () => ({
    sessions: [{ session_id: 'session-1', message_count: 0 }],
    sessionId: 'session-1',
    initIfNeeded: mocks.initIfNeeded,
    createSession: mocks.createSession,
  }),
}))

vi.mock('pinia', async () => {
  const { ref } = await import('vue')
  return {
    storeToRefs: (store: { sessions: unknown }) => ({ sessions: ref(store.sessions) }),
  }
})

vi.mock('@/components/RenderMarkdown.vue', () => ({
  default: { template: '<div />' },
}))

import QuickChatApp from '@/quick-chat/QuickChatApp.vue'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SOURCE = stripComments(
  readFileSync(join(__dirname, '../src/quick-chat/QuickChatApp.vue'), 'utf8'),
)

describe('QuickChat 关闭按钮 (QUICKCHAT-CLOSE-001)', () => {
  const originalClose = Object.getOwnPropertyDescriptor(window, 'close')

  beforeEach(() => {
    vi.resetModules()
    mocks.initIfNeeded.mockReset().mockResolvedValue(true)
    mocks.createSession.mockReset().mockResolvedValue(undefined)
    mocks.send.mockReset()
    mocks.cancel.mockReset()
    mocks.close.mockReset()
    Object.defineProperty(window, 'close', {
      value: mocks.close,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalClose) Object.defineProperty(window, 'close', originalClose)
  })

  it('点击 ✕ 关闭顶层窗口，并进入「已收起」状态', async () => {
    const wrapper = mount(QuickChatApp)
    // 初始：对话界面在、收起面板不在
    expect(wrapper.find('.qc-messages').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('.qc-dismissed').exists()).toBe(false)

    await wrapper.get('.qc-close').trigger('click')

    expect(mocks.close).toHaveBeenCalledTimes(1)
    // 可观察的状态变化：对话界面整体换成收起提示，✕ 自身也消失
    expect(wrapper.find('.qc-dismissed').exists()).toBe(true)
    expect(wrapper.find('.qc-messages').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.qc-close').exists()).toBe(false)
    wrapper.unmount()
  })

  it('窗口关不掉时收起面板给出重新打开路径，并可返回对话', async () => {
    const wrapper = mount(QuickChatApp)
    await wrapper.get('.qc-close').trigger('click')

    const panel = wrapper.get('.qc-dismissed')
    expect(panel.attributes('role')).toBe('status')
    expect(panel.text()).toContain('已收起')
    expect(panel.text()).toContain('/quick-chat.html')

    await wrapper.get('.qc-restore').trigger('click')
    expect(wrapper.find('.qc-dismissed').exists()).toBe(false)
    expect(wrapper.find('.qc-messages').exists()).toBe(true)
    expect(wrapper.find('.qc-close').exists()).toBe(true)
    wrapper.unmount()
  })

  it('QuickChatApp.vue 不再依赖任何 @tauri-apps 模块', () => {
    expect(SOURCE).not.toMatch(/@tauri-apps/)
    expect(SOURCE).not.toMatch(/toggle_quick_chat/)
    // 关闭动作必须落在真实 API 上，而不是空 catch
    expect(SOURCE).toMatch(/window\.close\(\)/)
  })
})
