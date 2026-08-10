import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ToolBubbleRouter from '@/components/ToolBubbleRouter.vue'
import type { ToolCall } from '@/types'

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    kind: 'tool',
    name: 'unregistered_tool',
    input: '{}',
    output: '完成',
    elapsed: 1.2,
    status: 'done',
    ...overrides,
  }
}

describe('tool result presentation', () => {
  it('keeps the legacy full result visible while compact presentation is disabled', () => {
    const hiddenTail = 'SEARCHABLE_FULL_RESULT_TAIL'
    const wrapper = mount(ToolBubbleRouter, {
      props: {
        toolCall: toolCall({ output: `${'a'.repeat(2_000)}${hiddenTail}` }),
      },
    })

    expect(wrapper.find('.tool-card').exists()).toBe(true)
    expect(wrapper.text()).toContain(hiddenTail)
  })

  it('uses an amber, safe error summary with a diagnostic path', () => {
    const wrapper = mount(ToolBubbleRouter, {
      props: {
        toolCall: toolCall({
          status: 'error',
          output: 'authorization=top-secret-token failed',
        }),
      },
    })

    expect(wrapper.find('.error-card--warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('该工具没有完成操作')
    expect(wrapper.text()).toContain('复制诊断')
    expect(wrapper.text()).not.toContain('top-secret-token')
    expect(wrapper.text()).not.toContain('关闭')
  })

  it('ERROR-EMPTY-001: error 且 output 为空时显示错误卡片而非空气泡', () => {
    const wrapper = mount(ToolBubbleRouter, {
      props: {
        toolCall: toolCall({
          name: 'python',
          status: 'error',
          output: null,
          input: 'print(1)',
        }),
      },
    })

    // 已注册专用气泡（python）的 error 状态也必须走 ErrorCard（ERROR-BYPASS-001）
    expect(wrapper.find('.error-card--warning').exists()).toBe(true)
    expect(wrapper.find('.tool-bubble').exists()).toBe(false)
    expect(wrapper.text()).toContain('该工具没有完成操作')
    // 不是空卡片：有可见文案
    expect(wrapper.text().trim().length).toBeGreaterThan(10)
  })

  it('ERROR-EMPTY-001: error 且 output 为空字符串时同样有错误提示', () => {
    const wrapper = mount(ToolBubbleRouter, {
      props: {
        toolCall: toolCall({
          status: 'error',
          output: '',
        }),
      },
    })

    expect(wrapper.find('.error-card--warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('工具')
    expect(wrapper.text().trim().length).toBeGreaterThan(10)
  })
})
