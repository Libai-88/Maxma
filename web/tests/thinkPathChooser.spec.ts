import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ThinkPathChooser from '@/components/ThinkPathChooser.vue'
import { shouldOfferThinkPaths } from '@/utils/thinkPath'

describe('ThinkPathChooser', () => {
  it('is absent while the server-owned flag is disabled', () => {
    const wrapper = mount(ThinkPathChooser, {
      props: { enabled: false, text: '请分析两个迁移方案并列出风险' },
    })

    expect(wrapper.find('[aria-label="思考路径"]').exists()).toBe(false)
  })

  it('only offers choices for the transparent complex-input heuristic', () => {
    expect(shouldOfferThinkPaths('你好')).toBe(false)
    expect(shouldOfferThinkPaths('请分析两个迁移方案并列出风险')).toBe(true)
    expect(shouldOfferThinkPaths('背景\n约束\n请给出下一步')).toBe(true)
  })

  it('emits only a fixed path id and lets the user clear it', async () => {
    const wrapper = mount(ThinkPathChooser, {
      props: { enabled: true, text: '请分析两个迁移方案并列出风险' },
    })

    const options = wrapper.findAll('[role="radio"]')
    expect(options).toHaveLength(3)
    await options[2].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['deep']])

    await wrapper.setProps({ modelValue: 'deep' })
    await wrapper.get('.think-path-clear').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['deep'], [null]])
  })
})
