/**
 * CanvasLayers — 画布图层列表。
 *
 * 列表顺序与 Konva 绘制顺序相反：最上面的图层显示在最前。
 * 显隐/锁定直接写回项目，上移下移调用 reorderElements。
 */
import { ChevronDown, ChevronUp, Circle, Eye, EyeOff, Image as ImageIcon, Lock, Minus, Square, Type, Unlock } from 'lucide-react'

import type { DesignElement, DesignProject } from '@/types/designCanvas'

const TYPE_LABELS: Record<DesignElement['type'], string> = {
  text: '文字',
  image: '图片',
  rect: '矩形',
  ellipse: '椭圆',
  line: '线条',
}

function ElementIcon({ type }: { type: DesignElement['type'] }) {
  const className = 'h-3.5 w-3.5 shrink-0 text-muted-foreground'
  if (type === 'text') return <Type className={className} />
  if (type === 'image') return <ImageIcon className={className} />
  if (type === 'ellipse') return <Circle className={className} />
  if (type === 'line') return <Minus className={className} />
  return <Square className={className} />
}

function layerLabel(element: DesignElement): string {
  if (element.type === 'text') {
    const text = element.text.replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, 18) : '空文字'
  }
  return TYPE_LABELS[element.type]
}

export interface CanvasLayersProps {
  project: DesignProject
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onToggleLocked: (id: string) => void
  onReorder: (id: string, direction: 'forward' | 'backward') => void
}

export function CanvasLayers({
  project,
  selectedId,
  onSelect,
  onToggleHidden,
  onToggleLocked,
  onReorder,
}: CanvasLayersProps) {
  const layers = [...project.elements].reverse()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <h3 className="text-caption font-medium uppercase tracking-[0.12em] text-muted-foreground">图层</h3>
        <span className="text-caption tabular-nums text-muted-foreground">{layers.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {layers.length === 0 ? (
          <p className="px-3 py-4 text-caption leading-5 text-muted-foreground">
            画板还是空的。用上方工具加文字、形状或图片。
          </p>
        ) : layers.map((element) => {
          const active = selectedId === element.id
          return (
            <div
              key={element.id}
              className={`group flex items-center gap-1.5 border-b border-border/30 px-2 py-1.5 ${
                active ? 'bg-primary/10' : 'hover:bg-muted/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(element.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ElementIcon type={element.type} />
                <span className={`truncate text-caption ${element.hidden ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {layerLabel(element)}
                </span>
              </button>
              <button
                type="button"
                aria-label={element.hidden ? '显示图层' : '隐藏图层'}
                title={element.hidden ? '显示图层' : '隐藏图层'}
                onClick={() => onToggleHidden(element.id)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
              >
                {element.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button
                type="button"
                aria-label={element.locked ? '解锁图层' : '锁定图层'}
                title={element.locked ? '解锁图层' : '锁定图层'}
                onClick={() => onToggleLocked(element.id)}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-background/70 ${
                  element.locked ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {element.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label="上移一层"
                  title="上移一层"
                  onClick={() => onReorder(element.id, 'forward')}
                  className="inline-flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  type="button"
                  aria-label="下移一层"
                  title="下移一层"
                  onClick={() => onReorder(element.id, 'backward')}
                  className="inline-flex h-4 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
                >
                  <ChevronDown size={11} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
