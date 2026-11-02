import { describe, expect, it } from 'vitest'

import { buildAgentDependencies } from '@/utils/agentDependencies'

describe('buildAgentDependencies', () => {
  it('后端按时间倒序返回时，箭头仍然从旧回合指向新回合', () => {
    // 故意模拟 list 接口的真实顺序：新的在前。
    const deps = buildAgentDependencies([
      { run_id: 'new-1', parent_turn_id: 'turn-2', created_at: 200 },
      { run_id: 'new-2', parent_turn_id: 'turn-2', created_at: 201 },
      { run_id: 'old-1', parent_turn_id: 'turn-1', created_at: 100 },
      { run_id: 'old-2', parent_turn_id: 'turn-1', created_at: 101 },
    ])

    // 上一回合的最后一个任务（old-2）指向本回合首个任务。
    expect(deps).toContainEqual({ from: 'old-2', to: 'new-1', type: 'sequential' })
    // 同回合第二个任务是并行边。
    expect(deps).toContainEqual({ from: 'old-2', to: 'new-2', type: 'parallel' })
    // 没有任何一条边从新指向旧。
    expect(deps.some(d => d.from.startsWith('new'))).toBe(false)
  })

  it('同一回合内不造边', () => {
    const deps = buildAgentDependencies([
      { run_id: 'a', parent_turn_id: 'turn-1', created_at: 1 },
      { run_id: 'b', parent_turn_id: 'turn-1', created_at: 2 },
    ])

    expect(deps).toEqual([])
  })

  it('缺少 parent_turn_id 的任务归入同一组', () => {
    const deps = buildAgentDependencies([
      { run_id: 'a', parent_turn_id: null, created_at: 1 },
      { run_id: 'b', parent_turn_id: null, created_at: 2 },
    ])

    expect(deps).toEqual([])
  })
})
