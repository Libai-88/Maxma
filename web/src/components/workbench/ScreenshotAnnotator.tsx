/**
 * ScreenshotAnnotator — 浏览器截图标注弹层（P3）。
 *
 * 图片与图形都在同一张 canvas 上，保存时直接导出 PNG 交给 ChatInput 上传。
 * 工具：框选（矩形）、箭头、文字；无损撤销/清空。坐标按 canvas 实际像素
 * 换算，避免高分屏下标注偏移。
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUpRight, Square, Text as TextIcon, Trash2, Undo2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Tool = 'rect' | 'arrow' | 'text'

interface Shape {
  tool: Tool
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  text?: string
}

const COLOR_VARS = ['--destructive', '--primary', '--foreground'] as const
const COLOR_LABELS = ['红', '主色', '墨']
// Canvas 2D 对主题里的 oklch() 支持不稳定：赋值可能通过但绘制透明。
// 先在 1×1 canvas 上实测，拿到真实 RGB；不可绘制时回退到等价的高对比色。
const COLOR_FALLBACKS = ['crimson', 'steelblue', 'black'] as const

function resolveColor(cssVar: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
  if (!value) return fallback
  const probe = document.createElement('canvas')
  probe.width = 1
  probe.height = 1
  const context = probe.getContext('2d')
  if (!context) return fallback
  context.fillStyle = fallback
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const pixel = context.getImageData(0, 0, 1, 1).data
  // 这个 Electron/Chromium 的 Canvas 2D 只稳定接受十六进制/颜色名，
  // rgb(...) 与 oklch(...) 会被静默忽略；统一转成 #rrggbb 再交给画布。
  return `#${[pixel[0], pixel[1], pixel[2]].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function ScreenshotAnnotator({
  image,
  onClose,
  onSend,
}: {
  image: { dataUrl: string; width: number; height: number }
  onClose: () => void
  onSend: (dataUrl: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<Tool>('rect')
  const [colorIndex, setColorIndex] = useState(0)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [ready, setReady] = useState(false)
  const drawingRef = useRef(false)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const colors = COLOR_VARS.map((cssVar, index) => resolveColor(cssVar, COLOR_FALLBACKS[index]))

  useEffect(() => {
    const element = new Image()
    element.onload = () => {
      imageRef.current = element
      setReady(true)
    }
    element.src = image.dataUrl
  }, [image.dataUrl])

  function drawArrow(ctx: CanvasRenderingContext2D, shape: Shape) {
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
    const head = Math.max(8, Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) * 0.12)
    ctx.beginPath()
    ctx.moveTo(shape.x1, shape.y1)
    ctx.lineTo(shape.x2, shape.y2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(shape.x2, shape.y2)
    ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 6), shape.y2 - head * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 6), shape.y2 - head * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }

  function redraw() {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const all = draft ? [...shapes, draft] : shapes
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 500))
    ctx.font = `${Math.max(14, Math.round(canvas.width / 60))}px system-ui, sans-serif`
    for (const shape of all) {
      ctx.strokeStyle = shape.color
      ctx.fillStyle = shape.color
      if (shape.tool === 'rect') {
        ctx.strokeRect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1)
      } else if (shape.tool === 'arrow') {
        drawArrow(ctx, shape)
      } else if (shape.text) {
        const size = Math.max(14, Math.round(canvas.width / 60))
        ctx.font = `${size}px system-ui, sans-serif`
        ctx.fillText(shape.text, shape.x1, shape.y1)
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    canvas.width = image.width
    canvas.height = image.height
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shapes, draft, image.width, image.height])

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.round((event.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (canvas.height / rect.height)),
    }
  }

  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready) return
    const p = point(event)
    if (tool === 'text') {
      const value = window.prompt('输入标注文字')
      if (value?.trim()) {
        setShapes((prev) => [...prev, { tool: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: colors[colorIndex], text: value.trim().slice(0, 80) }])
      }
      return
    }
    drawingRef.current = true
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* synthetic pointers may not be active */ }
    setDraft({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: colors[colorIndex] })
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const p = point(event)
    setDraft((prev) => prev ? { ...prev, x2: p.x, y2: p.y } : prev)
  }

  function up(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    drawingRef.current = false
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
    setDraft((prev) => {
      if (prev && Math.hypot(prev.x2 - prev.x1, prev.y2 - prev.y1) > 4) setShapes((current) => [...current, prev])
      return null
    })
  }

  function save() {
    const canvas = canvasRef.current
    if (!canvas) return
    onSend(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="截图标注" data-tool={tool} data-shape-count={shapes.length}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          {[
            { value: 'rect' as const, icon: Square, label: '框选' },
            { value: 'arrow' as const, icon: ArrowUpRight, label: '箭头' },
            { value: 'text' as const, icon: TextIcon, label: '文字' },
          ].map((item) => (
            <Button key={item.value} size="xs" variant={tool === item.value ? 'secondary' : 'ghost'} aria-pressed={tool === item.value} onClick={() => setTool(item.value)}>
              <item.icon className="mr-1 size-3.5" />{item.label}
            </Button>
          ))}
          <span className="mx-1 h-px w-px" />
          {COLOR_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              className={cn('size-5 rounded-full border-2', colorIndex === index ? 'border-foreground' : 'border-transparent')}
              style={{ backgroundColor: colors[index] }}
              aria-label={`标注颜色 ${label}`}
              onClick={() => setColorIndex(index)}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" disabled={!shapes.length} onClick={() => setShapes((prev) => prev.slice(0, -1))}><Undo2 className="mr-1 size-3.5" />撤销</Button>
          <Button variant="ghost" size="xs" disabled={!shapes.length} onClick={() => setShapes([])}><Trash2 className="mr-1 size-3.5" />清空</Button>
          <Button variant="ghost" size="icon-xs" aria-label="关闭标注" onClick={onClose}><X className="size-4" /></Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full rounded-md border border-border bg-card elev-1"
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-caption text-muted-foreground">
        <span>{image.width} × {image.height} · 标注只作用于这张截图，不改动网页</span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={save}>加入对话</Button>
        </div>
      </div>
    </div>
  )
}
