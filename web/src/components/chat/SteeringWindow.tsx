import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, GripVertical, Send, StepForward } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const POS_KEY = 'maxma_steering_window_pos'
const COLLAPSED_KEY = 'maxma_steering_window_collapsed'

type Pos = { x: number; y: number }

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Pos
    return typeof p?.x === 'number' && typeof p?.y === 'number' ? p : null
  } catch { return null }
}

/** 把窗口限制在视口内（留出边距，避免拖到屏幕外找不回来）。 */
function clamp(p: Pos, w: number, h: number): Pos {
  const margin = 8
  return {
    x: Math.min(Math.max(margin, p.x), Math.max(margin, window.innerWidth - w - margin)),
    y: Math.min(Math.max(margin, p.y), Math.max(margin, window.innerHeight - h - margin)),
  }
}

/**
 * 实时纠偏悬浮小窗（替代原先内联在消息区上方的「实时协作」区块）。
 *
 * 只在流式进行中出现：不占消息区高度、可拖动到顺手的位置、可收起成一条标题，
 * 关掉后本轮不再弹出（下次发送重新出现）。回车 = 立即调整，Shift+回车换行。
 * 位置与收起态记在 localStorage，重开窗口仍在原处。
 */
export function SteeringWindow({
  visible,
  onSteer,
  onFollowUp,
}: {
  visible: boolean
  onSteer: (message: string) => boolean
  onFollowUp: (message: string) => boolean
}) {
  const [text, setText] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  const [pos, setPos] = useState<Pos | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  // 本轮开始（visible 由 false→true）时重置「已关闭」，但不抢焦点
  useEffect(() => {
    if (visible) setDismissed(false)
    else { setText(''); setDismissed(false) }
  }, [visible])

  useEffect(() => {
    const saved = loadPos()
    if (saved && boxRef.current) {
      const r = boxRef.current.getBoundingClientRect()
      setPos(clamp(saved, r.width, r.height))
    }
  }, [visible])

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* 存储不可用 */ }
  }, [collapsed])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    // 捕获必须设在**持有 move/up 处理器**的元素上（拖动条），否则捕获后事件被
    // 重定向到外层容器，move 永远不触发 —— 表现为「能按下、拖不动」。
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    const box = boxRef.current
    if (!drag || !box) return
    const r = box.getBoundingClientRect()
    setPos(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, r.width, r.height))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    setPos((p) => {
      if (p) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* 存储不可用 */ } }
      return p
    })
  }, [])

  const submit = (mode: 'steer' | 'follow_up') => {
    const message = text.trim()
    if (!message) return
    const ok = mode === 'steer' ? onSteer(message) : onFollowUp(message)
    if (ok) setText('')
  }

  if (!visible || dismissed) return null

  const floating = pos !== null

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="实时调整"
      className={cn(
        'z-40 w-[min(340px,calc(100vw-24px))]',
        floating ? 'fixed' : 'absolute right-4 bottom-32',
      )}
      style={floating ? { left: pos.x, top: pos.y } : undefined}
    >
      <Panel
        title="实时调整"
        onClose={() => setDismissed(true)}
        closeLabel="关闭实时调整"
        className="glass-panel shadow-xl"
        actions={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={collapsed ? '展开实时调整' : '收起实时调整'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
          </Button>
        }
      >
        {/* 拖动条：整条标题栏可拖（按钮除外） */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn('absolute left-0 right-16 top-0 flex h-8 cursor-grab items-center justify-center active:cursor-grabbing')}
          aria-hidden="true"
        >
          <GripVertical className="size-3 text-muted-foreground/50" />
        </div>

        {!collapsed && (
          <div className="flex flex-col gap-2 p-2.5 pt-0">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit('steer') }
              }}
              rows={2}
              maxLength={4000}
              placeholder="任务进行中，随时调整方向（回车立即调整）"
              aria-label="实时调整内容"
              className="w-full resize-none rounded-md border border-border bg-background/60 px-3 py-2.5 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] text-muted-foreground">{text.length}/4000</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={!text.trim()} onClick={() => submit('follow_up')} title="完成当前步骤后再处理">
                  <StepForward data-icon="inline-start" /> 稍后
                </Button>
                <Button size="sm" disabled={!text.trim()} onClick={() => submit('steer')} title="立即调整（回车）">
                  <Send data-icon="inline-start" /> 立即调整
                </Button>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}