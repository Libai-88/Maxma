import type { AgentDependency } from '@/types/agent'

/** 依赖推导只需要这三个字段，便于测试与复用。 */
export interface DependencyTask {
  run_id: string
  parent_turn_id: string | null
  /** 毫秒时间戳。 */
  created_at: number
}

/**
 * 从真实数据推导依赖边。
 *
 * 后端不记录子任务之间的依赖关系，只记录每个任务所属的 `parent_turn_id`。
 * 可据实推导的结构是：
 *   - 同一回合内的任务是**并行**兄弟（同一轮一起派发）；
 *   - 相邻回合之间是**顺序**关系（对话回合依次发生）。
 * 于是把「上一回合的最后一个任务」作为「本回合各任务」的前驱：
 * 顺序边连到首个任务，并行边连到其余任务。没有任何虚构的节点。
 *
 * 后端列表按 created_at **倒序**返回；这里必须先按时间正序排，否则
 * 「上一回合」会变成「下一回合」，箭头整张图反向。
 */
export function buildAgentDependencies(tasks: DependencyTask[]): AgentDependency[] {
  const deps: AgentDependency[] = []
  const ordered = [...tasks].sort(
    (a, b) => a.created_at - b.created_at || a.run_id.localeCompare(b.run_id),
  )
  const turns = new Map<string, string[]>()
  for (const task of ordered) {
    const turn = task.parent_turn_id ?? '__no_turn__'
    const bucket = turns.get(turn)
    if (bucket) bucket.push(task.run_id)
    else turns.set(turn, [task.run_id])
  }

  const groups = [...turns.values()].filter(group => group.length > 0)
  for (let i = 1; i < groups.length; i += 1) {
    const prev = groups[i - 1]
    const current = groups[i]
    // 正序下 prev 的末尾就是「上一回合最后一个派发的任务」。
    const predecessor = prev[prev.length - 1]
    current.forEach((runId, idx) => {
      deps.push({
        from: predecessor,
        to: runId,
        type: idx === 0 ? 'sequential' : 'parallel',
      })
    })
  }
  return deps
}
