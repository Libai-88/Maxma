/**
 * FilesPane — 工作区文件面板（P1）。
 *
 * 树 + 预览的只读闭环。根目录由桌面壳显式选择；Web 形态不渲染本 Pane。
 * 所有文件内容来自后端 workspace API，预览组件不直接读取本地路径。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { AlertCircle, ChevronDown, Database, FileSearch, FolderOpen, FolderPlus, MoreHorizontal, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react'

import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normalizeContextItem } from '@/context/contextItems'
import { emitContextItem } from '@/context/contextBus'
import type { DocIndexRootStatus, DocSearchHit, WorkspaceRoot, WorkspaceTreeEntry } from '@/types/workspace'
import type { WorkbenchPaneProps } from './paneProps'
import { FilePreview, type EditorDraft, type PreviewData, type PreviewTab } from './FilePreview'
import type { OfficeFormat } from './OfficePreview'
import { FileTree } from './FileTree'
import { DocSearchPanel } from './DocSearchPanel'

interface ContextMenuState {
  entry: WorkspaceTreeEntry
  x: number
  y: number
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'])
const MARKDOWN_EXT = new Set(['md', 'markdown'])
const OFFICE_EXT = new Set(['docx', 'xlsx', 'pptx'])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function joinAbsolute(rootPath: string, relative: string): string {
  if (!relative) return rootPath
  const separator = rootPath.includes('\\') ? '\\' : '/'
  return `${rootPath.replace(/[\\/]$/, '')}${separator}${relative.split('/').join(separator)}`
}

/** C5：文件/文件夹引用统一走上下文总线，不再各自发一套事件。 */
function emitFileContext(path: string, label: string, sessionId: string | undefined, kind: 'file' | 'folder' = 'file') {
  const item = normalizeContextItem({ kind, path, label }, sessionId ?? '')
  if (item) emitContextItem(item)
}

function disposePreview(preview: PreviewData | undefined) {
  if (preview && (preview.kind === 'image' || preview.kind === 'pdf')) {
    URL.revokeObjectURL(preview.url)
  }
}

