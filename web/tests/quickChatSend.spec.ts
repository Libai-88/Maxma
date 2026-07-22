import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  cancel: vi.fn(),
  initIfNeeded: vi.fn(),
  createSession: vi.fn(),
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
    sessions: [],
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

describe('Quick Chat sending', () => {
  beforeEach(() => {
    mocks.send.mockReset()
    mocks.cancel.mockReset()
    mocks.initIfNeeded.mockReset().mockResolvedValue(undefined)
    mocks.createSession.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the draft and shows an error when WebSocket send fails', async () => {
    mocks.send.mockReturnValue(false)
    const wrapper = mount(QuickChatApp)
    const textarea = wrapper.get('textarea')

    await textarea.setValue('  keep this draft  ')
    await textarea.trigger('keydown.enter')

    expect(mocks.send).toHaveBeenCalledWith('keep this draft', [])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('  keep this draft  ')
    expect(wrapper.get('.qc-error-bar').text()).toContain('消息发送失败')
    wrapper.unmount()
  })

  it('clears the draft only after WebSocket send succeeds', async () => {
    mocks.send.mockReturnValue(true)
    const wrapper = mount(QuickChatApp)
    const textarea = wrapper.get('textarea')

    await textarea.setValue('send this')
    await textarea.trigger('keydown.enter')

    expect(mocks.send).toHaveBeenCalledWith('send this', [])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.find('.qc-error-bar').exists()).toBe(false)
    wrapper.unmount()
  })
})
