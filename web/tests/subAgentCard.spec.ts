import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDeferredRun, cancelDeferredRun } = vi.hoisted(() => ({
  getDeferredRun: vi.fn(),
  cancelDeferredRun: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { getDeferredRun, cancelDeferredRun },
}))

import SubAgentCard from '@/components/SubAgentCard.vue'

const runningRun = {
  run_id: 'run-1',
  parent_turn_id: 'turn-1',
  status: 'running' as const,
  result_ref: null,
  result: null,
  cancel_reason: null,
  deadline_at: null,
  attempts: 1,
  created_at: 1,
  updated_at: 1,
}

describe('SubAgentCard', () => {
  beforeEach(() => {
    getDeferredRun.mockReset()
    cancelDeferredRun.mockReset()
  })

  it('does not load a run until the card is expanded', () => {
    const wrapper = mount(SubAgentCard, {
      props: { sessionId: 'parent-1', runIds: ['run-1'] },
    })

    expect(wrapper.text()).toContain('后台子任务')
    expect(getDeferredRun).not.toHaveBeenCalled()
  })

  it('loads the safe result projection on expand without rendering task metadata', async () => {
    getDeferredRun.mockResolvedValue({
      ...runningRun,
      status: 'succeeded',
      result_ref: 'deferred:run-1',
      result: '可见结果',
    })
    const wrapper = mount(SubAgentCard, {
      props: { sessionId: 'parent-1', runIds: ['run-1'] },
    })

    await wrapper.get('.sub-agent-header').trigger('click')
    await vi.waitFor(() => expect(getDeferredRun).toHaveBeenCalledWith('parent-1', 'run-1'))

    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).toContain('可见结果')
    expect(wrapper.text()).not.toContain('delegated task')
    expect(wrapper.text()).not.toContain('provider')
  })

  it('cancels only an active, expanded run and updates its rendered status', async () => {
    getDeferredRun.mockResolvedValue(runningRun)
    cancelDeferredRun.mockResolvedValue({
      ...runningRun,
      status: 'cancelled',
      cancel_reason: 'cancelled_by_user',
    })
    const wrapper = mount(SubAgentCard, {
      props: { sessionId: 'parent-1', runIds: ['run-1'] },
    })

    await wrapper.get('.sub-agent-header').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.cancel-run').exists()).toBe(true))
    await wrapper.get('.cancel-run').trigger('click')
    await vi.waitFor(() => expect(cancelDeferredRun).toHaveBeenCalledWith('parent-1', 'run-1'))

    expect(wrapper.text()).toContain('已取消')
    expect(wrapper.text()).toContain('任务已取消')
  })
})
