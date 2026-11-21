/**
 * DesignCanvasRail — 画布左侧工具轨的数据与按钮。
 *
 * 从 DesignCanvasPane 拆出：工具清单是纯数据，RailButton 是纯展示组件，
 * 两者都不依赖画布状态，单独放这里避免主面板继续膨胀。
 */
import type { ReactNode } from 'react'
import {
  Circle,
  Hand,
  Image as ImageIcon,
  Minus,
  MousePointer2,
  Square,
  Type,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { CanvasTool } from '@/types/designCanvas'

export interface ToolMeta {
  id: CanvasTool
  label: string
  hint: string
  icon: LucideIcon
  key: string
}

export const TOOLS: readonly ToolMeta[] = [
  { id: 'select', label: '选择', hint: '拖拽移动 · 双击改字 · 右侧改属性', icon: MousePointer2, key: 'V' },
  { id: 'pan', label: '手型', hint: '拖动画布查看', icon: Hand, key: 'H' },
  { id: 'text', label: '文字', hint: '点画板加文字', icon: Type, key: 'T' },
  { id: 'image', label: '图片', hint: '导入图片到画板', icon: ImageIcon, key: 'I' },
  { id: 'rect', label: '矩形', hint: '在画板上拖出矩形', icon: Square, key: 'R' },
  { id: 'ellipse', label: '椭圆', hint: '在画板上拖出椭圆', icon: Circle, key: 'O' },
  { id: 'line', label: '线条', hint: '拖出水平分割线', icon: Minus, key: 'L' },
] as const

export function RailButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground duration-fast ${
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border/60 hover:bg-muted/50 hover:text-foreground'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
