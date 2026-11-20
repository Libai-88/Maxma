/**
 * 工作台状态管理 — zustand store（单例）。
 *
 * 职责：
 * - 管理 WorkbenchPanel 的展开/关闭、标签切换
 * - 管理 Canvas 卡片的增删
 * - 从 ChatTurn[] 派生 ReasoningEntry[] 时间线
 *
 * 不管理 WS 通信，不修改 ChatTurn 数据。纯前端状态。
 */
import { create } from 'zustand'
import type { ChatTurn } from '@/types'
import type {
  CanvasCard,
  CanvasCardType,
  CanvasWorkspaceTab,
  InteractiveArtifact,
  ReasoningEntry,
  WorkbenchTab,
} from '@/types/workbench'
import { generateUUID } from '@/utils/env'

/** 最大保留的 turn 数量（推理时间线） */
const MAX_TURNS = 3
const WORKSPACE_STORAGE_KEY = 'maxmahere.canvas-workspace.v1'
const WORKSPACE_UI_STORAGE_KEY = 'maxmahere.workbench-ui.v2'
const LEGACY_WORKSPACE_UI_STORAGE_KEY = 'maxmahere.canvas-ui-state.v1'
const MAX_PERSISTED_CARDS = 24
/** 单张卡片内容的最大长度（UTF-16 code units，非字节数）。 */
const MAX_CARD_CONTENT_LENGTH = 262_144
const WORKBENCH_TABS: ReadonlySet<WorkbenchTab> = new Set(['reasoning', 'canvas', 'files', 'browser'])
export const WORKBENCH_MIN_WIDTH = 320
export const WORKBENCH_MAX_WIDTH = 860
const WORKBENCH_DEFAULT_WIDTH = 380

const CARD_TYPES: ReadonlySet<CanvasCardType> = new Set([
  'code', 'table', 'summary', 'confirmation', 'choice', 'html', 'json', 'markdown',
])

interface PersistedWorkspace {
  cards: CanvasCard[]
  activeCardId: string | null
}

interface WorkbenchDerived {
  workspaceTabs: CanvasWorkspaceTab[]
  activeCard: CanvasCard | null
}

interface WorkbenchState extends WorkbenchDerived {
  isOpen: boolean
  activeTab: WorkbenchTab
  width: number
  maximized: boolean
  cards: CanvasCard[]
  activeCardId: string | null
  artifactResults: Map<string, { content: string; error?: string }>
  open: () => void
  close: () => void
  toggle: () => void
  setTab: (tab: WorkbenchTab) => void
  setWidth: (width: number) => void
  toggleMaximized: () => void
  addCard: (params: {
    type: CanvasCardType
    title: string
    content: string
    sourceTool?: string
    sourceTurnId?: string
  }) => string
  addArtifact: (artifact: InteractiveArtifact) => boolean
  markArtifactActionSubmitted: (artifactId: string, actionId: string) => void
  revertArtifactAction: (artifactId: string, actionId: string) => void
  setArtifactResult: (artifactId: string, actionId: string, content: string, error?: string) => void
  getArtifactResult: (artifactId: string, actionId: string) => { content: string; error?: string } | undefined
  removeCard: (id: string) => void
  selectCard: (id: string) => void
  toggleCardPin: (id: string) => void
  buildReasoningTimeline: (turns: ChatTurn[]) => ReasoningEntry[]
}

function deriveCards(cards: CanvasCard[], activeCardId: string | null): WorkbenchDerived {
  return {
    workspaceTabs: cards.map(card => ({
      id: `canvas-tab-${card.id}`,
      cardId: card.id,
      title: card.title,
      type: card.type,
      pinned: card.pinned === true,
      sourceTurnId: card.sourceTurnId,
    })),
    activeCard: cards.find(card => card.id === activeCardId) ?? cards[0] ?? null,
  }
}

export interface WorkbenchUiState {
  isOpen: boolean
  activeTab: WorkbenchTab
  width: number
  maximized: boolean
}

interface StorageLike {
  getItem: (key: string) => string | null
}

