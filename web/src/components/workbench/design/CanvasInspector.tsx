/**
 * CanvasInspector — 设计画布右侧属性面板。
 *
 * 只做受控编辑：所有几何、字体、颜色改动都通过 onPatch 回到
 * useDesignCanvas，保证撤销栈、持久化和画板渲染一致。
 */
import { Copy, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type {
  CanvasFontFamily,
  CanvasFontWeight,
  CanvasTextAlign,
  DesignArtboard,
  DesignElement,
  DesignImageElement,
  DesignShapeElement,
  DesignTextElement,
} from '@/types/designCanvas'
import { CANVAS_PALETTE } from './canvasModel'

const TYPE_LABELS: Record<DesignElement['type'], string> = {
  text: '文字',
  image: '图片',
  rect: '矩形',
  ellipse: '椭圆',
  line: '线条',
}

const FONT_FAMILIES: readonly { id: CanvasFontFamily; label: string; sample: string }[] = [
  { id: 'sans', label: '无衬线', sample: 'Aa' },
  { id: 'serif', label: '衬线', sample: 'Aa' },
  { id: 'mono', label: '等宽', sample: 'Aa' },
]

const FONT_WEIGHTS: readonly CanvasFontWeight[] = [400, 500, 600, 700]
const ALIGNS: readonly { id: CanvasTextAlign; label: string }[] = [
  { id: 'left', label: '左' },
  { id: 'center', label: '中' },
  { id: 'right', label: '右' },
]

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-border/50 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-caption font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min = -9999,
  max = 9999,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
        }}
        className="h-7 w-full rounded-md border border-border/60 bg-background/70 px-2 text-xs text-foreground outline-none transition-colors duration-fast focus:border-primary/60"
      />
    </label>
  )
}

