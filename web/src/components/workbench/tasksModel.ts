/**
 * tasksModel — 任务面板的纯投影（P2）。
 *
 * 输入只有引擎已经发出的 task_tracker 负载；不改状态、不推断执行结果。
 */

export interface NormalizedTask {
  id: string
  subject: string
  status: string
  description?: string
}

export function normalizeTasks(data: Record<string, unknown> | null): NormalizedTask[] {
  if (!data) return []
  const raw = Array.isArray(data.tasks) ? data.tasks : null
  if (!raw) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const subject =
      typeof record.subject === 'string' ? record.subject : typeof record.title === 'string' ? record.title : ''
    if (!subject) return []
    return [
      {
        id: typeof record.id === 'string' ? record.id : String(index),
        subject,
        status: typeof record.status === 'string' ? record.status : 'pending',
        description: typeof record.description === 'string' ? record.description : undefined,
      },
    ]
  })
}

/** 最近计划：只取最后一屏能读懂的 3 个，最新的在前。 */
export function recentPlans<T extends { planCard?: unknown }>(turns: T[], limit = 3): T[] {
  return turns.filter((turn) => Boolean(turn.planCard)).slice(-limit).reverse()
}