/** 把持久化 JSON 归一化成 UI 状态；未知/损坏值一律回退，不抛给调用方。 */
export function parseWorkspaceUiState(value: unknown): WorkbenchUiState {
  const fallback: WorkbenchUiState = {
    isOpen: false,
    activeTab: 'reasoning',
    width: WORKBENCH_DEFAULT_WIDTH,
    maximized: false,
  }
  if (!value || typeof value !== 'object') return fallback
  const raw = value as { isOpen?: unknown; activeTab?: unknown; width?: unknown; maximized?: unknown }
  const activeTab = typeof raw.activeTab === 'string' && WORKBENCH_TABS.has(raw.activeTab as WorkbenchTab)
    ? raw.activeTab as WorkbenchTab
    : 'reasoning'
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width)
    ? Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, Math.round(raw.width)))
    : WORKBENCH_DEFAULT_WIDTH
  return {
    isOpen: raw.isOpen === true,
    activeTab,
    width,
    maximized: raw.maximized === true,
  }
}

/** 读 v2 键；只有 v2 缺失时才读旧 v1 键，避免升级后工作台回到推理页。 */
export function readWorkspaceUiState(storage?: StorageLike | null): WorkbenchUiState {
  const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
  if (!source) return parseWorkspaceUiState(null)
  try {
    const raw = source.getItem(WORKSPACE_UI_STORAGE_KEY)
      ?? source.getItem(LEGACY_WORKSPACE_UI_STORAGE_KEY)
    return parseWorkspaceUiState(JSON.parse(raw ?? 'null'))
  } catch {
    return parseWorkspaceUiState(null)
  }
}

function loadUiState(): WorkbenchUiState {
  return readWorkspaceUiState()
}

function restoreWorkspace(): PersistedWorkspace {
  if (typeof localStorage === 'undefined') return { cards: [], activeCardId: null }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object' || !Array.isArray((value as { cards?: unknown }).cards)) {
      return { cards: [], activeCardId: null }
    }
    const cards = (value as { cards: unknown[] }).cards
      .slice(0, MAX_PERSISTED_CARDS)
      .filter(isStoredCanvasCard)
      .map(card => ({ ...card, pinned: true }))
    const requestedActive = (value as { activeCardId?: unknown }).activeCardId
    const activeCardId = typeof requestedActive === 'string' && cards.some(card => card.id === requestedActive)
      ? requestedActive
      : cards[0]?.id ?? null
    return { cards, activeCardId }
  } catch {
    return { cards: [], activeCardId: null }
  }
}

function isStoredCanvasCard(value: unknown): value is CanvasCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Partial<CanvasCard>
  return typeof card.id === 'string' && card.id.length > 0 && card.id.length <= 128
    && typeof card.title === 'string' && card.title.length > 0 && card.title.length <= 240
    && typeof card.content === 'string' && card.content.length <= MAX_CARD_CONTENT_LENGTH
    && typeof card.type === 'string' && CARD_TYPES.has(card.type as CanvasCardType)
    && typeof card.createdAt === 'number' && Number.isFinite(card.createdAt)
    && (card.sourceTool === undefined || typeof card.sourceTool === 'string')
    && (card.sourceTurnId === undefined || typeof card.sourceTurnId === 'string')
}

function isInteractiveArtifact(value: InteractiveArtifact): boolean {
  if (value.version !== 1 || !/^[a-f0-9]{32}$/.test(value.id)) return false
  if (value.type !== 'confirmation' && value.type !== 'choice') return false
  if (typeof value.title !== 'string' || typeof value.body !== 'string') return false
  if (value.title.length === 0 || value.title.length > 160 || value.body.length === 0 || value.body.length > 4000) return false
  if (/[<>]/.test(value.title) || /[<>]/.test(value.body)) return false
  if (!Array.isArray(value.actions) || value.actions.length < 2 || value.actions.length > 6) return false
  const actionIds = new Set(value.actions.map(action => action.id))
  if (actionIds.size !== value.actions.length) return false
  if (value.type === 'confirmation' && !(actionIds.has('approve') && actionIds.has('reject') && actionIds.size === 2)) return false
  return value.actions.every(action =>
    /^[a-z][a-z0-9_-]{0,31}$/.test(action.id)
    && typeof action.label === 'string'
    && action.label.length > 0
    && action.label.length <= 80
    && !/[<>]/.test(action.label)
    && typeof action.token === 'string'
    && action.token.length >= 32
    && ['primary', 'secondary', 'danger'].includes(action.style),
  )
}

