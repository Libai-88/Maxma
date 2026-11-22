/**
 * OfficePreview — 工作台里的 DOCX / XLSX / PPTX 只读预览。
 *
 * 渲染库全部动态加载：只有用户真的打开 Office 文件时才拉取对应 chunk，
 * 不拖慢聊天首屏。所有内容来自本地工作区 blob，不做服务端 HTML 转换，
 * 也不把用户文档内容拼进主 React 字符串。
 */

import { ChevronLeft, ChevronRight, FileWarning, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'

interface SheetPreview {
  name: string
  rows: unknown[][]
  truncated: boolean
}

interface OfficePreviewProps {
  format: OfficeFormat
  blob: Blob
  name: string
}

const MAX_PREVIEW_ROWS = 100
const MAX_PREVIEW_COLS = 30

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toLocaleString()
  return String(value)
}

function SheetTable({ sheet }: { sheet: SheetPreview }) {
  const rows = sheet.rows.slice(0, MAX_PREVIEW_ROWS)
  const colCount = Math.min(MAX_PREVIEW_COLS, Math.max(1, ...rows.map((row) => row.length)))
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin rounded-md border border-border bg-card/40">
      <table className="min-w-max border-collapse text-caption">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="sticky left-0 z-20 w-10 border-b border-r border-border bg-card px-2 py-1.5 text-right font-normal text-muted-foreground">#</th>
            {Array.from({ length: colCount }, (_, index) => (
              <th key={index} className="min-w-24 border-b border-r border-border bg-card px-2 py-1.5 text-left font-normal text-muted-foreground">
                {String.fromCharCode(65 + (index % 26))}{index >= 26 ? Math.floor(index / 26) : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-accent/20">
              <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1.5 text-right tabular-nums text-muted-foreground">{rowIndex + 1}</td>
              {Array.from({ length: colCount }, (_, colIndex) => (
                <td key={colIndex} className="max-w-72 truncate border-b border-r border-border px-2 py-1.5" title={cellText(row[colIndex])}>
                  {cellText(row[colIndex])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.truncated && (
        <p className="border-t border-border px-2 py-1.5 text-caption text-muted-foreground">
          仅显示前 {MAX_PREVIEW_ROWS} 行 / {MAX_PREVIEW_COLS} 列。
        </p>
      )}
    </div>
  )
}

function XlsxPreview({ blob }: { blob: Blob }) {
  const [sheets, setSheets] = useState<SheetPreview[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const { default: readXlsxFile } = await import('read-excel-file/browser')
        const parsed = await readXlsxFile(blob)
        if (cancelled) return
        setSheets(parsed.map((sheet) => ({
          name: sheet.sheet,
          rows: sheet.data as unknown[][],
          truncated: sheet.data.length > MAX_PREVIEW_ROWS,
        })))
        setActive(0)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '表格解析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [blob])

  if (loading) return <div className="flex flex-1 items-center justify-center gap-2 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在解析表格…</div>
  if (error) return <div className="flex flex-1 items-center gap-2 p-4 text-caption text-destructive"><FileWarning className="size-4" />{error}</div>
  if (sheets.length === 0) return <div className="flex flex-1 items-center justify-center text-caption text-muted-foreground">工作表为空</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              type="button"
              className={`rounded-md border px-2 py-1.5 text-caption ${index === active ? 'border-primary/50 bg-accent text-foreground' : 'border-border bg-card/40 text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActive(index)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <SheetTable sheet={sheets[active]!} />
    </div>
  )
}

function DocxPreview({ blob }: { blob: Blob }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    setLoading(true)
    setError('')
    host.replaceChildren()
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview')
        if (cancelled || !host.isConnected) return
        await renderAsync(blob, host, undefined, {
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          renderHeaders: false,
          renderFooters: false,
          useBase64URL: true,
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '文档解析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      host.replaceChildren()
    }
  }, [blob])

  return (
    <div className="relative min-h-0 flex-1 overflow-auto scrollbar-thin rounded-md border border-border bg-muted/30 p-3">
      {loading && <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/60 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在排版文档…</div>}
      {error && <div className="flex items-center gap-2 p-4 text-caption text-destructive"><FileWarning className="size-4" />{error}</div>}
      <div ref={hostRef} className="office-docx" />
    </div>
  )
}

function PptxPreview({ blob, name }: { blob: Blob; name: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const previewerRef = useRef<ReturnType<typeof import('pptx-preview').init> | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [total, setTotal] = useState(0)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    const parent = host?.parentElement
    if (!parent) return
    const measure = () => {
      const next = Math.round(parent.clientWidth)
      if (next <= 0) return
      setViewportWidth((current) => {
        const clamped = Math.max(240, Math.min(1024, next - 32))
        return current === 0 || Math.abs(current - clamped) >= 24 ? clamped : current
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || viewportWidth === 0) return
    let cancelled = false
    setLoading(true)
    setError('')
    setTotal(0)
    setIndex(0)
    host.replaceChildren()
    void (async () => {
      try {
        const { init } = await import('pptx-preview')
        if (cancelled) return
        const instance = init(host, {
          width: viewportWidth,
          height: Math.round(viewportWidth * 9 / 16),
          mode: 'slide',
        })
        previewerRef.current = instance
        await instance.preview(await blob.arrayBuffer())
        if (cancelled) {
          instance.destroy()
          return
        }
        setTotal(instance.slideCount)
        setIndex(instance.currentIndex)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '演示文稿解析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      previewerRef.current?.destroy()
      previewerRef.current = null
      host.replaceChildren()
    }
  }, [blob, viewportWidth])

  function move(delta: number) {
    const previewer = previewerRef.current
    if (!previewer) return
    if (delta > 0) previewer.renderNextSlide()
    else previewer.renderPreSlide()
    setIndex(previewer.currentIndex)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-caption text-muted-foreground" title={name}>{name}</p>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon-xs" aria-label="上一页" disabled={total <= 1} onClick={() => move(-1)}><ChevronLeft className="size-3.5" /></Button>
            <span className="min-w-12 text-center text-caption tabular-nums text-muted-foreground">{index + 1} / {total}</span>
            <Button variant="ghost" size="icon-xs" aria-label="下一页" disabled={total <= 1} onClick={() => move(1)}><ChevronRight className="size-3.5" /></Button>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto scrollbar-thin rounded-md border border-border bg-muted/30 p-3">
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/60 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在解析演示文稿…</div>}
        {!loading && !error && total === 0 && <div className="absolute inset-0 z-10 flex items-center justify-center text-caption text-muted-foreground">演示文稿没有可显示的幻灯片</div>}
        {error && <div className="absolute inset-0 z-10 flex items-center gap-2 bg-background/80 p-4 text-caption text-destructive"><FileWarning className="size-4" />{error}</div>}
        <div ref={hostRef} className="office-pptx" />
      </div>
    </div>
  )
}

export function OfficePreview({ format, blob, name }: OfficePreviewProps) {
  if (format === 'docx') return <DocxPreview blob={blob} />
  if (format === 'xlsx') return <XlsxPreview blob={blob} />
  return <PptxPreview blob={blob} name={name} />
}
