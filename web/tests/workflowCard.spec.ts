import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listWorkflowDefinitions,
  listWorkflowRuns,
  startWorkflow,
  cancelWorkflowRun,
  resumeWorkflowRun,
} = vi.hoisted(() => ({
  listWorkflowDefinitions: vi.fn(),
  listWorkflowRuns: vi.fn(),
  startWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  resumeWorkflowRun: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { listWorkflowDefinitions, listWorkflowRuns, startWorkflow, cancelWorkflowRun, resumeWorkflowRun },
}))

import WorkflowCard from '@/components/WorkflowCard.vue'

const runningRun = {
  run_id: 'workflow-run-1',
  parent_turn_id: 'turn-1',
  workflow_id: 'session-review',
  workflow_version: 1,
  status: 'running' as const,
  current_step_id: 'capture-session-context',
  failure_code: null,
  cancel_reason: null,
  created_at: 1,
  updated_at: 1,
}

describe('WorkflowCard', () => {
  beforeEach(() => {
    listWorkflowDefinitions.mockReset()
    listWorkflowRuns.mockReset()
    startWorkflow.mockReset()
    cancelWorkflowRun.mockReset()
    resumeWorkflowRun.mockReset()
  })

  it('stays hidden when workflows are disabled by the server', async () => {
    listWorkflowDefinitions.mockRejectedValue(new Error('API /workflows/definitions 返回 404: Workflows are unavailable'))
    listWorkflowRuns.mockResolvedValue({ runs: [] })

    const wrapper = mount(WorkflowCard, { props: { sessionId: 'parent-1' } })

    await vi.waitFor(() => expect(listWorkflowDefinitions).toHaveBeenCalled())
    expect(wrapper.find('[aria-label="工作流"]').exists()).toBe(false)
  })

  it('loads server-safe status only after a registered workflow surface is available', async () => {
    listWorkflowDefinitions.mockResolvedValue({ workflow_ids: ['session-review'] })
    listWorkflowRuns.mockResolvedValue({ runs: [runningRun] })

    const wrapper = mount(WorkflowCard, { props: { sessionId: 'parent-1' } })
    await vi.waitFor(() => expect(wrapper.find('[aria-label="工作流"]').exists()).toBe(true))

    expect(wrapper.text()).toContain('工作流')
    expect(wrapper.text()).not.toContain('turn-1')
    expect(wrapper.text()).not.toContain('handler')

    await wrapper.get('.workflow-header').trigger('click')
    expect(wrapper.text()).toContain('会话检查')
    expect(wrapper.text()).toContain('执行中')
    expect(wrapper.text()).toContain('当前步骤：capture-session-context')
  })

  it('starts only a registered ID and cancels only an active parent-scoped run', async () => {
    listWorkflowDefinitions.mockResolvedValue({ workflow_ids: ['session-review'] })
    listWorkflowRuns.mockResolvedValue({ runs: [runningRun] })
    startWorkflow.mockResolvedValue({ ...runningRun, run_id: 'workflow-run-2', status: 'queued' })
    cancelWorkflowRun.mockResolvedValue({ ...runningRun, status: 'cancelled', cancel_reason: 'cancelled_by_user' })

    const wrapper = mount(WorkflowCard, { props: { sessionId: 'parent-1' } })
    await vi.waitFor(() => expect(wrapper.find('[aria-label="工作流"]').exists()).toBe(true))
    await wrapper.get('.workflow-header').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.start-workflow').exists()).toBe(true))

    await wrapper.get('.run-action').trigger('click')
    await vi.waitFor(() => expect(cancelWorkflowRun).toHaveBeenCalledWith('parent-1', 'workflow-run-1'))
    expect(wrapper.text()).toContain('已取消')

    await wrapper.get('.start-workflow').trigger('click')
    await vi.waitFor(() => expect(startWorkflow).toHaveBeenCalledWith('parent-1', 'session-review'))
  })

  it('offers recovery only for failed runs and updates its safe status projection', async () => {
    const failedRun = { ...runningRun, status: 'failed' as const, current_step_id: null }
    listWorkflowDefinitions.mockResolvedValue({ workflow_ids: ['session-review'] })
    listWorkflowRuns.mockResolvedValue({ runs: [failedRun] })
    resumeWorkflowRun.mockResolvedValue({ ...failedRun, status: 'queued' })

    const wrapper = mount(WorkflowCard, { props: { sessionId: 'parent-1' } })
    await vi.waitFor(() => expect(wrapper.find('[aria-label="工作流"]').exists()).toBe(true))
    await wrapper.get('.workflow-header').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('恢复'))
    await wrapper.get('.run-action').trigger('click')

    await vi.waitFor(() => expect(resumeWorkflowRun).toHaveBeenCalledWith('parent-1', 'workflow-run-1'))
    expect(wrapper.text()).toContain('等待执行')
  })
})
