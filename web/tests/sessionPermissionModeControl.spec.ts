import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionPermissionMode, setSessionPermissionMode } = vi.hoisted(() => ({
  getSessionPermissionMode: vi.fn(),
  setSessionPermissionMode: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { getSessionPermissionMode, setSessionPermissionMode },
}))

import SessionPermissionModeControl from '@/components/SessionPermissionModeControl.vue'

const enabledResponse = {
  session_id: 'session-a',
  permission_modes_enabled: true,
  permission_mode: 'ask' as const,
  permission_mode_updated_at: 1,
  available_permission_modes: ['read_only', 'ask', 'operate', 'auto'] as const,
}

describe('SessionPermissionModeControl', () => {
  beforeEach(() => {
    getSessionPermissionMode.mockReset()
    setSessionPermissionMode.mockReset()
  })

  it('remains invisible when the server-side feature flag is disabled', async () => {
    getSessionPermissionMode.mockResolvedValue({
      ...enabledResponse,
      permission_modes_enabled: false,
      available_permission_modes: [],
    })

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-a'))

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
    expect(wrapper.find('.permission-mode-error').exists()).toBe(false)
  })

  it('loads the active session mode and persists a confirmed change', async () => {
    getSessionPermissionMode.mockResolvedValue(enabledResponse)
    setSessionPermissionMode.mockResolvedValue({
      ...enabledResponse,
      permission_mode: 'operate',
      permission_mode_updated_at: 2,
    })

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.findAll('[role="radio"]').find(option => option.text().includes('工作区操作'))!.trigger('click')
    await wrapper.get('.confirm-change').trigger('click')

    await vi.waitFor(() => expect(setSessionPermissionMode).toHaveBeenCalledWith('session-a', 'operate'))
    expect(wrapper.text()).toContain('权限：工作区操作')
  })

  it('reloads the mode when the active session changes', async () => {
    getSessionPermissionMode.mockImplementation((sessionId: string) => Promise.resolve({
      ...enabledResponse,
      session_id: sessionId,
      permission_mode: sessionId === 'session-b' ? 'read_only' : 'ask',
    }))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：每次确认'))

    await wrapper.setProps({ sessionId: 'session-b' })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-b'))
    expect(wrapper.text()).toContain('权限：只读')
  })

  it('hides the control and explains a server-side 409 after a mode change', async () => {
    getSessionPermissionMode.mockResolvedValue(enabledResponse)
    setSessionPermissionMode.mockRejectedValue(new Error('API /sessions/session-a/permission-mode 返回 409'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.findAll('[role="radio"]').find(option => option.text().includes('只读'))!.trigger('click')

    await vi.waitFor(() => expect(setSessionPermissionMode).toHaveBeenCalledWith('session-a', 'read_only'))
    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
    expect(wrapper.get('.permission-mode-error').text()).toContain('权限模式当前不可用')
  })
})