function IconButton({ label, active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition-colors duration-fast ${
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
      }`}
      {...props}
    >
      {children}
    </button>
  )
}

function ColorRow({ value, onChange, allowTransparent = false }: {
  value: string
  onChange: (value: string) => void
  allowTransparent?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CANVAS_PALETTE.map((color) => (
        <button
          key={color.id}
          type="button"
          title={color.label}
          aria-label={color.label}
          onClick={() => onChange(color.value)}
          className={`h-6 w-6 rounded-full border border-border/70 transition-transform duration-fast hover:scale-105 ${
            value.toLowerCase() === color.value.toLowerCase() ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
          }`}
          style={{ backgroundColor: color.value }}
        />
      ))}
      {allowTransparent && (
        <button
          type="button"
          title="透明"
          aria-label="透明"
          onClick={() => onChange('transparent')}
          className={`h-6 rounded-full border border-border/70 px-2 text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground ${
            value === 'transparent' ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
          }`}
        >
          透明
        </button>
      )}
    </div>
  )
}

function ToggleRow({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly { id: string; label: string }[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      <div className="flex rounded-md ring-1 ring-border/60 p-0.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`h-6 flex-1 rounded text-caption transition-colors duration-fast ${
              value === option.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TextControls({ element, onPatch }: { element: DesignTextElement; onPatch: (patch: Partial<DesignElement>) => void }) {
  return (
    <Section title="文字">
      <textarea
        value={element.text}
        aria-label="画布文字内容"
        onChange={(event) => onPatch({ text: event.target.value })}
        rows={3}
        className="mb-3 w-full resize-y rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs leading-5 text-foreground outline-none transition-colors duration-fast focus:border-primary/60"
      />
      <div className="grid grid-cols-3 gap-1.5">
        {FONT_FAMILIES.map((font) => (
          <button
            key={font.id}
            type="button"
            onClick={() => onPatch({ fontFamily: font.id })}
            className={`flex h-9 flex-col items-center justify-center rounded-md border text-caption transition-colors duration-fast ${
              element.fontFamily === font.id
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border/60 text-muted-foreground hover:text-foreground'
            }`}
            style={{ fontFamily: font.id === 'sans' ? 'Geist Variable, sans-serif' : font.id === 'serif' ? 'Georgia, serif' : 'monospace' }}
          >
            <span className="text-sm leading-none">{font.sample}</span>
            <span className="mt-1">{font.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="字号" value={element.fontSize} min={8} max={240} onChange={(fontSize) => onPatch({ fontSize })} />
        <NumberField label="行高" value={element.lineHeight} min={0.8} max={2.4} step={0.05} onChange={(lineHeight) => onPatch({ lineHeight })} />
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <span className="text-caption text-muted-foreground">字重</span>
        <div className="flex rounded-md ring-1 ring-border/60 p-0.5">
          {FONT_WEIGHTS.map((weight) => (
            <button
              key={weight}
              type="button"
              onClick={() => onPatch({ fontWeight: weight })}
              className={`h-7 flex-1 rounded text-caption transition-colors duration-fast ${
                element.fontWeight === weight ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {weight}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">
        <ToggleRow
          label="对齐"
          value={element.align}
          options={ALIGNS}
          onChange={(align) => onPatch({ align: align as CanvasTextAlign })}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField label="字间距" value={element.letterSpacing} min={-2} max={24} step={0.5} onChange={(letterSpacing) => onPatch({ letterSpacing })} />
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">文字颜色</span>
          <div className="flex h-7 items-center rounded-md border border-border/60 px-2">
            <span className="h-3.5 w-3.5 rounded-full border border-border/60" style={{ backgroundColor: element.color }} />
            <span className="ml-2 truncate text-caption text-muted-foreground">{element.color}</span>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <ColorRow value={element.color} onChange={(color) => onPatch({ color })} />
      </div>
    </Section>
  )
}

function ImageControls({ element, onPatch, onReplaceImage }: {
  element: DesignImageElement
  onPatch: (patch: Partial<DesignElement>) => void
  onReplaceImage?: () => void
}) {
  return (
    <Section title="图片">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="圆角" value={element.radius} min={0} max={Math.min(element.width, element.height) / 2} onChange={(radius) => onPatch({ radius })} />
        <NumberField label="透明度 %" value={Math.round(element.opacity * 100)} min={0} max={100} onChange={(value) => onPatch({ opacity: value / 100 })} />
      </div>
      <div className="mt-2 rounded-md border border-border/60 bg-muted/20 px-2 py-2 text-caption leading-4 text-muted-foreground">
        画板按 cover 裁切填满图片框。要保留完整构图，请把图片框拖成图片比例。
      </div>
      {onReplaceImage && (
        <button
          type="button"
          onClick={onReplaceImage}
          className="mt-2 h-8 w-full rounded-md border border-border/60 text-xs text-foreground transition-colors duration-fast hover:bg-muted/50"
        >
          替换图片
        </button>
      )}
    </Section>
  )
}

function ShapeControls({ element, onPatch }: { element: DesignShapeElement; onPatch: (patch: Partial<DesignElement>) => void }) {
  return (
    <Section title={element.type === 'line' ? '线条' : '形状'}>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-muted-foreground">{element.type === 'line' ? '线条颜色' : '填充'}</span>
        <ColorRow
          value={element.type === 'line' ? element.stroke : element.fill}
          allowTransparent={element.type !== 'line'}
          onChange={(color) => onPatch(element.type === 'line' ? { stroke: color } : { fill: color })}
        />
      </div>
      {element.type !== 'line' && (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">描边</span>
          <ColorRow value={element.stroke} allowTransparent onChange={(stroke) => onPatch({ stroke })} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <NumberField label="描边宽度" value={element.strokeWidth} min={0} max={48} onChange={(strokeWidth) => onPatch({ strokeWidth })} />
        {element.type === 'rect' && (
          <NumberField label="圆角" value={element.radius} min={0} max={Math.min(element.width, element.height) / 2} onChange={(radius) => onPatch({ radius })} />
        )}
      </div>
    </Section>
  )
}

export interface CanvasInspectorProps {
  element: DesignElement | null
  artboard: DesignArtboard
  elementCount: number
  onPatch: (patch: Partial<DesignElement>) => void
  onArtboardBackground: (color: string) => void
  onAlign: (alignment: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void
  onDelete: () => void
  onDuplicate: () => void
  onToggleHidden: () => void
  onToggleLocked: () => void
  onForward: () => void
  onBackward: () => void
  onReplaceImage?: () => void
}

export function CanvasInspector({
  element,
  artboard,
  elementCount,
  onPatch,
  onArtboardBackground,
  onAlign,
  onDelete,
  onDuplicate,
  onToggleHidden,
  onToggleLocked,
  onForward,
  onBackward,
  onReplaceImage,
}: CanvasInspectorProps) {
  if (!element) {
    return (
      <div className="flex h-full flex-col overflow-y-auto scrollbar-thin">
        <Section title="画板">
          <div className="grid grid-cols-2 gap-2 text-caption">
            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
              <div className="text-caption text-muted-foreground">宽度</div>
              <div className="mt-0.5 font-medium text-foreground">{artboard.width} px</div>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
              <div className="text-caption text-muted-foreground">高度</div>
              <div className="mt-0.5 font-medium text-foreground">{artboard.height} px</div>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">画板底色</span>
            <ColorRow value={artboard.background} onChange={onArtboardBackground} />
          </div>
        </Section>
        <div className="px-3 py-4 text-caption leading-5 text-muted-foreground">
          <p className="font-medium text-foreground">还没有选中元素</p>
          <p className="mt-1">在画板上选中文字、图片或形状后，这里会出现位置、尺寸、字体与描边设置。</p>
          <p className="mt-3">当前画板共 {elementCount} 个元素。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-thin">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-caption uppercase tracking-[0.12em] text-muted-foreground">当前元素</div>
          <div className="mt-0.5 text-xs font-medium text-foreground">{TYPE_LABELS[element.type]}</div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={element.hidden ? '显示元素' : '隐藏元素'} onClick={onToggleHidden}>
            {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
          <IconButton label={element.locked ? '解锁元素' : '锁定元素'} active={element.locked} onClick={onToggleLocked}>
            {element.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </IconButton>
          <IconButton label="复制元素" onClick={onDuplicate}><Copy size={14} /></IconButton>
          <IconButton label="删除元素" onClick={onDelete}><Trash2 size={14} /></IconButton>
        </div>
      </div>

      <Section title="变换">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={element.x} onChange={(x) => onPatch({ x })} />
          <NumberField label="Y" value={element.y} onChange={(y) => onPatch({ y })} />
          <NumberField label="宽" value={element.width} min={8} max={artboard.width * 2} onChange={(width) => onPatch({ width })} />
          <NumberField label="高" value={element.height} min={element.type === 'line' ? 1 : 8} max={artboard.height * 2} onChange={(height) => onPatch({ height })} />
          <NumberField label="旋转" value={element.rotation} min={-180} max={180} step={0.5} onChange={(rotation) => onPatch({ rotation })} />
          <NumberField label="透明度 %" value={Math.round(element.opacity * 100)} min={0} max={100} onChange={(value) => onPatch({ opacity: value / 100 })} />
        </div>
        <div className="mt-3">
          <span className="text-caption text-muted-foreground">对齐画板</span>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {([
              ['left', '左'],
              ['hcenter', '水平中'],
              ['right', '右'],
              ['top', '上'],
              ['vcenter', '垂直中'],
              ['bottom', '下'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onAlign(id)}
                className="h-7 rounded-md border border-border/60 text-caption text-muted-foreground transition-colors duration-fast hover:bg-muted/50 hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={onBackward}
            className="h-7 flex-1 rounded-md border border-border/60 text-caption text-muted-foreground transition-colors duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            下移一层
          </button>
          <button
            type="button"
            onClick={onForward}
            className="h-7 flex-1 rounded-md border border-border/60 text-caption text-muted-foreground transition-colors duration-fast hover:bg-muted/50 hover:text-foreground"
          >
            上移一层
          </button>
        </div>
      </Section>

      {element.type === 'text' && <TextControls element={element} onPatch={onPatch} />}
      {element.type === 'image' && <ImageControls element={element} onPatch={onPatch} onReplaceImage={onReplaceImage} />}
      {(element.type === 'rect' || element.type === 'ellipse' || element.type === 'line') && (
        <ShapeControls element={element} onPatch={onPatch} />
      )}
    </div>
  )
}
