import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getSessionPermissionMode, setSessionPermissionMode } = vi.hoisted(() => ({
  getSessionPermissionMode: vi.fn(),
  setSessionPermissionMode: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { getSessionPermissionMode, setSessionPermissionMode },
}))

import SessionPermissionModeControl from '@/components/SessionPermissionModeControl.vue'
import { useChatStore } from '@/stores/chat'
import type { PermissionMode } from '@/types'

/**
 * 后端 `permissionModeView()` 的真实形状（bun-backend/src/routes/sessions.ts）。
 * 字段名由 bun-backend/tests/permission-mode-contract.test.ts 与
 * web/src/types/session.ts 对账；这里只放真字段——以前这份 fixture 里有
 * `permission_modes_enabled`，后端从不产出它，于是控件恒禁用而测试照样绿
 * （fixture 替后端说了谎）。
 */
const ALL_MODES = ['read_only', 'ask', 'operate', 'auto'] as const

function response(mode: (typeof ALL_MODES)[number] = 'ask', availableModes: readonly string[] = ALL_MODES) {
  return {
    session_id: 'session-a',
    permission_mode: mode,
    available_permission_modes: [...availableModes],
  }
}

// 选项按钮靠组件里的 `data-mode` 测试锚点定位，不用 `text().includes()`：
// 档位描述会提到别的档位名（`ask` 的文案要说清它和 `read_only` 判定相同），
// 全文匹配会命中多个选项，用例就点错了档。
const radio = (mode: string) => `[role="radio"][data-mode="${mode}"]`

/**
 * 模拟"内核广播已落地"的通道状态。`useChat.ts` 的 permission_mode_updated 分支写的
 * 就是这两个字段（事件→状态那段由 wsEventSink.spec.ts 锁），本组用例锁的是
 * 状态→渲染这一段：选择器必须跟着通道真值走，而不是留在自己那次 GET 的快照上。
 */
function announce(sessionId: string, mode: PermissionMode) {
  const ch = useChatStore().getOrCreateChannel(sessionId)
  ch.permissionMode = mode
  ch.autoApprove = mode === 'auto'
  return ch
}

