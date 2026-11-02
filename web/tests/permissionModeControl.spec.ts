import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { PermissionMode } from '@/types'
import PermissionModeControl from '@/components/PermissionModeControl.vue'

// 选项按钮靠组件里的 `data-mode` 测试锚点定位，不用 `text().includes()`：
// 档位描述会提到别的档位名（`ask` 的文案要说清它和 `read_only` 判定相同），
// 全文匹配会命中多个选项，用例就点错了档。
const radio = (mode: string) => `[role="radio"][data-mode="${mode}"]`

describe('PermissionModeControl', () => {
  it('renders every mode when the caller gives no availability list', () => {
    const wrapper = mount(PermissionModeControl, { props: { mode: 'ask' } })

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(true)
  })

  it('renders nothing when the server reports no usable modes', () => {
    const wrapper = mount(PermissionModeControl, { props: { mode: 'ask', availableModes: [] } })

    expect(wrapper.find('[aria-label="会话权限模式"]').exists()).toBe(false)
  })

  it('shows the confirmation-first default and the constraints of every mode', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { mode: 'ask' },
    })

    expect(wrapper.text()).toContain('权限：每次确认')
    await wrapper.get('.permission-trigger').trigger('click')

    for (const mode of ['read_only', 'ask', 'operate', 'auto'] as PermissionMode[]) {
      expect(wrapper.find(radio(mode)).exists(), `档位 ${mode} 没有渲染成选项`).toBe(true)
    }
    // 断言按源码行切片段：模板里那句跨了两行，Vue 渲染会把换行折叠成一个空格，
    // 整句断言会因那个空格而假失败。
    expect(wrapper.text()).toContain('不会绕过拒止锚（MaxmaBlocker）')
    expect(wrapper.text()).toContain('MCP stdio 命令白名单或 Provider URL 校验')
    // 不存在的机制不许再出现在文案里（路径白名单层已随 Python 删除；无沙盒）。
    expect(wrapper.text()).not.toContain('路径保护')
    expect(wrapper.text()).not.toContain('沙盒')
    expect(wrapper.get('[role="radio"][aria-checked="true"]').text()).toContain('每次确认')
  })

  it('auto 档文案说实话：不再弹任何确认（auto 下审批门根本不装配）', async () => {
    const wrapper = mount(PermissionModeControl, { props: { mode: 'ask' } })
    await wrapper.get('.permission-trigger').trigger('click')

    const autoText = wrapper.get(radio('auto')).text()
    expect(autoText).toContain('不再弹确认')
    // 旧文案承诺过一层不存在的保护（"仅明确允许的本地工具可自动运行，其余仍需确认"），
    // 用户会以为选了 auto 之后 bash/联网还会问一次——实际 needsApprovalForMode 直接 false。
    expect(autoText).not.toContain('仍需确认')
    expect(autoText).not.toContain('服务器白名单')
  })

  it('renders only the modes the server lists, in the server order', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: {
        mode: 'ask',
        availableModes: ['ask', 'read_only'] as PermissionMode[],
      },
    })

    await wrapper.get('.permission-trigger').trigger('click')

    // 顺序由服务端清单决定，不是文案表顺序（清单顺序 = 限制由强到弱的产品语义）。
    expect(wrapper.findAll('[role="radio"]').map(option => option.attributes('data-mode'))).toEqual([
      'ask',
      'read_only',
    ])
  })

  it('requires a second confirmation before increasing permission', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { mode: 'ask' },
    })

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('operate')).trigger('click')

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.text()).toContain('确认提高权限？')
    expect(wrapper.text()).toContain('本地写入将不再逐次确认；执行与破坏性操作仍会要求确认')

    await wrapper.get('.confirm-change').trigger('click')
    expect(wrapper.emitted('change')).toEqual([['operate']])
  })

  it('applies a more restrictive mode without an escalation confirmation', async () => {
    const wrapper = mount(PermissionModeControl, {
      props: { mode: 'operate' },
    })

    await wrapper.get('.permission-trigger').trigger('click')
    await wrapper.get(radio('ask')).trigger('click')

    expect(wrapper.emitted('change')).toEqual([['ask']])
    expect(wrapper.text()).not.toContain('确认提高权限？')
  })
})
