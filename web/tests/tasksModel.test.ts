import { describe, expect, test } from 'bun:test'

import { normalizeTasks, recentPlans } from '../src/components/workbench/tasksModel.ts'

describe('任务面板投影', () => {
  test('没有负载时不伪造任务', () => {
    expect(normalizeTasks(null)).toEqual([])
    expect(normalizeTasks({})).toEqual([])
  })

  test('subject 优先，title 兜底；缺 id 用序号，缺 status 记待办', () => {
    expect(
      normalizeTasks({
        tasks: [
          { subject: '写验收脚本', status: 'completed', id: 't1' },
          { title: '跑全量回归', status: 'in_progress' },
          { subject: '' },
          null,
        ],
      }),
    ).toEqual([
      { id: 't1', subject: '写验收脚本', status: 'completed', description: undefined },
      { id: '1', subject: '跑全量回归', status: 'in_progress', description: undefined },
    ])
  })

  test('只保留最后 3 个计划且最新在前', () => {
    const turns: Array<{ id: number; planCard?: { planId: string } }> = [1, 2, 3, 4, 5].map((id) => ({
      id,
      planCard: { planId: `p${id}` },
    }))
    expect(recentPlans(turns).map((t) => t.id)).toEqual([5, 4, 3])
    const emptyTurns: Array<{ id: number; planCard?: { planId: string } }> = [{ id: 1 }]
    expect(recentPlans(emptyTurns)).toEqual([])
  })
})
