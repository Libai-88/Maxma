/**
 * FilesPane — Workbench 2.0 的只读文件浏览器（P0）。
 *
 * P0 先交付可用的最小闭环：选择工作区、浏览当前目录、打开文本/图片/PDF。
 * 目录树、快捷键、编辑器、diff 在后续阶段接入，不在这里伪装已有能力。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { WorkspaceRoot, WorkspaceTreeEntry } from '@/types/workspace'

type Preview =
  | { kind: 'empty' }
  | { kind: 'text'; path: string; content: string; size: number }
  | { kind: 'image'; path: string; url: string }
  | { kind: 'pdf'; path: string; url: string }
  | { kind: 'error'; path: string; message: string }

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const PDF_EXT = new Set(['pdf'])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function entryIcon(entry: WorkspaceTreeEntry) {
  if (entry.type === 'dir') return <Folder className="size-4 text-muted-foreground" />
  if (entry.type === 'symlink') return <File className="size-4 text-muted-foreground" />
  if (IMAGE_EXT.has(extensionOf(entry.name))) return <ImageIcon className="size-4 text-muted-foreground" />
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'html', 'py', 'go', 'rs', 'sh'].includes(extensionOf(entry.name))) {
    return <FileCode2 className="size-4 text-muted-foreground" />
  }
  return <FileText className="size-4 text-muted-foreground" />
}

export function FilesPane() {
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [rootId, setRootId] = useState('')
  const [treePath, setTreePath] = useState('')
  const [entries, setEntries] = useState<WorkspaceTreeEntry[]>([])
  const [showIgnored, setShowIgnored] = useState(false)
  const [selected, setSelected] = useState<WorkspaceTreeEntry | null>(null)
  const [preview, setPreview] = useState<Preview>({ kind: 'empty' })
  const [loadingRoots, setLoadingRoots] = useState(true)
  const [loadingTree, setLoadingTree] = useState(false)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState('')

  const activeRoot = useMemo(() => roots.find((root) => root.id === rootId) ?? roots[0] ?? null, [roots, rootId])

  useEffect(() => {
    let alive = true
    void api.listWorkspaceRoots()
      .then((result) => {
        if (!alive) return
        setRoots(result.roots)
        if (result.roots[0]) setRootId(result.roots[0].id)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoadingRoots(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!activeRoot) {
      setEntries([])
      return
    }
    let alive = true
    setLoadingTree(true)
    setError('')
    void api.workspaceTree(activeRoot.id, treePath, showIgnored)
      .then((result) => {
        if (!alive) return
        setEntries(result.entries)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoadingTree(false) })
    return () => { alive = false }
  }, [activeRoot, treePath, showIgnored])

  useEffect(() => {
    const url = preview.kind === 'image' || preview.kind === 'pdf' ? preview.url : null
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [preview])

  async function chooseRoot() {
    const bridge = window.maxmaDesktop
    if (!bridge?.pickPath) {
      setError('目录选择只在 Maxma 桌面端可用；Web 端请使用上传入口。')
      return
    }
    try {
      const picked = await bridge.pickPath('folder')
      if (picked.canceled || !picked.path) return
      const result = await api.addWorkspaceRoot(picked.path)
      setRoots((prev) => [result.root, ...prev.filter((root) => root.id !== result.root.id)])
      setRootId(result.root.id)
      setTreePath('')
      setSelected(null)
      setPreview({ kind: 'empty' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function openFile(entry: WorkspaceTreeEntry) {
    if (!activeRoot) return
    setSelected(entry)
    setError('')
    setLoadingFile(true)
    const ext = extensionOf(entry.name)
    try {
      if (IMAGE_EXT.has(ext) || PDF_EXT.has(ext)) {
        const blob = await api.workspaceBlob(activeRoot.id, entry.path)
        const url = URL.createObjectURL(blob)
        setPreview(IMAGE_EXT.has(ext)
          ? { kind: 'image', path: entry.path, url }
          : { kind: 'pdf', path: entry.path, url })
      } else {
        const result = await api.workspaceFile(activeRoot.id, entry.path)
        setPreview({ kind: 'text', path: entry.path, content: result.file.content, size: result.file.size })
      }
    } catch (e) {
      setPreview({ kind: 'error', path: entry.path, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoadingFile(false)
    }
  }

  function goUp() {
    if (!treePath) return
    const parts = treePath.split('/').filter(Boolean)
    setTreePath(parts.slice(0, -1).join('/'))
    setSelected(null)
    setPreview({ kind: 'empty' })
  }

  if (loadingRoots) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>
  }

  if (!activeRoot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <FolderOpen className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">还没有工作区</p>
        <p className="max-w-64 text-caption text-muted-foreground">选择一个本地文件夹后，就能在这里浏览文件；不会把整台机器的路径自动暴露给 Agent。</p>
        <Button size="sm" onClick={() => void chooseRoot()}>选择文件夹</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <select
          aria-label="工作区"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-caption text-foreground"
          value={activeRoot.id}
          onChange={(event) => {
            setRootId(event.target.value)
            setTreePath('')
            setSelected(null)
            setPreview({ kind: 'empty' })
          }}
        >
          {roots.map((root) => <option key={root.id} value={root.id}>{root.label}</option>)}
        </select>
        <Button variant="ghost" size="icon-sm" aria-label="选择新工作区" title="选择新工作区" onClick={() => void chooseRoot()}>
          <FolderOpen className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="刷新文件列表" title="刷新" onClick={() => {
          if (activeRoot) void api.workspaceTree(activeRoot.id, treePath, showIgnored).then((result) => setEntries(result.entries)).catch((e) => setError(e instanceof Error ? e.message : String(e)))
        }}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 overflow-hidden px-2 py-1.5 text-caption text-muted-foreground">
          {treePath && (
            <Button variant="ghost" size="icon-xs" aria-label="返回上级目录" onClick={goUp}>
              <ChevronLeft className="size-3.5" />
            </Button>
          )}
          <span className="truncate">{activeRoot.label}{treePath ? ` / ${treePath}` : ''}</span>
          <label className="ml-auto flex shrink-0 items-center gap-1" title="显示 node_modules/.git 等目录">
            <input type="checkbox" checked={showIgnored} onChange={(event) => setShowIgnored(event.target.checked)} />
            <span>忽略项</span>
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin border-t border-border">
          {loadingTree && <div className="flex items-center gap-2 px-3 py-3 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> 正在加载…</div>}
          {!loadingTree && entries.length === 0 && <p className="px-3 py-4 text-caption text-muted-foreground">这个目录是空的。</p>}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left text-caption hover:bg-accent/50 ${selected?.path === entry.path ? 'bg-accent/60' : ''}`}
              onClick={() => { if (entry.type === 'dir') { setTreePath(entry.path); setSelected(null); setPreview({ kind: 'empty' }) } else void openFile(entry) }}
              title={entry.type === 'symlink' ? 'P0 不跟随符号链接' : entry.path}
            >
              {entryIcon(entry)}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.type === 'dir' ? <span className="text-muted-foreground">›</span> : <span className="shrink-0 text-muted-foreground">{formatBytes(entry.size)}</span>}
            </button>
          ))}
        </div>
      </div>

      {(error || preview.kind !== 'empty') && (
        <div className="min-h-0 max-h-[46%] shrink-0 overflow-hidden border-t border-border">
          {error && <p className="px-3 py-2 text-caption text-destructive">{error}</p>}
          {preview.kind === 'text' && (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5 text-caption text-muted-foreground">
                <span className="truncate">{preview.path}</span>
                <span>{formatBytes(preview.size)}</span>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto scrollbar-thin whitespace-pre-wrap px-3 pb-3 font-mono text-caption">{preview.content}</pre>
            </div>
          )}
          {preview.kind === 'image' && (
            <div className="flex h-full min-h-0 items-center justify-center p-3">
              <img src={preview.url} alt={preview.path} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {preview.kind === 'pdf' && (
            <iframe src={preview.url} title={`PDF：${preview.path}`} className="h-full min-h-48 w-full bg-background" />
          )}
          {preview.kind === 'error' && <p className="px-3 py-2 text-caption text-destructive">{preview.message}</p>}
        </div>
      )}

      {loadingFile && <div className="px-3 py-1.5 text-caption text-muted-foreground"><Loader2 className="mr-1 inline size-3.5 animate-spin" /> 正在读取文件…</div>}
    </div>
  )
}
