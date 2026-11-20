/**
 * FilePreview — 只读文本/Markdown/图片/PDF 预览 + 多文件 tab（P1）。
 *
 * 不把 HTML 注入主 React DOM；HTML 只显示源码。图片/PDF 用 blob URL，
 * 组件卸载或切换 tab 时由父级统一 revoke。代码高亮用轻量 tokenizer，
 * 不引入完整 highlight.js，避免为右侧预览增加启动成本。
 */

import { useMemo } from 'react'
import { Copy, ExternalLink, FileWarning, FolderOpen, Plus, X } from 'lucide-react'

import { Markdown } from '@/components/common/Markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { WorkspaceTreeEntry } from '@/types/workspace'
import { breadcrumbSegments } from './fileTreeModel'

export interface PreviewTab {
  path: string
  name: string
  size: number
  mtime: number
  type: WorkspaceTreeEntry['type']
}

export type PreviewData =
  | { kind: 'loading' }
  | { kind: 'text'; content: string; hash?: string; truncated?: boolean }
  | { kind: 'markdown'; content: string; truncated?: boolean }
  | { kind: 'image'; url: string; size: number; mime: string }
  | { kind: 'pdf'; url: string; size: number }
  | { kind: 'binary'; message: string }
  | { kind: 'error'; message: string }

interface FilePreviewProps {
  tabs: PreviewTab[]
  activePath: string
  rootLabel: string
  preview: PreviewData | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onNavigate: (path: string) => void
  onAddToChat: (tab: PreviewTab) => void
  onReveal: (tab: PreviewTab) => void
  onCopyPath: (tab: PreviewTab) => void
  onOpenExternal?: (tab: PreviewTab) => void
}

const LANGS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'html', 'py', 'go', 'rs', 'sh', 'bash', 'yml', 'yaml', 'toml', 'sql', 'md'])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'return',
  'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while', 'with', 'yield', 'def', 'elif', 'except', 'lambda', 'None', 'True',
  'False', 'pass', 'raise', 'and', 'or', 'not', 'fn', 'pub', 'match', 'mut', 'impl', 'use',
  'struct', 'trait', 'where', 'func', 'package', 'range', 'chan', 'select', 'go', 'defer',
])

function tokenizeLine(line: string, ext: string) {
  const allowHashComment = ['py', 'sh', 'bash', 'yml', 'yaml', 'toml'].includes(ext)
  const allowSlashComment = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'go', 'rs', 'sql'].includes(ext)
  const slashComment = '//.*|/\\*.*?\\*/'
  const hashComment = '#.*'
  const commentPattern = [allowSlashComment ? slashComment : '', allowHashComment ? hashComment : '']
    .filter(Boolean)
    .join('|')
  const keywordPattern = [...KEYWORDS].join('|')
  const pattern = new RegExp(
    (commentPattern ? `(?<comment>${commentPattern})|` : '')
    + `(?<string>"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`
    + `|(?<keyword>\\b(${keywordPattern})\\b)`
    + `|(?<number>\\b\\d+(?:\\.\\d+)?\\b)`,
    'g',
  )
  const parts: Array<{ text: string; cls?: string }> = []
  let last = 0
  for (const match of line.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index) })
    const cls = match.groups?.comment ? 'hljs-comment'
      : match.groups?.string ? 'hljs-string'
        : match.groups?.keyword ? 'hljs-keyword'
          : 'hljs-number'
    parts.push({ text: match[0], cls })
    last = match.index + match[0].length
  }
  if (last < line.length) parts.push({ text: line.slice(last) })
  return parts
}

function CodeView({ content, name }: { content: string; name: string }) {
  const ext = extOf(name)
  const lines = useMemo(() => content.split('\n'), [content])
  const shown = lines.slice(0, 5000)
  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-thin rounded-md border border-border bg-card/40">
      <div className="min-w-max py-2 font-mono text-caption leading-5">
        {shown.map((line, index) => (
          <div key={index} className="flex">
            <span className="w-10 shrink-0 select-none border-r border-border/60 pr-2 text-right tabular-nums text-muted-foreground/60">{index + 1}</span>
            <code className="md-code block whitespace-pre pl-3 pr-3 text-foreground">
              {LANGS.has(ext) ? tokenizeLine(line, ext).map((part, partIndex) => (
                part.cls ? <span key={partIndex} className={part.cls}>{part.text}</span> : <span key={partIndex}>{part.text}</span>
              )) : line}
            </code>
          </div>
        ))}
      </div>
      {lines.length > shown.length && <p className="border-t border-border px-3 py-2 text-caption text-muted-foreground">仅显示前 5000 行，共 {lines.length} 行。</p>}
    </div>
  )
}

