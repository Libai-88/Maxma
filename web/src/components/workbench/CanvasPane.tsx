/**
 * CanvasPane — 画布卡片与交互产物投影。
 * 卡片状态仍在 workbench store；这里只读和触发既有动作。
 */

import type { WorkbenchPaneProps } from './paneProps'
import { Button } from '@/components/ui/button'

export function CanvasPane({ cards, onArtifactAction, onRemoveCard }: WorkbenchPaneProps) {
  return (
    <>
      {cards.map((card) => (
        <div key={card.id} className="mb-2 rounded-xl bg-card p-4 text-meta">
          <div className="mb-1 flex items-center justify-between">
            <strong>{card.title}</strong>
            <Button variant="ghost" size="icon-sm" onClick={() => onRemoveCard(card.id)} aria-label="移除卡片">✕</Button>
          </div>
          <pre className="max-h-40 overflow-auto scrollbar-thin whitespace-pre-wrap text-caption text-muted-foreground">{card.content}</pre>
          {card.artifact && card.artifact.actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              className="mt-2 mr-1"
              onClick={() => onArtifactAction({ artifactId: card.artifact!.id, actionId: action.id, token: action.token })}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ))}
    </>
  )
}
