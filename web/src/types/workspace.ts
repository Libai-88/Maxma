/** Workbench 文件面板类型（与 bun-backend/src/services/workspace-* 对齐） */

export interface WorkspaceRoot {
  id: string
  label: string
  path: string
  realpath: string
  created_at: number
  last_used_at: number
  available?: boolean
}

export type WorkspaceTreeEntryType = 'file' | 'dir' | 'symlink' | 'other'

export interface WorkspaceTreeEntry {
  name: string
  path: string
  type: WorkspaceTreeEntryType
  size: number
  mtime: number
}

export interface WorkspaceTreeResult {
  path: string
  entries: WorkspaceTreeEntry[]
  truncated: boolean
}

export interface WorkspaceTextFile {
  path: string
  content: string
  mtime: number
  size: number
  hash: string
}