export function FilesPane({ sessionId }: WorkbenchPaneProps) {
  const bridge = window.maxmaDesktop
  const [roots, setRoots] = useState<WorkspaceRoot[]>([])
  const [rootId, setRootId] = useState('')
  const [showIgnored, setShowIgnored] = useState(false)
  const [filter, setFilter] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [tabs, setTabs] = useState<PreviewTab[]>([])
  const [activePath, setActivePath] = useState('')
  const [previews, setPreviews] = useState<Record<string, PreviewData>>({})
  const [drafts, setDrafts] = useState<Record<string, EditorDraft>>({})
  const [statPatch, setStatPatch] = useState<{ path: string; size: number; mtime: number; token: number } | null>(null)
  const [editingPath, setEditingPath] = useState('')
  const [loadingRoots, setLoadingRoots] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [revealPath, setRevealPath] = useState<{ path: string; token: number } | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [docIndexing, setDocIndexing] = useState(false)
  const [docStatus, setDocStatus] = useState<DocIndexRootStatus | null>(null)
  const [docSearchOpen, setDocSearchOpen] = useState(false)
  const [docQuery, setDocQuery] = useState('')
  const [docHits, setDocHits] = useState<DocSearchHit[]>([])
  const [docSearching, setDocSearching] = useState(false)
  const previewsRef = useRef<Record<string, PreviewData>>({})
  const draftsRef = useRef<Record<string, EditorDraft>>({})
  const editingPathRef = useRef('')
  const rootEpochRef = useRef(0)
  const refreshRef = useRef<(payload: unknown) => void>(() => {})
  const previewSeqRef = useRef<Record<string, number>>({})

  const activeRoot = useMemo(() => roots.find((root) => root.id === rootId) ?? roots[0] ?? null, [roots, rootId])
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null

  useEffect(() => { draftsRef.current = drafts }, [drafts])
  useEffect(() => { editingPathRef.current = editingPath }, [editingPath])
  const activePreview = activeTab ? previews[activeTab.path] ?? { kind: 'loading' as const } : null
  const activeDraft = activeTab ? drafts[activeTab.path] ?? null : null
  const dirtyPaths = useMemo(
    () => new Set(tabs.filter((tab) => drafts[tab.path]?.dirty).map((tab) => tab.path)),
    [drafts, tabs],
  )

  useEffect(() => {
    previewsRef.current = previews
  }, [previews])

  useEffect(() => {
    const rootId = activeRoot?.id
    if (!rootId) {
      setDocStatus(null)
      return
    }
    let alive = true
    setDocStatus(null)
    setDocHits([])
    setDocQuery('')
    void api.docIndexStatus(rootId)
      .then((result) => {
        if (!alive) return
        setDocStatus(result.roots[0] ?? null)
      })
      .catch(() => {
        if (alive) setDocStatus(null)
      })
    return () => { alive = false }
  }, [activeRoot?.id])

  // 关闭当前 tab 后自动落到最后一个 tab；用副作用收敛状态，
  // 不再在关闭回调里读渲染期的 tabs 闭包（快速连点会互相覆盖）。
  useEffect(() => {
    if (editingPath && !tabs.some((tab) => tab.path === editingPath)) setEditingPath('')
    if (tabs.some((tab) => tab.path === activePath)) return
    setActivePath(tabs[tabs.length - 1]?.path ?? '')
  }, [tabs, activePath, editingPath])

  useEffect(() => {
    return () => {
      for (const preview of Object.values(previewsRef.current)) disposePreview(preview)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void api.listWorkspaceRoots()
      .then((result) => {
        if (!alive) return
        applyRoots(result.roots)
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoadingRoots(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [menu])

  function applyRoots(next: WorkspaceRoot[]) {
    const sorted = [...next].sort((a, b) => Number(b.available !== false) - Number(a.available !== false) || b.last_used_at - a.last_used_at)
    setRoots(sorted)
    setRootId((current) => sorted.some((root) => root.id === current) ? current : sorted[0]?.id ?? '')
  }

  function hasDirtyFiles(): boolean {
    return Object.values(drafts).some((draft) => draft.dirty)
  }

  function confirmDiscardDirty(): boolean {
    if (!hasDirtyFiles()) return true
    return window.confirm('有未保存的文件修改。继续操作会丢弃这些修改，确定？')
  }

  function resetFiles() {
    rootEpochRef.current += 1
    for (const preview of Object.values(previewsRef.current)) disposePreview(preview)
    previewsRef.current = {}
    setPreviews({})
    setDrafts({})
    setEditingPath('')
    setTabs([])
    setActivePath('')
    setFilter('')
    setRevealPath(null)
    setDocIndexing(false)
    setDocStatus(null)
    setRefreshToken((token) => token + 1)
  }

  function switchRoot(nextId: string) {
    if (nextId === rootId) return
    if (!confirmDiscardDirty()) return
    resetFiles()
    setRootId(nextId)
    setRoots((current) => current.map((root) => root.id === nextId ? { ...root, last_used_at: Date.now() } : root))
  }

  async function chooseRoot() {
    if (!confirmDiscardDirty()) return
    setError('')
    try {
      if (!bridge?.pickPath) {
        setError('原生文件夹选择只在 Maxma 桌面端可用。')
        return
      }
      const picked = await bridge.pickPath('folder')
      if (!picked.path) return
      const result = await api.addWorkspaceRoot(picked.path)
      applyRoots([...roots.filter((root) => root.id !== result.root.id), result.root])
      resetFiles()
      setRootId(result.root.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeRoot() {
    if (!activeRoot) return
    if (!confirmDiscardDirty()) return
    if (!window.confirm(`移除工作区「${activeRoot.label}」？只撤销读取授权，不会删除磁盘文件。`)) return
    try {
      await api.removeWorkspaceRoot(activeRoot.id)
      applyRoots(roots.filter((root) => root.id !== activeRoot.id))
      resetFiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function beginRename() {
    if (!activeRoot) return
    setRenameValue(activeRoot.label)
    setRenaming(true)
  }

  async function commitRename() {
    if (!activeRoot) return
    const label = renameValue.trim()
    if (!label) { setRenaming(false); return }
    try {
      const result = await api.renameWorkspaceRoot(activeRoot.id, label)
      applyRoots(roots.map((root) => root.id === result.root.id ? result.root : root))
      setRenaming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function loadPreview(entry: WorkspaceTreeEntry, force = false) {
    if (!force && previewsRef.current[entry.path]) return
    const root = activeRoot
    if (!root) return
    const epoch = rootEpochRef.current
    const seq = (previewSeqRef.current[entry.path] ?? 0) + 1
    previewSeqRef.current[entry.path] = seq
    const stale = () => epoch !== rootEpochRef.current || seq !== previewSeqRef.current[entry.path]
    const ext = extOf(entry.name)
    if (force) disposePreview(previewsRef.current[entry.path])
    const loading: PreviewData = { kind: 'loading' }
    previewsRef.current = { ...previewsRef.current, [entry.path]: loading }
    setPreviews(previewsRef.current)
    try {
      if (IMAGE_EXT.has(ext) || ext === 'pdf') {
        const blob = await api.workspaceBlob(root.id, entry.path)
        const url = URL.createObjectURL(blob)
        if (stale()) {
          URL.revokeObjectURL(url)
          return
        }
        const preview: PreviewData = ext === 'pdf'
          ? { kind: 'pdf', url, size: blob.size }
          : { kind: 'image', url, size: blob.size, mime: blob.type }
        previewsRef.current = { ...previewsRef.current, [entry.path]: preview }
        setPreviews(previewsRef.current)
        return
      }
      if (OFFICE_EXT.has(ext)) {
        const blob = await api.workspaceBlob(root.id, entry.path)
        if (stale()) return
        const preview: PreviewData = { kind: 'office', format: ext as OfficeFormat, blob }
        previewsRef.current = { ...previewsRef.current, [entry.path]: preview }
        setPreviews(previewsRef.current)
        return
      }
      const result = await api.workspaceFile(root.id, entry.path)
      if (stale()) return
      const preview: PreviewData = MARKDOWN_EXT.has(ext)
        ? { kind: 'markdown', content: result.file.content, hash: result.file.hash }
        : { kind: 'text', content: result.file.content, hash: result.file.hash }
      previewsRef.current = { ...previewsRef.current, [entry.path]: preview }
      setPreviews(previewsRef.current)
    } catch (e) {
      if (stale()) return
      const message = e instanceof Error ? e.message : String(e)
      const preview: PreviewData = message.includes('二进制') || message.includes('BINARY')
        ? { kind: 'binary', message: '该文件不是可预览的 UTF-8 文本。' }
        : { kind: 'error', message }
      previewsRef.current = { ...previewsRef.current, [entry.path]: preview }
      setPreviews(previewsRef.current)
    }
  }

  refreshRef.current = (payload) => {
    const data = payload as { path?: unknown; state?: unknown; mtime?: unknown; size?: unknown }
    if (!activeTab || data.path !== activeTab.path || data.state !== 'ready') return
    const size = Number(data.size)
    const mtime = Number(data.mtime)
    if (!Number.isFinite(size) || !Number.isFinite(mtime)) return
    if (size === activeTab.size && mtime === activeTab.mtime) return
    if (editingPathRef.current === activeTab.path && draftsRef.current[activeTab.path]?.dirty) {
      setNotice('磁盘文件已更新；保存前请先重新加载，避免覆盖')
      setTimeout(() => setNotice(''), 2500)
      return
    }
    const nextTab: WorkspaceTreeEntry = { ...activeTab, size, mtime }
    setTabs((current) => current.map((tab) => tab.path === nextTab.path ? { ...tab, size, mtime } : tab))
    setStatPatch({ path: nextTab.path, size, mtime, token: Date.now() })
    void loadPreview(nextTab, true)
  }

  useEffect(() => {
    const rootId = activeRoot?.id
    const tab = activeTab
    if (!rootId || !tab || tab.type !== 'file') return
    let source: EventSource | null = null
    let disposed = false
    void api.prepareWorkspaceWatch(rootId, tab.path).then((url) => {
      if (disposed) return
      source = new EventSource(url)
      source.addEventListener('file', (event) => {
        try {
          refreshRef.current(JSON.parse(event.data) as unknown)
        } catch { /* 事件体损坏时忽略，下一次落盘会再来 */ }
      })
    }).catch(() => {
      // 监听失败不影响手动刷新；不把错误铺到整个文件面板。
    })
    return () => {
      disposed = true
      source?.close()
    }
  }, [activeRoot?.id, activeTab?.path, activeTab?.type])

  function openFile(entry: WorkspaceTreeEntry) {
    if (!activeRoot || entry.type !== 'file') return
    setActivePath(entry.path)
    setTabs((current) => current.some((tab) => tab.path === entry.path)
      ? current
      : [...current, { path: entry.path, name: entry.name, size: entry.size, mtime: entry.mtime, type: entry.type }])
    void loadPreview(entry)
  }

  function toggleEdit() {
    if (!activeTab) return
    if (editingPath === activeTab.path) {
      setEditingPath('')
      return
    }
    const preview = previewsRef.current[activeTab.path]
    if (!preview || (preview.kind !== 'text' && preview.kind !== 'markdown') || preview.truncated) {
      setError('该文件不能编辑：只支持未截断的 UTF-8 文本。')
      return
    }
    setDrafts((current) => current[activeTab.path] ? current : {
      ...current,
      [activeTab.path]: {
        content: preview.content,
        original: preview.content,
        baseHash: preview.hash ?? '',
        dirty: false,
        saving: false,
        error: '',
        conflict: false,
      },
    })
    setEditingPath(activeTab.path)
  }

  function changeDraft(content: string) {
    if (!activeTab) return
    setDrafts((current) => {
      const draft = current[activeTab.path]
      if (!draft) return current
      return { ...current, [activeTab.path]: { ...draft, content, dirty: content !== draft.original, error: '', conflict: false } }
    })
  }

  async function saveDraft() {
    const root = activeRoot
    const tab = activeTab
    const draft = tab ? drafts[tab.path] : null
    if (!root || !tab || !draft || !draft.dirty || draft.saving) return
    setDrafts((current) => current[tab.path] ? { ...current, [tab.path]: { ...current[tab.path], saving: true, error: '', conflict: false } } : current)
    try {
      const result = await api.workspaceWrite(root.id, tab.path, draft.content, draft.baseHash)
      const file = result.file
      const preview: PreviewData = MARKDOWN_EXT.has(extOf(tab.name))
        ? { kind: 'markdown', content: file.content, hash: file.hash }
        : { kind: 'text', content: file.content, hash: file.hash }
      previewsRef.current = { ...previewsRef.current, [tab.path]: preview }
      setPreviews(previewsRef.current)
      setTabs((current) => current.map((item) => item.path === tab.path ? { ...item, size: file.size, mtime: file.mtime } : item))
      setStatPatch({ path: tab.path, size: file.size, mtime: file.mtime, token: Date.now() })
      setDrafts((current) => ({
        ...current,
        [tab.path]: { content: file.content, original: file.content, baseHash: file.hash, dirty: false, saving: false, error: '', conflict: false },
      }))
      setNotice('已保存')
      setTimeout(() => setNotice(''), 1800)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const conflict = message.includes('外部修改') || message.includes('409') || message.includes('FILE_CONFLICT')
      setDrafts((current) => current[tab.path] ? {
        ...current,
        [tab.path]: { ...current[tab.path], saving: false, conflict, error: message },
      } : current)
    }
  }

  async function reloadDraft() {
    const root = activeRoot
    const tab = activeTab
    if (!root || !tab) return
    try {
      const result = await api.workspaceFile(root.id, tab.path)
      const preview: PreviewData = MARKDOWN_EXT.has(extOf(tab.name))
        ? { kind: 'markdown', content: result.file.content, hash: result.file.hash }
        : { kind: 'text', content: result.file.content, hash: result.file.hash }
      previewsRef.current = { ...previewsRef.current, [tab.path]: preview }
      setPreviews(previewsRef.current)
      setTabs((current) => current.map((item) => item.path === tab.path ? { ...item, size: result.file.size, mtime: result.file.mtime } : item))
      setStatPatch({ path: tab.path, size: result.file.size, mtime: result.file.mtime, token: Date.now() })
      setDrafts((current) => ({
        ...current,
        [tab.path]: {
          content: result.file.content,
          original: result.file.content,
          baseHash: result.file.hash,
          dirty: false,
          saving: false,
          error: '',
          conflict: false,
        },
      }))
      setNotice('已重新加载磁盘版本')
      setTimeout(() => setNotice(''), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function closeTab(path: string) {
    if (drafts[path]?.dirty && !window.confirm(`「${tabs.find((tab) => tab.path === path)?.name ?? path}」有未保存修改，关闭会丢弃。确定？`)) return
    const preview = previewsRef.current[path]
    disposePreview(preview)
    const nextPreviews = { ...previewsRef.current }
    delete nextPreviews[path]
    previewsRef.current = nextPreviews
    setPreviews(nextPreviews)
    setDrafts((current) => {
      const next = { ...current }
      delete next[path]
      return next
    })
    if (editingPath === path) setEditingPath('')
    setTabs((current) => current.filter((tab) => tab.path !== path))
  }

  function addToChat(tab: PreviewTab) {
    if (!activeRoot) return
    const absolute = joinAbsolute(activeRoot.path, tab.path)
    emitFileContext(absolute, tab.name, sessionId)
    setNotice('已加入对话引用')
    setTimeout(() => setNotice(''), 1800)
  }

  function copyPath(tab: PreviewTab) {
    void navigator.clipboard.writeText(tab.path).then(
      () => { setNotice('已复制相对路径'); setTimeout(() => setNotice(''), 1800) },
      () => setError('复制失败，请检查剪贴板权限'),
    )
  }

  function reveal(tab: PreviewTab) {
    if (!activeRoot) return
    const absolute = joinAbsolute(activeRoot.path, tab.path)
    if (!bridge?.revealPath) { setError('在资源管理器显示只在 Maxma 桌面端可用。'); return }
    void bridge.revealPath(absolute).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  function revealEntry(entry: WorkspaceTreeEntry) {
    if (!activeRoot) return
    const absolute = joinAbsolute(activeRoot.path, entry.path)
    if (!bridge?.revealPath) { setError('在资源管理器显示只在 Maxma 桌面端可用。'); return }
    void bridge.revealPath(absolute).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  function openExternal(tab: PreviewTab) {
    if (!activeRoot || !bridge?.openPath) { setError('系统打开只在 Maxma 桌面端可用。'); return }
    const absolute = joinAbsolute(activeRoot.path, tab.path)
    void bridge.openPath(absolute).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  async function buildCodeIndex() {
    if (!activeRoot || indexing) return
    setIndexing(true)
    setError('')
    try {
      await api.codeIndexBuild(activeRoot.id, true)
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const result = await api.codeIndexStatus()
        const row = result.roots.find((candidate) => candidate.root_id === activeRoot.id)
        if (row?.status === 'error') throw new Error(row.error ?? '代码索引失败')
        if (row?.status === 'ready') {
          setNotice(`代码索引就绪：${row.fileCount} 个文件`)
          setTimeout(() => setNotice(''), 3000)
          return
        }
      }
      throw new Error('代码索引仍在后台进行，可稍后重试或查看服务日志')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIndexing(false)
    }
  }

  async function buildDocIndex() {
    if (!activeRoot || docIndexing) return
    const rootId = activeRoot.id
    const epoch = rootEpochRef.current
    setDocIndexing(true)
    setError('')
    try {
      await api.docIndexBuild(rootId, true)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        if (epoch !== rootEpochRef.current) return
        const result = await api.docIndexStatus(rootId)
        const row = result.roots[0]
        if (!row) throw new Error('文档索引状态不可用')
        setDocStatus(row)
        if (row.status === 'error') throw new Error(row.error ?? '文档索引失败')
        if (row.status === 'ready') {
          setNotice(
            `文档索引就绪：${row.fileCount} 个文件 / ${row.chunkCount} 块` +
              (row.unsupportedCount > 0 ? `，${row.unsupportedCount} 个未识别` : ''),
          )
          setTimeout(() => setNotice(''), 4000)
          return
        }
      }
      throw new Error('文档索引仍在后台进行，可稍后重试')
    } catch (e) {
      if (epoch === rootEpochRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (epoch === rootEpochRef.current) setDocIndexing(false)
    }
  }

  async function searchDocIndex() {
    if (!activeRoot || docSearching) return
    const query = docQuery.trim()
    if (!query) {
      setDocHits([])
      return
    }
    const epoch = rootEpochRef.current
    setDocSearching(true)
    setError('')
    try {
      const { hits } = await api.docIndexSearch(query, activeRoot.id, 20)
      if (epoch !== rootEpochRef.current) return
      setDocHits(hits)
      if (hits.length === 0) setNotice('文档索引里没有匹配片段；如果文件是新加的，先重建索引。')
    } catch (e) {
      if (epoch === rootEpochRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (epoch === rootEpochRef.current) setDocSearching(false)
    }
  }

  function openDocHit(hit: DocSearchHit) {
    if (tabs.some((tab) => tab.path === hit.relPath)) setActivePath(hit.relPath)
    setFilter('')
    setRevealPath({ path: hit.relPath, token: Date.now() })
  }

  function contextAction(action: 'open' | 'reveal' | 'copy' | 'chat', entry: WorkspaceTreeEntry) {
    setMenu(null)
    if (action === 'open') { openFile(entry); return }
    if (action === 'reveal') { revealEntry(entry); return }
    if (!activeRoot) return
    if (action === 'copy') {
      void navigator.clipboard.writeText(entry.path).then(
        () => { setNotice('已复制相对路径'); setTimeout(() => setNotice(''), 1800) },
        () => setError('复制失败，请检查剪贴板权限'),
      )
      return
    }
    const absolute = joinAbsolute(activeRoot.path, entry.path)
    emitFileContext(absolute, entry.name, sessionId)
    setNotice('已加入对话引用')
    setTimeout(() => setNotice(''), 1800)
  }

  if (loadingRoots) {
    return <div className="flex flex-1 items-center justify-center text-caption text-muted-foreground">加载工作区…</div>
  }

  if (!activeRoot) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
        <FolderOpen className="size-7 text-muted-foreground" />
        <div>
          <p className="text-caption text-foreground">还没有工作区</p>
          <p className="mt-1 text-micro text-muted-foreground">选择一个本地文件夹后，就能在这里浏览文件；不会把整台机器的路径自动暴露给 Agent。</p>
        </div>
        {error && <p className="text-micro text-destructive">{error}</p>}
        <Button size="sm" onClick={() => void chooseRoot()}><FolderPlus className="mr-1 size-3.5" />选择文件夹</Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          {renaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className="h-7 text-caption" autoFocus aria-label="工作区名称"
                onKeyDown={(event) => { if (event.key === 'Enter') void commitRename(); if (event.key === 'Escape') setRenaming(false) }} />
              <Button size="icon-xs" variant="ghost" onClick={() => void commitRename()} aria-label="保存名称">✓</Button>
              <Button size="icon-xs" variant="ghost" onClick={() => setRenaming(false)} aria-label="取消重命名"><X className="size-3" /></Button>
            </div>
          ) : (
            <>
              <div className="relative min-w-0 flex-1">
                <select
                  aria-label="切换工作区"
                  value={activeRoot.id}
                  onChange={(event) => switchRoot(event.target.value)}
                  className="h-7 w-full appearance-none truncate rounded-md border border-border bg-card/50 pl-2 pr-7 text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {roots.map((root) => <option key={root.id} value={root.id}>{root.label}{root.available === false ? '（不可用）' : ''}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1.5 size-3.5 text-muted-foreground" />
              </div>
              <Button size="icon-xs" variant="ghost" onClick={() => void chooseRoot()} aria-label="选择文件夹" title="选择文件夹"><FolderPlus className="size-3.5" /></Button>
              <Button size="icon-xs" variant="ghost" onClick={beginRename} aria-label="重命名工作区" title="重命名工作区"><Pencil className="size-3.5" /></Button>
              <Button size="icon-xs" variant="ghost" onClick={() => void removeRoot()} aria-label="移除工作区" title="移除工作区"><Trash2 className="size-3.5" /></Button>
            </>
          )}
        </div>
        {!renaming && <p className="truncate text-micro text-muted-foreground" title={activeRoot.path}>{activeRoot.path}</p>}
        {!renaming && docStatus && docStatus.status !== 'idle' && (
          <p className="truncate text-micro text-muted-foreground" title={docStatus.error ?? undefined}>
            文档索引：
            {docStatus.status === 'ready'
              ? `${docStatus.fileCount} 文件 · ${docStatus.chunkCount} 块`
              : docStatus.status === 'error'
                ? docStatus.error ?? '失败'
                : docStatus.status === 'cancelled'
                  ? '已取消'
                  : `${docStatus.fileCount} 文件 · ${Math.round(docStatus.progress * 100)}%`}
          </p>
        )}
        {activeRoot.available === false && (
          <div className="flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-micro text-destructive">
            <AlertCircle className="size-3 shrink-0" />文件夹已不存在或不可访问；请重新选择或移除授权。
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="按文件名过滤…" className="h-7 pl-7 text-caption" />
        </div>
        <Button size="icon-xs" variant="ghost" onClick={() => setRefreshToken((token) => token + 1)} aria-label="刷新文件树" title="刷新"><RefreshCw className="size-3.5" /></Button>
        <Button size="icon-xs" variant="ghost" disabled={indexing} onClick={() => void buildCodeIndex()} aria-label="重建代码索引" title="重建代码索引（供代码检索/符号工具使用）">
          <Database className={cn('size-3.5', indexing && 'animate-pulse text-muted-foreground')} />
        </Button>
        <Button size="icon-xs" variant="ghost" disabled={docIndexing} onClick={() => void buildDocIndex()} aria-label="建立文档索引" title="建立/更新文档索引（供 PDF/DOCX/XLSX 检索与页码引用使用）">
          <FileSearch className={cn('size-3.5', docIndexing && 'animate-pulse text-muted-foreground')} />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-pressed={docSearchOpen} onClick={() => setDocSearchOpen((open) => !open)} aria-label="文档内容检索" title="在已建索引的 PDF/DOCX/XLSX/MD/TXT 里搜内容与页码">
          <Search className={cn('size-3.5', docSearchOpen && 'text-foreground')} />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-pressed={showIgnored} onClick={() => setShowIgnored((value) => !value)} aria-label={showIgnored ? '隐藏忽略项' : '显示忽略项'} title="显示忽略项"><MoreHorizontal className={cn('size-3.5', showIgnored && 'text-foreground')} /></Button>
      </div>

      {docSearchOpen && (
        <DocSearchPanel
          query={docQuery}
          onQueryChange={setDocQuery}
          searching={docSearching}
          onSearch={() => void searchDocIndex()}
          onClose={() => { setDocSearchOpen(false); setDocHits([]) }}
          hits={docHits}
          onOpenHit={openDocHit}
          status={docStatus}
        />
      )}

      {(error || notice) && (
        <div className={cn('flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-micro', error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-accent/40 text-muted-foreground')}>
          <span className="min-w-0 flex-1">{error || notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => { setError(''); setNotice('') }}><X className="size-3" /></button>
        </div>
      )}

      <div className="flex h-[38%] min-h-28 flex-col">
        <FileTree
          root={activeRoot}
          showIgnored={showIgnored}
          filter={filter}
          refreshToken={refreshToken}
          currentPath={activePath}
          revealPath={revealPath}
          statPatch={statPatch}
          onOpenFile={openFile}
          onContextMenu={(entry, event: ReactMouseEvent) => {
            setMenu({ entry, x: event.clientX, y: event.clientY })
          }}
        />
      </div>

      <FilePreview
        tabs={tabs}
        activePath={activePath}
        rootLabel={activeRoot.label}
        preview={activePreview}
        editing={editingPath === activePath}
        draft={activeDraft}
        dirtyPaths={dirtyPaths}
        onSelect={(path) => setActivePath(path)}
        onClose={closeTab}
        onNavigate={(path) => {
          setFilter('')
          setRevealPath({ path, token: Date.now() })
        }}
        onAddToChat={addToChat}
        onReveal={reveal}
        onCopyPath={copyPath}
        onOpenExternal={openExternal}
        onToggleEdit={toggleEdit}
        onChangeDraft={changeDraft}
        onSave={() => void saveDraft()}
        onReload={() => void reloadDraft()}
      />

      {menu && (
        <div
          className="fixed z-50 min-w-40 rounded-lg border border-border bg-popover p-2 text-caption"
          style={{ left: Math.min(menu.x, window.innerWidth - 180), top: Math.min(menu.y, window.innerHeight - 150) }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.entry.type === 'file' && <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => contextAction('open', menu.entry)}>打开</button>}
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => contextAction('reveal', menu.entry)}>在资源管理器显示</button>
          <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => contextAction('copy', menu.entry)}>复制相对路径</button>
          {menu.entry.type === 'file' && <button type="button" className="flex w-full rounded-md px-2 py-1.5 text-left hover:bg-accent" onClick={() => contextAction('chat', menu.entry)}>加入对话</button>}
        </div>
      )}
    </div>
  )
}
