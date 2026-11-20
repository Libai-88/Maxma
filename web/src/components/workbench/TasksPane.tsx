/**
 * TasksPane — 任务/计划面板（P2）。
 *
 * 不新增第二套任务状态：目标来自 goal_updated，任务来自 task_tracker 工具负载，
 * 计划来自 ChatTurn.planCard。这里只做投影与展示，不修改执行引擎状态。
 */

import { CheckCircle2, Circle, CircleDashed, ListTodo, Target, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { WorkbenchPaneProps } from './paneProps'
import { normalizeTasks, recentPlans } from './tasksModel'

function statusIcon(status: string) {
  if (status === 'completed' || status === 'done') return <CheckCircle2 className="size-3.5 shrink-0" />
  if (status === 'in_progress' || status === 'running') return <CircleDashed className="size-3.5 shrink-0 animate-pulse" />
  if (status === 'deleted' || status === 'failed' || status === 'cancelled') return <XCircle className="size-3.5 shrink-0" />
  return <Circle className="size-3.5 shrink-0" />
}

function statusText(status: string) {
  if (status === 'completed' || status === 'done') return '完成'
  if (status === 'in_progress' || status === 'running') return '进行中'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'deleted') return '已删除'
  return '待办'
}

export function TasksPane({
  allTurns: turns,
  goalState,
  taskTrackerData,
}: WorkbenchPaneProps) {
  const tasks = normalizeTasks(taskTrackerData)
  const plans = recentPlans(turns).flatMap((turn) => turn.planCard ? [{ turn, plan: turn.planCard }] : [])
  const empty = !goalState?.goal && tasks.length === 0 && plans.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {empty && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <ListTodo className="size-7 text-muted-foreground" />
          <p className="text-caption text-foreground">还没有任务或计划</p>
          <p className="text-micro text-muted-foreground">用 /goal 设置目标，或让 Agent 在执行中建立任务清单；这里会实时同步。</p>
        </div>
      )}

      {goalState?.goal && (
        <section className="rounded-lg border border-border bg-card/40 p-2.5">
          <div className="flex items-center gap-1.5 text-caption font-medium"><Target className="size-3.5" />目标</div>
          <p className="mt-1.5 text-caption text-foreground">{goalState.goal.objective}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
            <span className={cn(
              'rounded px-1 py-0.5',
              goalState.goal.status === 'active' && 'bg-primary/10 text-foreground',
              goalState.goal.status === 'complete' && 'bg-accent text-foreground',
            )}>
              {goalState.goal.status === 'active' ? '进行中' : goalState.goal.status === 'complete' ? '已完成' : goalState.goal.status}
            </span>
            <span>已用 {goalState.goal.tokensUsed ?? 0} tokens</span>
            {goalState.goal.tokenBudget ? <span>/ {goalState.goal.tokenBudget}</span> : null}
          </p>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="flex min-h-0 flex-col gap-1">
          <h3 className="px-1 text-caption font-medium text-muted-foreground">任务（{tasks.length}）</h3>
          <div className="overflow-y-auto scrollbar-thin rounded-lg border border-border bg-card/40">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-2 border-b border-border/60 px-2 py-1.5 last:border-b-0">
                <span className={cn('mt-0.5', task.status === 'completed' && 'text-primary', task.status === 'failed' && 'text-destructive', task.status !== 'completed' && task.status !== 'failed' && 'text-muted-foreground')}>
                  {statusIcon(task.status)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-caption text-foreground">{task.subject}</p>
                  {task.description && <p className="text-micro text-muted-foreground">{task.description}</p>}
                </div>
                <span className="shrink-0 text-micro text-muted-foreground">{statusText(task.status)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className="flex min-h-0 flex-col gap-1">
          <h3 className="px-1 text-caption font-medium text-muted-foreground">最近计划</h3>
          {plans.map(({ turn, plan }) => (
            <div key={`${turn.id}-${plan.planId}`} className="rounded-lg border border-border bg-card/40 p-2.5">
              <div className="flex items-center justify-between gap-2 text-caption">
                <span className="font-medium">计划 {plan.steps.length} 步</span>
                <span className="text-micro text-muted-foreground">{plan.status === 'running' ? '执行中' : plan.status === 'approved' ? '已确认' : plan.status}</span>
              </div>
              <ol className="mt-1.5 space-y-1">
                {plan.steps.map((step, index) => {
                  const stepStatus = plan.stepStatuses?.[String(index)] ?? (index < (plan.currentStepIndex ?? -1) ? 'done' : 'pending')
                  return (
                    <li key={index} className="flex items-start gap-2 text-caption">
                      <span className={cn('mt-0.5', stepStatus === 'done' && 'text-primary', stepStatus === 'failed' && 'text-destructive', stepStatus !== 'done' && stepStatus !== 'failed' && 'text-muted-foreground')}>
                        {stepStatus === 'done' ? <CheckCircle2 className="size-3.5" /> : stepStatus === 'failed' ? <XCircle className="size-3.5" /> : <Circle className="size-3.5" />}
                      </span>
                      <span className={cn('min-w-0 flex-1', stepStatus === 'done' && 'text-muted-foreground line-through decoration-border')}>{step}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