function PreviewBody({ tab, preview, onOpenExternal }: { tab: PreviewTab; preview: PreviewData | null; onOpenExternal?: (tab: PreviewTab) => void }) {
  if (!preview || preview.kind === 'loading') {
    return <div className="flex flex-1 items-center justify-center text-caption text-muted-foreground">加载中…</div>
  }
  if (preview.kind === 'error') {
    return <div className="flex flex-1 items-center gap-2 p-4 text-caption text-destructive"><FileWarning className="size-4 shrink-0" />{preview.message}</div>
  }
  if (preview.kind === 'binary') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileWarning className="size-6 text-muted-foreground" />
        <p className="text-caption text-muted-foreground">{preview.message}</p>
        <p className="text-micro text-muted-foreground">{formatBytes(tab.size)} · {new Date(tab.mtime).toLocaleString()}</p>
      </div>
    )
  }
  if (preview.kind === 'image') {
    return <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto scrollbar-thin p-3"><img src={preview.url} alt={tab.name} className="max-h-full max-w-full object-contain" /></div>
  }
  if (preview.kind === 'pdf') {
    return <iframe src={preview.url} title={tab.name} className="min-h-0 flex-1 rounded-md border border-border bg-card" />
  }
  if (preview.kind === 'markdown') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin rounded-md border border-border bg-card/40 p-3">
        <Markdown content={preview.content} />
        {preview.truncated && <p className="mt-2 text-caption text-muted-foreground">内容过长，仅显示前 2 MiB。</p>}
      </div>
    )
  }
  const isHtml = extOf(tab.name) === 'html' || extOf(tab.name) === 'htm'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {isHtml && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-accent/30 px-2 py-1.5 text-caption text-muted-foreground">
          <span>HTML 仅显示源码，不注入主界面。</span>
          {onOpenExternal && <Button variant="ghost" size="xs" onClick={() => onOpenExternal(tab)}><ExternalLink className="mr-1 size-3" />系统打开</Button>}
        </div>
      )}
      <CodeView content={preview.content} name={tab.name} />
      {preview.truncated && <p className="text-caption text-muted-foreground">内容过长，仅显示前 2 MiB。</p>}
    </div>
  )
}

export function FilePreview({ tabs, activePath, rootLabel, preview, onSelect, onClose, onNavigate, onAddToChat, onReveal, onCopyPath, onOpenExternal }: FilePreviewProps) {
  const active = tabs.find((tab) => tab.path === activePath) ?? null
  if (!active) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
        <FolderOpen className="size-6 text-muted-foreground" />
        <p className="text-caption text-muted-foreground">从左侧文件树选一个文件；预览只读。</p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex min-h-8 items-center gap-1 overflow-x-auto scrollbar-thin border-b border-border pb-2">
        {tabs.map((tab) => (
          <span key={tab.path} className={cn('flex shrink-0 items-center rounded-md border border-border text-caption', tab.path === activePath ? 'bg-accent text-foreground' : 'bg-card/40 text-muted-foreground')}>
            <button type="button" className="max-w-40 truncate px-2 py-1 text-left" title={tab.path} onClick={() => onSelect(tab.path)}>{tab.name}</button>
            <button type="button" className="px-1 py-1 hover:text-foreground" aria-label={`关闭 ${tab.name}`} onClick={() => onClose(tab.path)}><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <nav aria-label="文件路径" title={active.path} className="flex min-w-0 items-center gap-1 overflow-hidden text-micro text-muted-foreground">
            <button type="button" className="shrink-0 hover:text-foreground" onClick={() => onNavigate('')}>{rootLabel}</button>
            {breadcrumbSegments(active.path).map((segment) => (
              <span key={segment.path} className="flex min-w-0 shrink items-center gap-1">
                <span className="shrink-0 opacity-50">/</span>
                {segment.last ? (
                  <span className="truncate text-foreground">{segment.name}</span>
                ) : (
                  <button type="button" className="max-w-[6rem] truncate hover:text-foreground" onClick={() => onNavigate(segment.path)}>{segment.name}</button>
                )}
              </span>
            ))}
          </nav>
          <p className="text-micro text-muted-foreground">{formatBytes(active.size)} · {new Date(active.mtime).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon-xs" aria-label="加入对话" title="加入对话" onClick={() => onAddToChat(active)}><Plus className="size-3.5" /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="复制相对路径" title="复制相对路径" onClick={() => onCopyPath(active)}><Copy className="size-3.5" /></Button>
          <Button variant="ghost" size="icon-xs" aria-label="在资源管理器显示" title="在资源管理器显示" onClick={() => onReveal(active)}><FolderOpen className="size-3.5" /></Button>
        </div>
      </div>
      <PreviewBody tab={active} preview={preview} onOpenExternal={onOpenExternal} />
    </div>
  )
}
