/**
 * fileTreeModel.ts — 文件树的纯函数模型（展开、过滤、键盘、面包屑）。
 *
 * 这些规则不依赖 DOM，单测可以直接覆盖；`FileTree`/`FilePreview` 只负责
 * 把 action 映射到 React 状态和 API。
 */

import type { WorkspaceTreeEntry } from '@/types/workspace'

export interface TreeRow {
  entry: WorkspaceTreeEntry
  depth: number
}

export interface TreeNodeLike {
  entries: WorkspaceTreeEntry[]
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function buildTreeRows(
  nodes: Record<string, TreeNodeLike>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (path: string, depth: number) => {
    const node = nodes[path]
    if (!node) return
    for (const entry of node.entries) {
      rows.push({ entry, depth })
      if (entry.type === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

export function filterTreeRows(rows: TreeRow[], filter: string): TreeRow[] {
  const query = filter.trim().toLowerCase()
  if (!query) return rows
  return rows.filter(({ entry }) =>
    entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query),
  )
}

/** 面包屑/展开所需的祖先目录，按层级从浅到深。 */
export function ancestorsOf(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

export interface BreadcrumbSegment {
  name: string
  path: string
  last: boolean
}

export function breadcrumbSegments(path: string): BreadcrumbSegment[] {
  const segments = path.split('/').filter(Boolean)
  return segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join('/'),
    last: index === segments.length - 1,
  }))
}

export type TreeKeyAction =
  | { type: 'none' }
  | { type: 'move'; path: string }
  | { type: 'toggle'; path: string }
  | { type: 'open'; entry: WorkspaceTreeEntry }

/**
 * 键盘行为：↑↓ 移动，→ 展开，← 折叠/回父级，Enter 打开，Backspace 回父级。
 * 返回 action 而不是直接改状态，便于单测。
 */
export function resolveTreeKey(
  rows: TreeRow[],
  focusedPath: string,
  key: string,
  expanded: ReadonlySet<string>,
): TreeKeyAction {
  if (rows.length === 0) return { type: 'none' }
  const found = rows.findIndex(({ entry }) => entry.path === focusedPath)
  const index = found < 0 ? 0 : Math.min(found, rows.length - 1)
  const current = rows[index]
  if (!current) return { type: 'none' }
  const { entry } = current
  const move = (delta: number): TreeKeyAction => {
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]
    return next ? { type: 'move', path: next.entry.path } : { type: 'none' }
  }

  switch (key) {
    case 'ArrowDown':
      return move(1)
    case 'ArrowUp':
      return move(-1)
    case 'ArrowRight':
      return entry.type === 'dir' && !expanded.has(entry.path)
        ? { type: 'toggle', path: entry.path }
        : { type: 'none' }
    case 'ArrowLeft':
    case 'Backspace':
      if (entry.type === 'dir' && expanded.has(entry.path)) return { type: 'toggle', path: entry.path }
      return entry.path.includes('/') ? { type: 'move', path: parentPath(entry.path) } : { type: 'none' }
    case 'Enter':
      return entry.type === 'dir' ? { type: 'toggle', path: entry.path } : { type: 'open', entry }
    default:
      return { type: 'none' }
  }
}
