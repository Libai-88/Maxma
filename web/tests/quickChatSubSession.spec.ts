// QUICKCHAT-SUB-001 回归测试：sub_session_created 后 session store 的
// sessionId 变化，QuickChat 必须跟随切换视图（此前视图停留在父会话）
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'

// 捕获 useChat 收到的 sessionId ref，用于断言组件是否跟随 store 切换
let capturedSessionIdRef: Ref<string> | null = null

const mocks = vi.hoisted(() => ({
  initIfNeeded: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('@/composables/useChat', () => ({
  useChat: (sessionIdRef: Ref<string>) => {
    capturedSessionIdRef = sessionIdRef
    return {
      turns: ref([]),
      currentTurn: ref(null),
      isStreaming: ref(false),
      send: vi.fn(),
      cancel: vi.fn(),
    }
  },
}))

// 响应式 session store：sessionId 可变，模拟 sub_session_created 的 switchSession
// （reactive 包装，组件 watch(() => store.sessionId) 能感知变化）
import { reactive } from 'vue'
const sessionStoreMock = reactive({
  sessionId: 'parent-session',
  sessions: [{ session_id: 'parent-session', message_count: 0 }],
  initIfNeeded: mocks.initIfNeeded,
  createSession: mocks.createSession,
})
vi.mock('@/stores/session', () => ({
  useSessionStore: () => sessionStoreMock,
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

describe('QuickChat 子会话视图同步 (QUICKCHAT-SUB-001)', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStoreMock.sessionId = 'parent-session'
    capturedSessionIdRef = null
    mocks.initIfNeeded.mockResolvedValue(true)
  })

  it('sub_session_created 切换 store.sessionId 后视图跟随到子会话', async () => {
    const wrapper = mount(QuickChatApp, { attachTo: document.body })
    // 挂载后 useChat 应已收到 ref
    expect(capturedSessionIdRef).not.toBeNull()
    // 等待 onMounted 的 async 初始化链完成（避免其覆盖后续修改）
    await new Promise((r) => setTimeout(r, 30))
    expect(capturedSessionIdRef!.value).toBe('parent-session')

    // 模拟 useChat 内部 switchSession(subId) 更新 store
    sessionStoreMock.sessionId = 'sub-session-123'
    await new Promise((r) => setTimeout(r, 30))

    expect(capturedSessionIdRef!.value).toBe('sub-session-123')
    wrapper.unmount()
  })

  it('子会话 done 后 store 切回父会话，视图跟随', async () => {
    const wrapper = mount(QuickChatApp, { attachTo: document.body })
    await new Promise((r) => setTimeout(r, 30))
    sessionStoreMock.sessionId = 'sub-session-123'
    await new Promise((r) => setTimeout(r, 30))
    expect(capturedSessionIdRef!.value).toBe('sub-session-123')

    // 子会话完成自动切回父会话
    sessionStoreMock.sessionId = 'parent-session'
    await new Promise((r) => setTimeout(r, 30))
    expect(capturedSessionIdRef!.value).toBe('parent-session')
    wrapper.unmount()
  })
})
