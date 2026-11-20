/**
 * FileTree — 工作区文件树（P1）。
 *
 * 只加载用户展开的目录，避免一次遍历整棵仓库；键盘遵循文件树惯例：
 * ↑↓ 移动，→ 展开/进入，← 折叠/回父级，Enter 打开，Backspace 回父级。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ChevronRight, File, FileCode2, FileText, Folder, FolderOpen, Image as ImageIcon, Loader2 } from 'lucide-react'

import { api } from '@/api'
import { cn } from '@/lib/utils'
import type { WorkspaceRoot, WorkspaceTreeEntry } from '@/types/workspace'
import { ancestorsOf, buildTreeRows, filterTreeRows, resolveTreeKey } from './fileTreeModel'

interface NodeState {
  entries: WorkspaceTreeEntry[]
  truncated?: boolean
  loading?: boolean
  error?: string
}interface FileTreeProps {
  root: WorkspaceRoot
  showIgnored: boolean
  filter: string
  refreshToken: number
  currentPath: string
  revealPath: { path: string; token: number } | null
  onOpenFile: (entry: WorkspaceTreeEntry) => void
  onContextMenu: (entry: WorkspaceTreeEntry, event: ReactMouseEvent) => void
}

const CODE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'html', 'py', 'go', 'rs', 'sh', 'bash', 'yml', 'yaml', 'toml', 'sql'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function sizeLabel(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function iconOf(entry: WorkspaceTreeEntry) {
  if (entry.type === 'dir') return <Folder className="size-3.5 shrink-0 text-muted-foreground" />
  if (IMAGE_EXT.has(extOf(entry.name))) return <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
  if (CODE_EXT.has(extOf(entry.name))) return <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
  if (entry.type === 'file') return <FileText className="size-3.5 shrink-0 text-muted-foreground" />
  return <File className="size-3.5 shrink-0 text-muted-foreground" />
}

export function FileTree({ root, showIgnored, filter, refreshToken, currentPath, revealPath, onOpenFile, onContextMenu }: FileTreeProps) {
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusedPath, setFocusedPath] = useState('')
  const [activePath, setActivePath] = useState('')
  const treeRef = useRef<HTMLDivElement>(null)

  const loadDir = useCallback(async (path: string) => {
    setNodes((current) => ({ ...current, [path]: { ...(current[path] ?? { entries: [] }), loading: true, error: undefined } }))
    try {
      const result = await api.workspaceTree(root.id, path, showIgnored)
      setNodes((current) => ({ ...current, [path]: { entries: result.entries, truncated: result.truncated } }))
    } catch (error) {
      setNodes((current) => ({
        ...current,
        [path]: {
          entries: current[path]?.entries ?? [],
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }, [root.id, showIgnored])

  useEffect(() => {
    setNodes({})
    setExpanded(new Set())
    setFocusedPath('')
    void loadDir('')
  }, [loadDir, refreshToken])

  const toggleDir = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
        if (!nodes[path]) void loadDir(path)
      }
      return next
    })
  }, [loadDir, nodes])

  const rows = useMemo(() => buildTreeRows(nodes, expanded), [expanded, nodes])
  const visibleRows = useMemo(() => filterTreeRows(rows, filter), [filter, rows])

  useEffect(() => {
    if (!focusedPath && visibleRows[0]) setFocusedPath(visibleRows[0].entry.path)
  }, [focusedPath, visibleRows])

  useEffect(() => {
    if (currentPath) {
      setActivePath(currentPath)
      setFocusedPath(currentPath)
    }
  }, [currentPath])

  // 面包屑点击目录/文件：展开祖先目录并聚焦目标，不改变当前打开的预览。
  useEffect(() => {
    if (!revealPath) return
    if (!revealPath.path) {
      setExpanded(new Set())
      setFocusedPath('')
      return
    }
    const ancestors = ancestorsOf(revealPath.path)
    setExpanded((current) => {
      const next = new Set(current)
      for (const ancestor of ancestors) next.add(ancestor)
      return next
    })
    for (const ancestor of ancestors) {
      if (!nodes[ancestor]) void loadDir(ancestor)
    }
    setFocusedPath(revealPath.path)
  }, [loadDir, nodes, revealPath])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = resolveTreeKey(visibleRows, focusedPath, event.key, expanded)
    if (action.type === 'none') return
    event.preventDefault()
    if (action.type === 'move') setFocusedPath(action.path)
    else if (action.type === 'toggle') toggleDir(action.path)
    else if (action.type === 'open') {
      setActivePath(action.entry.path)
      onOpenFile(action.entry)
    }
  }

  const rootNode = nodes['']

  return (
    <div
      ref={treeRef}
      role="tree"
      tabIndex={0}
      aria-label="工作区文件树"
      className="min-h-0 flex-1 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-card/30 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={handleKeyDown}
    >
      {rootNode?.loading && <div className="flex items-center gap-2 px-3 py-2 text-caption text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />加载中…</div>}
      {rootNode?.error && <p className="px-3 py-2 text-caption text-destructive">{rootNode.error}</p>}
      {!rootNode?.loading && !rootNode?.error && visibleRows.length === 0 && (
        <p className="px-3 py-4 text-center text-caption text-muted-foreground">{filter ? '没有匹配的文件' : '空文件夹'}</p>
      )}
      {visibleRows.map(({ entry, depth }) => {
        const isDir = entry.type === 'dir'
        const isOpen = isDir && expanded.has(entry.path)
        const isFocused = entry.path === focusedPath
        const isActive = entry.path === activePath
        const node = nodes[entry.path]
        return (
          <div key={entry.path}>
            <button
              type="button"
              role="treeitem"
              aria-expanded={isDir ? isOpen : undefined}
              aria-selected={isActive}
              className={cn(
                'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-caption',
                isFocused && 'bg-accent/70 text-foreground',
                isActive && !isFocused && 'bg-accent/40 text-foreground',
                !isFocused && !isActive && 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
              )}
              style={{ paddingLeft: 8 + depth * 12 } as CSSProperties}
              onClick={() => {
                setFocusedPath(entry.path)
                if (isDir) toggleDir(entry.path)
                else { setActivePath(entry.path); onOpenFile(entry) }
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                setFocusedPath(entry.path)
                onContextMenu(entry, event)
              }}
            >
              {isDir ? (
                <>
                  <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-fast', isOpen && 'rotate-90')} />
                  {isOpen ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : iconOf(entry)}
                </>
              ) : iconOf(entry)}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.type === 'symlink' && <span className="shrink-0 text-micro text-muted-foreground">链接</span>}
              {!isDir && <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">{sizeLabel(entry.size)}</span>}
              {node?.loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </button>
            {node?.error && <p className="px-3 py-1 text-micro text-destructive" style={{ paddingLeft: 20 + depth * 12 }}>{node.error}</p>}
          </div>
        )
      })}
      {rootNode?.truncated && <p className="px-3 py-2 text-micro text-muted-foreground">仅显示前 2000 项，请用文件名过滤。</p>}
    </div>
  )
}
