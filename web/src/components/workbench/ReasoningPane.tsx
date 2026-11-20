/**
 * ReasoningPane — 最近几轮对话的推理时间线投影。
 * 纯展示：只读 ChatTurn，不产生第二套状态。
 */

import type { WorkbenchPaneProps } from './paneProps'

export function ReasoningPane({ allTurns }: WorkbenchPaneProps) {
  return (
    <div className="flex flex-col gap-2">
      {allTurns.flatMap((turn, ti) => turn.events
        .filter((ev) => ev.kind === 'thinking')
        .map((ev, ei) => (
          <div key={`${ti}-${ei}`} className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            {ev.kind === 'thinking' ? ev.tokens.slice(0, 200) : null}
          </div>
        )))}
    </div>
  )
}