describe('SessionPermissionModeControl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getSessionPermissionMode.mockReset()
    setSessionPermissionMode.mockReset()
  })

  it('服务端清单为空时不渲染控件（不摆一个拨不动的开关）', async () => {
    getSessionPermissionMode.mockResolvedValue(response('ask', []))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-a'))

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
    expect(wrapper.find('.permission-mode-error').exists()).toBe(false)
  })

  it('GET 成功后控件可交互，且切换真的打到 API', async () => {
    // 这条就是原 bug 的回归锁：后端回 200 + 清单非空，用户点选后必须看到
    // setSessionPermissionMode 被调用。旧实现读 response.permission_modes_enabled
    // （undefined）→ updateMode() 第一行直接 return，一次 API 都不发。
    getSessionPermissionMode.mockResolvedValue(response())
    setSessionPermissionMode.mockResolvedValue(response('operate'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('operate')).trigger('click')
    await wrapper.get('.confirm-change').trigger('click')

    await vi.waitFor(() => expect(setSessionPermissionMode).toHaveBeenCalledTimes(1))
    expect(setSessionPermissionMode).toHaveBeenCalledWith('session-a', 'operate')
    expect(wrapper.text()).toContain('权限：工作区操作')
    expect(wrapper.find('.permission-mode-error').exists()).toBe(false)
  })

  it('选项来自服务端清单，不是前端硬编码的四档', async () => {
    getSessionPermissionMode.mockResolvedValue(response('ask', ['read_only', 'ask']))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    // 只渲染服务端给的两档，且顺序照服务端清单（不是文案表顺序）。
    expect(wrapper.findAll('[role="radio"]').map(option => option.attributes('data-mode'))).toEqual([
      'read_only',
      'ask',
    ])
  })

  it('切换走 REST PUT，不再补发 update_auto_approve（补发会把档位改写掉）', async () => {
    getSessionPermissionMode.mockResolvedValue(response())
    setSessionPermissionMode.mockResolvedValue(response('read_only'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('read_only')).trigger('click')

    await vi.waitFor(() => expect(setSessionPermissionMode).toHaveBeenCalledWith('session-a', 'read_only'))
    // 收紧不需要二次确认；PUT 成功后 UI 必须显示服务端回读的档位，
    // 而不是被本地另一条链路（update_auto_approve → set_auto_approve）改写成 ask。
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：只读'))
    expect(wrapper.text()).not.toContain('权限：每次确认')
  })

  it('PUT 失败给出可见错误，并保持原档位', async () => {
    getSessionPermissionMode.mockResolvedValue(response())
    setSessionPermissionMode.mockRejectedValue(new Error('API /sessions/session-a/permission-mode 返回 422'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('operate')).trigger('click')
    await wrapper.get('.confirm-change').trigger('click')

    await vi.waitFor(() => expect(wrapper.get('.permission-mode-error').text()).toContain('无法更新会话权限'))
    expect(wrapper.text()).toContain('权限：每次确认')
    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(true)
  })

  it('切换会话时重新载入档位', async () => {
    getSessionPermissionMode.mockImplementation((sessionId: string) => Promise.resolve(
      sessionId === 'session-b' ? response('read_only') : response('ask'),
    ))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：每次确认'))

    await wrapper.setProps({ sessionId: 'session-b' })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-b'))
    expect(wrapper.text()).toContain('权限：只读')
  })

  it('GET 失败时不新增 UI 面（保持隐藏，不留下半个开关）', async () => {
    getSessionPermissionMode.mockRejectedValue(new Error('API /sessions/session-a/permission-mode 返回 500'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-a'))

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
    expect(wrapper.find('.permission-mode-error').exists()).toBe(false)
  })

  // ── PERM-ANNOUNCE-001：档位真值由内核广播，选择器跟着收敛 ──────────────
  // 原缺陷：`record.permissionMode` 有两个写入方——REST PUT 走 set_permission_mode
  // （四档），WS「自动执行」开关走 set_auto_approve（两态，直接把档位覆盖成
  // auto / ask）。控件只信自己那次 GET，也不 watch 任何变化，于是拨完开关后
  // 它显示的是内核并不在的档位（选 operate → 拨开关 → 内核在 auto，UI 仍写 operate）。
  // 现在内核每次写入都广播 permission_mode_updated，useChat 把真值写进通道状态
  // （事件→状态那一段由 web/tests/wsEventSink.spec.ts 锁），控件从这里收敛。

  it('通道状态收到新档位后，选择器跟着改显示（不重发 GET）', async () => {
    getSessionPermissionMode.mockResolvedValue(response('ask'))
    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：每次确认'))
    expect(getSessionPermissionMode).toHaveBeenCalledTimes(1)

    // 「自动执行」开关那次 set_auto_approve 落进内核后的广播值
    announce('session-a', 'operate')

    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：工作区操作'))
    expect(wrapper.text()).not.toContain('权限：每次确认')
    // 收敛靠事件，不靠本地补一次 GET：GET 只发过一次
    expect(getSessionPermissionMode).toHaveBeenCalledTimes(1)
  })

  it('首屏之后的迟到 GET 不许把选择器带回旧档', async () => {
    getSessionPermissionMode.mockResolvedValue(response('ask'))
    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：每次确认'))

    announce('session-a', 'auto')
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：受控自动'))

    // 切走再切回同一会话会重发 GET；服务端那份快照比广播旧时也不许覆盖真值
    await wrapper.setProps({ sessionId: 'session-b' })
    await wrapper.setProps({ sessionId: 'session-a' })
    await vi.waitFor(() => expect(getSessionPermissionMode).toHaveBeenCalledWith('session-a'))
    expect(wrapper.text()).toContain('权限：受控自动')
    expect(wrapper.text()).not.toContain('权限：每次确认')
  })

  it('PUT 成功后仍以内核广播的档位为准（另一标签页可能同时改档）', async () => {
    getSessionPermissionMode.mockResolvedValue(response('ask'))
    setSessionPermissionMode.mockResolvedValue(response('operate'))

    const wrapper = mount(SessionPermissionModeControl, { props: { sessionId: 'session-a' } })
    await vi.waitFor(() => expect(wrapper.find('.permission-trigger').exists()).toBe(true))

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('operate')).trigger('click')
    await wrapper.get('.confirm-change').trigger('click')
    await vi.waitFor(() => expect(setSessionPermissionMode).toHaveBeenCalledWith('session-a', 'operate'))

    // 另一个标签页把档位改成了 read_only，本端的 PUT 响应是过期的
    announce('session-a', 'read_only')
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限：只读'))
  })
})
