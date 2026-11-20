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

export interface GitFileStatus {
  path: string
  oldPath?: string
  index: string
  worktree: string
  staged: boolean
  untracked: boolean
  deleted: boolean
  renamed: boolean
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  head: string | null
  detached: boolean
  files: GitFileStatus[]
  truncated: boolean
  repoRoot: string | null
}

export interface GitDiffResult {
  path: string
  staged: boolean
  patch: string
  untracked: boolean
  truncated: boolean
}

export interface CommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
}

export interface GitCommitResult {
  commit: string | null
  branch: string | null
  summary: string
}
