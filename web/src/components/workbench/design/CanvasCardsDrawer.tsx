/**
 * CanvasCardsDrawer — 设计画布里的「资料」抽屉。
 *
 * 旧的代码/表格/结果卡片没有丢：从消息流 pin 过来的结构化内容仍在
 * workbench store 里，抽屉负责浏览、移除、执行交互产物 action，
 * 以及把卡片正文放到画板上变成文字元素。
 */
import { X } from 'lucide-react'

import type { CanvasCard } from '@/types/workbench'
import type { ArtifactActionPayload } from '../paneProps'

export interface CanvasCardsDrawerProps {
  open: boolean
  cards: CanvasCard[]
  onClose: () => void
  onArtifactAction: (payload: ArtifactActionPayload) => void
  onRemoveCard: (id: string) => void
  onPlaceCard: (card: CanvasCard) => void
}

const TYPE_LABELS: Record<CanvasCard['type'], string> = {
  code: '代码',
  table: '表格',
  summary: '摘要',
  confirmation: '确认',
  choice: '选择',
  html: 'HTML',
  json: 'JSON',
  markdown: 'Markdown',
}

export function CanvasCardsDrawer({
  open,
  cards,
  onClose,
  onArtifactAction,
  onRemoveCard,
  onPlaceCard,
}: CanvasCardsDrawerProps) {
  if (!open) return null
  return (
    <>
      <div
        className="absolute inset-0 z-20 bg-foreground/15"
        role="presentation"
        onClick={onClose}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      />
      <aside className="elev-3 absolute inset-y-0 right-0 z-30 flex w-[min(340px,88%)] flex-col border-l border-border/70 bg-background">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <div>
            <h3 className="text-xs font-medium text-foreground">资料卡片</h3>
            <p className="mt-0.5 text-caption text-muted-foreground">从对话固定的代码、表格与结果</p>
          </div>
          <button
            type="button"
            aria-label="关闭资料"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2">
          {cards.length === 0 ? (
            <p className="px-2 py-4 text-caption leading-5 text-muted-foreground">
              还没有资料卡片。对话里点「固定到画布」，代码、表格或结果会出现在这里。
            </p>
          ) : cards.map((card) => (
            <article key={card.id} className="mb-2 rounded-lg border border-border/60 bg-card/70 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 text-caption uppercase tracking-wide text-muted-foreground">
                    {TYPE_LABELS[card.type]}
                  </span>
                  <h4 className="mt-1 truncate text-caption font-medium text-foreground">{card.title}</h4>
                </div>
                <button
                  type="button"
                  aria-label="移除卡片"
                  onClick={() => onRemoveCard(card.id)}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <X size={12} />
                </button>
              </div>
              <pre className="mt-1.5 max-h-28 overflow-auto scrollbar-thin whitespace-pre-wrap break-words text-caption leading-4 text-muted-foreground">
                {card.content}
              </pre>
              <div className="mt-2 flex flex-wrap gap-1">
                {!card.artifact && (
                  <button
                    type="button"
                    onClick={() => onPlaceCard(card)}
                    className="h-7 rounded-md border border-border/60 px-2 text-caption text-foreground transition-colors duration-fast hover:bg-muted/50"
                  >
                    放到画布
                  </button>
                )}
                {card.artifact?.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => onArtifactAction({ artifactId: card.artifact!.id, actionId: action.id, token: action.token })}
                    className={`h-7 rounded-md border px-2 text-caption transition-colors duration-fast ${
                      action.style === 'primary'
                        ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15'
                        : action.style === 'danger'
                          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                          : 'border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </aside>
    </>
  )
}
