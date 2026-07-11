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
})
