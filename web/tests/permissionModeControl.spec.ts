import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PermissionModeControl from '@/components/PermissionModeControl.vue'

describe('PermissionModeControl', () => {
  it('does not render while the server-side policy flag is disabled', () => {
    const wrapper = mount(PermissionModeControl)

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
  })

  it('shows the confirmation-first default and the constraints of every mode', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { enabled: true, mode: 'ask' },
    })

    expect(wrapper.text()).toContain('权限：每次确认')
    await wrapper.get('.permission-trigger').trigger('click')

    expect(wrapper.text()).toContain('只读')
    expect(wrapper.text()).toContain('工作区操作')
    expect(wrapper.text()).toContain('受控自动')
    expect(wrapper.text()).toContain('不会绕过工具白名单、路径保护、MCP 限制、审批或沙盒')
    expect(wrapper.get('[role="radio"][aria-checked="true"]').text()).toContain('每次确认')
  })

  it('requires a second confirmation before increasing permission', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { enabled: true, mode: 'ask' },
    })

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.findAll('[role="radio"]').find(option => option.text().includes('工作区操作'))!.trigger('click')

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.text()).toContain('确认提高权限？')
    expect(wrapper.text()).toContain('执行、联网和破坏性操作仍会要求确认')

    await wrapper.get('.confirm-change').trigger('click')
    expect(wrapper.emitted('change')).toEqual([['operate']])
  })

  it('applies a more restrictive mode without an escalation confirmation', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { enabled: true, mode: 'operate' },
    })

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.findAll('[role="radio"]').find(option => option.text().includes('每次确认'))!.trigger('click')

    expect(wrapper.emitted('change')).toEqual([['ask']])
    expect(wrapper.text()).not.toContain('确认提高权限？')
  })
})