export const useWorkbenchStore = create<WorkbenchState>()((set, get) => {
  const _uiState = loadUiState()
  const restored = restoreWorkspace()

  // 统一 set：cards/activeCardId 变化时重算 workspaceTabs/activeCard（computed 以值形式暴露）。
  function patch(p: Partial<WorkbenchState>) {
    set((s) => {
      const cards = p.cards ?? s.cards
      const activeCardId = p.activeCardId !== undefined ? p.activeCardId : s.activeCardId
      return { ...p, ...deriveCards(cards, activeCardId) }
    })
  }

  // R4-UI-PERSIST-001：面板开关/标签持久化（与画布卡片分开的轻量键）。
  function persistUiState() {
    try {
      localStorage.setItem(WORKSPACE_UI_STORAGE_KEY, JSON.stringify({
        isOpen: get().isOpen,
        activeTab: get().activeTab,
        width: get().width,
        maximized: get().maximized,
      }))
    } catch {
      // 配额异常时静默——面板状态丢失可接受
    }
  }

  function persistWorkspace() {
    if (typeof localStorage === 'undefined') return
    // Signed actions belong to the active server session. Never retain them in
    // browser storage, even if the card happened to be pinned.
    const persistedCards = get().cards
      .filter(card => card.pinned === true && !card.artifact)
      .slice(0, MAX_PERSISTED_CARDS)
      .map((card) => {
        const copy = { ...card }
        delete copy.artifact
        return copy
      })
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
        cards: persistedCards,
        activeCardId: persistedCards.some(card => card.id === get().activeCardId)
          ? get().activeCardId
          : persistedCards[0]?.id ?? null,
      }))
    } catch {
      // Storage quota or privacy mode must not make the workbench unusable.
    }
  }

  function open() {
    patch({ isOpen: true })
    persistUiState()
  }

  function close() {
    patch({ isOpen: false })
    persistUiState()
  }

  function toggle() {
    patch({ isOpen: !get().isOpen })
    persistUiState()
  }

  function setTab(tab: WorkbenchTab) {
    patch({ activeTab: tab })
    persistUiState()
  }

  function setWidth(width: number) {
    const clamped = Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, Math.round(width)))
    patch({ width: clamped, maximized: false })
    persistUiState()
  }

  function toggleMaximized() {
    patch({ maximized: !get().maximized })
    persistUiState()
  }

  function addCard(params: {
    type: CanvasCardType
    title: string
    content: string
    sourceTool?: string
    sourceTurnId?: string
  }): string {
    const card: CanvasCard = {
      id: generateUUID(),
      type: params.type,
      title: params.title,
      content: params.content,
      sourceTool: params.sourceTool,
      sourceTurnId: params.sourceTurnId,
      createdAt: Date.now(),
      pinned: true,
    }
    patch({ cards: [card, ...get().cards], activeCardId: card.id })
    persistWorkspace()
    open()
    setTab('canvas')
    return card.id
  }

  function removeCard(id: string) {
    const cards = get().cards
    const index = cards.findIndex(card => card.id === id)
    const next = cards.filter(c => c.id !== id)
    const activeCardId = get().activeCardId === id
      ? (next[index]?.id ?? next[index - 1]?.id ?? null)
      : get().activeCardId
    patch({ cards: next, activeCardId })
    persistWorkspace()
  }

  function selectCard(id: string) {
    if (!get().cards.some(card => card.id === id)) return
    patch({ activeCardId: id })
    persistWorkspace()
  }

  function toggleCardPin(id: string) {
    let changed = false
    const next = get().cards.map(card => {
      if (card.id !== id) return card
      changed = true
      return { ...card, pinned: card.pinned !== true }
    })
    if (changed) {
      patch({ cards: next })
      persistWorkspace()
    }
  }

  function addArtifact(artifact: InteractiveArtifact) {
    if (!isInteractiveArtifact(artifact)) return false
    if (get().cards.some(card => card.id === artifact.id)) return false
    patch({
      cards: [{
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        content: artifact.body,
        createdAt: Date.now(),
        pinned: true,
        artifact,
      }, ...get().cards],
      activeCardId: artifact.id,
    })
    open()
    setTab('canvas')
    return true
  }

  function markArtifactActionSubmitted(artifactId: string, actionId: string) {
    patch({
      cards: get().cards.map(card => {
        if (card.id !== artifactId || !card.artifact) return card
        return {
          ...card,
          artifact: {
            ...card.artifact,
            actions: card.artifact.actions.map(action => ({
              ...action,
              style: action.id === actionId ? 'secondary' : action.style,
            })),
          },
        }
      }),
    })
    persistWorkspace()
  }

  /** ARTIFACT-ACK-001：后端 artifact_result 失败时回滚乐观标记（动作从未执行，
   *  UI 不能永久显示"已提交"）。恢复 primary 样式并移除已提交标记。 */
  function revertArtifactAction(artifactId: string, actionId: string) {
    patch({
      cards: get().cards.map(card => {
        if (card.id !== artifactId || !card.artifact) return card
        return {
          ...card,
          artifact: {
            ...card.artifact,
            actions: card.artifact.actions.map(action => ({
              ...action,
              style: action.id === actionId ? (action.style === 'secondary' ? 'primary' : action.style) : action.style,
            })),
          },
        }
      }),
    })
    persistWorkspace()
  }

  /** ARTIFACT-RESULT-001：artifact 动作执行结果（"预览"的文件内容等）。 */
  function setArtifactResult(artifactId: string, actionId: string, content: string, error?: string) {
    const next = new Map(get().artifactResults)
    next.set(`${artifactId}:${actionId}`, { content, error })
    patch({ artifactResults: next })
  }

  function getArtifactResult(artifactId: string, actionId: string) {
    return get().artifactResults.get(`${artifactId}:${actionId}`)
  }

  function buildReasoningTimeline(turns: ChatTurn[]): ReasoningEntry[] {
    const recentTurns = turns.slice(-MAX_TURNS)
    const entries: ReasoningEntry[] = []

    for (const turn of recentTurns) {
      for (const event of turn.events) {
        if (event.kind === 'thinking') {
          if (event.consumed) continue
          entries.push({
            id: `${turn.id}-thinking-${entries.length}`,
            kind: 'thinking',
            label: event.tokens.slice(0, 200),
            timestamp: Date.now(),
          })
        } else if (event.kind === 'tool') {
          entries.push({
            id: `${turn.id}-tool-${entries.length}`,
            kind: 'tool',
            label: event.input?.slice(0, 100) || '',
            toolName: event.name,
            status: event.status,
            elapsed: event.elapsed ?? undefined,
            timestamp: Date.now(),
          })
        }
      }
      if (turn.finalAnswer) {
        entries.push({
          id: `${turn.id}-answer`,
          kind: 'answer',
          label: turn.finalAnswer.slice(0, 200),
          timestamp: Date.now(),
        })
      }
    }

    return entries
  }

  return {
    isOpen: _uiState.isOpen,
    activeTab: _uiState.activeTab,
    width: _uiState.width,
    maximized: _uiState.maximized,
    cards: restored.cards,
    activeCardId: restored.activeCardId,
    artifactResults: new Map<string, { content: string; error?: string }>(),
    ...deriveCards(restored.cards, restored.activeCardId),
    open,
    close,
    toggle,
    setTab,
    setWidth,
    toggleMaximized,
    addCard,
    addArtifact,
    markArtifactActionSubmitted,
    revertArtifactAction,
    setArtifactResult,
    getArtifactResult,
    removeCard,
    selectCard,
    toggleCardPin,
    buildReasoningTimeline,
  }
})

// MULTI-WINDOW-003：跨窗口画布合并。窗口 B 持久化时全量覆盖会抹掉
// 窗口 A 新添加的卡片——storage 事件到达时按 card.id 做并集合并。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== WORKSPACE_STORAGE_KEY || !event.newValue) return
    try {
      const incoming = JSON.parse(event.newValue) as { cards?: unknown[] } | null
      if (!incoming || !Array.isArray(incoming.cards)) return
      const current = useWorkbenchStore.getState()
      const existingIds = new Set(current.cards.map(c => c.id))
      const newCards = incoming.cards.filter(
        (c): c is CanvasCard => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' && !existingIds.has((c as { id: string }).id),
      )
      if (newCards.length > 0) {
        useWorkbenchStore.setState((s) => {
          const cards = [...s.cards, ...newCards]
          return { cards, ...deriveCards(cards, s.activeCardId) }
        })
      }
    } catch {
      // 忽略损坏的跨窗口载荷
    }
  })
}
