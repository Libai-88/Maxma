import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AskUserBubble from '@/components/tools/AskUserBubble.vue'
import type { ToolCall } from '@/types'

describe('AskUserBubble TDZ regression', () => {
  it('mounts without throwing a TDZ ReferenceError when interaction is present', () => {
    const toolCall: ToolCall = {
      kind: 'tool',
      name: 'ask_user_qa',
      input: '',
      output: null,
      elapsed: null,
      status: 'running',
      interaction: {
        question: '请输入内容',
        mode: 'qa',
        options: [],
        interactionId: 'i-1',
        submitted: false,
      },
    }
    let wrapper
    let mountError: unknown = null
    try {
      wrapper = mount(AskUserBubble, { props: { toolCall } })
    } catch (e) {
      mountError = e
    }
    expect(mountError).toBe(null)
    expect(wrapper?.html() ?? '').toContain('请输入内容')
  })
})
