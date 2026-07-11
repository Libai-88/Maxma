import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ConfirmationCard from '@/components/workbench/cards/ConfirmationCard.vue'

const card = {
  id: 'a'.repeat(32),
  type: 'confirmation' as const,
  title: 'Allow change',
  content: 'Write one file.',
  createdAt: 1,
  artifact: {
    version: 1 as const,
    id: 'a'.repeat(32),
    type: 'confirmation' as const,
    title: 'Allow change',
    body: 'Write one file.',
    actions: [
      { id: 'approve', label: 'Allow', token: 'x'.repeat(32), style: 'primary' as const },
      { id: 'reject', label: 'Reject', token: 'y'.repeat(32), style: 'danger' as const },
    ],
  },
}

describe('ConfirmationCard', () => {
  it('emits only the declared signed action once', async () => {
    const wrapper = mount(ConfirmationCard, { props: { card } })

    await wrapper.get('button').trigger('click')
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('artifact-action')).toEqual([[
      { artifactId: card.id, actionId: 'approve', token: 'x'.repeat(32) },
    ]])
    expect(wrapper.text()).toContain('已提交')
  })
})
