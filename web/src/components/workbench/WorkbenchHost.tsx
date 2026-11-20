/**
 * WorkbenchHost — Workbench 2.0 的 Pane 容器（P0）。
 *
 * P0 只注册四类 Pane：推理、画布、文件；浏览器/变更/终端在后续阶段
 * 具备真实宿主后再加入注册表。所有不可用能力必须显示明确原因，不留下死按钮。
 */

import type { ChatTurn } from '@/types'
import type { WorkbenchTab } from '@/types/workbench'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'
import { useWorkbenchStore } from '@/stores/workbench'
import { FilesPane } from './FilesPane'

interface WorkbenchHostProps {
  onArtifactAction: (payload: { artifactId: string; actionId: string; token: string }) => void
  allTurns: ChatTurn[]
}

export function WorkbenchHost({ onArtifactAction, allTurns }: WorkbenchHostProps) {
  const workbench = useWorkbenchStore()
  // 文件面板依赖原生文件夹选择器；纯 Web 形态没有 preload，不能放出死入口。
  const hasDesktopBridge = typeof window !== 'undefined' && Boolean(window.maxmaDesktop?.pickPath)
  const tabs: readonly WorkbenchTab[] = hasDesktopBridge
    ? ['reasoning', 'canvas', 'files']
    : ['reasoning', 'canvas']
  const activeTab = tabs.includes(workbench.activeTab) ? workbench.activeTab : 'reasoning'
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/40" aria-label="工作台">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-sm font-medium">工作台</span>
        <div className="flex items-center gap-1">
          <Tag>{workbench.cards.length}</Tag>
          <Button variant="ghost" size="icon-sm" onClick={() => workbench.close()} aria-label="关闭工作台">✕</Button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border px-2 py-1.5" role="tablist" aria-label="工作台标签">
        {tabs.map((tab) => (
          <Button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            variant={activeTab === tab ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => workbench.setTab(tab)}
          >
            {tab === 'reasoning' ? '推理' : tab === 'canvas' ? '画布' : '文件'}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin p-2">
        {activeTab === 'reasoning' && (
          <div className="flex flex-col gap-2">
            {allTurns.flatMap((turn, ti) => turn.events
              .filter((ev) => ev.kind === 'thinking')
              .map((ev, ei) => (
                <div key={`${ti}-${ei}`} className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                  {ev.kind === 'thinking' ? ev.tokens.slice(0, 200) : null}
                </div>
              )))}
          </div>
        )}
        {activeTab === 'canvas' && workbench.cards.map((card) => (
          <div key={card.id} className="rounded-xl bg-card p-4 text-meta">
            <div className="mb-1 flex items-center justify-between"><strong>{card.title}</strong>
              <Button variant="ghost" size="icon-sm" onClick={() => workbench.removeCard(card.id)} aria-label="移除卡片">✕</Button>
            </div>
            <pre className="max-h-40 overflow-auto scrollbar-thin whitespace-pre-wrap text-caption text-muted-foreground">{card.content}</pre>
            {card.artifact && card.artifact.actions.map((action) => (
              <Button key={action.id} variant="outline" size="sm" className="mt-2 mr-1" onClick={() => onArtifactAction({ artifactId: card.artifact!.id, actionId: action.id, token: action.token })}>{action.label}</Button>
            ))}
          </div>
        ))}
        {activeTab === 'files' && <FilesPane />}
      </div>
    </aside>
  )
}
