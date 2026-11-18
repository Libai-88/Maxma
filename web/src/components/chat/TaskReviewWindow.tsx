import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  clampFloatingPos,
  defaultFloatingPos,
  readStoredPos,
  writeStoredPos,
  type FloatingPos,
} from '@/utils/floatingWindow'

const POS_KEY = 'maxma_task_review_window_pos'
const COLLAPSED_KEY = 'maxma_task_review_window_collapsed'

/**
 * 完成后验收 —— 悬浮窗（替代原先内联在消息区与输入框之间的验收区块）。
 *
 * 为什么改成悬浮：验收区块内联时会占掉消息区与 composer 之间的高度，
 * 长对话里它一出现就把输入框往下顶；而且它属于"对上一轮的收尾操作"，
 * 不该跟着消息滚走。现在固定停靠右下、可拖动、可收起，**回答结束后一直
 * 保持悬浮**，直到用户点「结果符合预期」或「按反馈修订」——这两个动作都会
 * 清掉 taskReview，窗口随之消失，不会残留到下一轮。
 *
 * 位置与收起态存 localStorage；视口变小时自动钳回可视区。
 */
export function TaskReviewWindow({
  turnId,
  feedback,
  onFeedbackChange,
  onRevise,
  onAccept,
}: {
  /** 非空即显示。回合变化时窗口沿用同一位置，不跳来跳去。 */
  turnId: string | null
  feedback: string
  onFeedbackChange: (value: string) => void
  onRevise: () => void
  onAccept: () => void
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  const [pos, setPos] = useState<FloatingPos | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const visible = turnId !== null

  useEffect(() => {
    if (!visible) return
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    setPos((current) => {
      if (current) return clampFloatingPos(current, r, { width: window.innerWidth, height: window.innerHeight })
      return clampFloatingPos(
        readStoredPos(POS_KEY, localStorage) ?? defaultFloatingPos(r, { width: window.innerWidth, height: window.innerHeight }),
        r,
        { width: window.innerWidth, height: window.innerHeight },
      )
    })
  }, [visible])

  useEffect(() => {
    const onResize = () => {
      const box = boxRef.current
      if (!box) return
      const r = box.getBoundingClientRect()
      setPos((current) => (current ? clampFloatingPos(current, r, { width: window.innerWidth, height: window.innerHeight }) : current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0') } catch { /* 存储不可用 */ }
  }, [collapsed])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    const box = boxRef.current
    if (!drag || !box) return
    const r = box.getBoundingClientRect()
    setPos(clampFloatingPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, r, { width: window.innerWidth, height: window.innerHeight }))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    setPos((p) => {
      if (p) writeStoredPos(POS_KEY, p, localStorage)
      return p
    })
  }, [])

  if (!visible) return null

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="完成后验收"
      data-slot="task-review-window"
      className="fixed z-40 w-[min(360px,calc(100vw-24px))]"
      style={pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 }}
    >
      <Panel
        title="完成后验收"
        className="glass-panel"
        actions={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={collapsed ? '展开完成后验收' : '收起完成后验收'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform duration-base ease-out-quint', collapsed && '-rotate-90')} />
          </Button>
        }
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute left-0 right-16 top-0 flex h-9 cursor-grab items-center justify-center active:cursor-grabbing"
          aria-hidden="true"
        >
          <GripVertical className="size-3 text-muted-foreground/50" />
        </div>

        {!collapsed && (
          <div className="flex flex-col gap-2 p-2.5 pt-0">
            <p className="text-ui text-foreground">结果符合你的预期吗？</p>
            <textarea
              value={feedback}
              onChange={(e) => onFeedbackChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && feedback.trim()) {
                  e.preventDefault()
                  onRevise()
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder="需要修改时，写出具体差异"
              aria-label="验收反馈"
              className="w-full resize-none rounded-md border border-border bg-background/60 px-3 py-2.5 text-ui leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-muted-foreground">{feedback.length}/4000</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!feedback.trim()} onClick={onRevise}>
                  按反馈修订
                </Button>
                <Button size="sm" onClick={onAccept}>
                  结果符合预期
                </Button>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
