/**
 * 工作台状态管理 — Pinia store（单例）。
 *
 * 职责：
 * - 管理 WorkbenchPanel 的展开/关闭、标签切换
 * - 管理 Canvas 卡片的增删
 * - 从 ChatTurn[] 派生 ReasoningEntry[] 时间线
 *
 * 不管理 WS 通信，不修改 ChatTurn 数据。纯前端状态。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ChatTurn } from '@/types'
import type { CanvasCard, CanvasCardType, CanvasWorkspaceTab, InteractiveArtifact, ReasoningEntry, WorkbenchTab } from '@/types/workbench'
import { generateUUID } from '@/utils/env'

/** 最大保留的 turn 数量（推理时间线） */
const MAX_TURNS = 3
const WORKSPACE_STORAGE_KEY = 'maxmahere.canvas-workspace.v1'
const WORKSPACE_UI_STORAGE_KEY = 'maxmahere.canvas-ui-state.v1'
const MAX_PERSISTED_CARDS = 24
/** 单张卡片内容的最大长度（UTF-16 code units，非字节数）。
 *  262144 code units ≈ 256 KB UTF-8 文本，但对 CJK/emoji 不精确。 */
const MAX_CARD_CONTENT_LENGTH = 262_144

const CARD_TYPES: ReadonlySet<CanvasCardType> = new Set([
  'code', 'table', 'summary', 'confirmation', 'choice', 'html', 'json', 'markdown',
])

interface PersistedWorkspace {
  cards: CanvasCard[]
  activeCardId: string | null
}

export const useWorkbenchStore = defineStore('workbench', () => {
  // R4-UI-PERSIST-001：面板开关/标签持久化——此前刷新后工作台关闭、标签回
  // 到 reasoning；现在初始化恢复、变更时保存（与画布卡片分开的轻量键）。
  function loadUiState(): { isOpen: boolean; activeTab: WorkbenchTab } {
    if (typeof localStorage === 'undefined') return { isOpen: false, activeTab: 'reasoning' }
    try {
      const value = JSON.parse(localStorage.getItem(WORKSPACE_UI_STORAGE_KEY) ?? 'null') as
        | { isOpen?: unknown; activeTab?: unknown }
        | null
      return {
        isOpen: value?.isOpen === true,
        activeTab: value?.activeTab === 'canvas' || value?.activeTab === 'reasoning' ? value.activeTab : 'reasoning',
      }
    } catch {
      return { isOpen: false, activeTab: 'reasoning' }
    }
  }
  const _uiState = loadUiState()
  const isOpen = ref(_uiState.isOpen)
  const activeTab = ref<WorkbenchTab>(_uiState.activeTab)
  const restored = restoreWorkspace()
  const cards = ref<CanvasCard[]>(restored.cards)
  const activeCardId = ref<string | null>(restored.activeCardId)

  function persistUiState() {
    try {
      localStorage.setItem(WORKSPACE_UI_STORAGE_KEY, JSON.stringify({
        isOpen: isOpen.value,
        activeTab: activeTab.value,
      }))
    } catch {
      // 配额异常时静默——面板状态丢失可接受
    }
  }
  watch([isOpen, activeTab], persistUiState)

  // MULTI-WINDOW-003：跨窗口画布合并。窗口 B 持久化时全量覆盖会抹掉
  // 窗口 A 新添加的卡片——storage 事件到达时按 card.id 做并集合并，
  // 两窗口的卡片都保留（各自继续全量写，但合并保证不丢）。
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== WORKSPACE_STORAGE_KEY || !event.newValue) return
      try {
        const incoming = JSON.parse(event.newValue) as { cards?: unknown[] } | null
        if (!incoming || !Array.isArray(incoming.cards)) return
        const existingIds = new Set(cards.value.map(c => c.id))
        const newCards = incoming.cards.filter(
          (c): c is CanvasCard => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' && !existingIds.has((c as { id: string }).id),
        )
        if (newCards.length > 0) {
          cards.value.push(...newCards)
        }
      } catch {
        // 忽略损坏的跨窗口载荷
      }
    })
  }
  const workspaceTabs = computed<CanvasWorkspaceTab[]>(() => cards.value.map(card => ({
    id: `canvas-tab-${card.id}`,
    cardId: card.id,
    title: card.title,
    type: card.type,
    pinned: card.pinned === true,
    sourceTurnId: card.sourceTurnId,
  })))
  const activeCard = computed<CanvasCard | null>(() =>
    cards.value.find(card => card.id === activeCardId.value) ?? cards.value[0] ?? null,
  )

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  function toggle() {
    isOpen.value = !isOpen.value
  }

  function setTab(tab: WorkbenchTab) {
    activeTab.value = tab
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
    cards.value = [card, ...cards.value]
    activeCardId.value = card.id
    persistWorkspace()
    open()
    setTab('canvas')
    return card.id
  }

  function removeCard(id: string) {
    const index = cards.value.findIndex(card => card.id === id)
    cards.value = cards.value.filter(c => c.id !== id)
    if (activeCardId.value === id) {
      activeCardId.value = cards.value[index]?.id ?? cards.value[index - 1]?.id ?? null
    }
    persistWorkspace()
  }

  function selectCard(id: string) {
    if (!cards.value.some(card => card.id === id)) return
    activeCardId.value = id
    persistWorkspace()
  }

  function toggleCardPin(id: string) {
    let changed = false
    cards.value = cards.value.map(card => {
      if (card.id !== id) return card
      changed = true
      return { ...card, pinned: card.pinned !== true }
    })
    if (changed) persistWorkspace()
  }

  function addArtifact(artifact: InteractiveArtifact) {
    if (!isInteractiveArtifact(artifact)) return false
    if (cards.value.some(card => card.id === artifact.id)) return false
    cards.value = [{
      id: artifact.id,
      type: artifact.type,
      title: artifact.title,
      content: artifact.body,
      createdAt: Date.now(),
      pinned: true,
      artifact,
    }, ...cards.value]
    activeCardId.value = artifact.id
    open()
    setTab('canvas')
    return true
  }

  function markArtifactActionSubmitted(artifactId: string, actionId: string) {
    cards.value = cards.value.map(card => {
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
    })
    persistWorkspace()
  }

  /** ARTIFACT-ACK-001：后端 artifact_result 失败时回滚乐观标记（动作从未执行，
   *  UI 不能永久显示"已提交"）。恢复 primary 样式并移除已提交标记。 */
  function revertArtifactAction(artifactId: string, actionId: string) {
    cards.value = cards.value.map(card => {
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
    })
    persistWorkspace()
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
    isOpen,
    activeTab,
    cards,
    workspaceTabs,
    activeCardId,
    activeCard,
    open,
    close,
    toggle,
    setTab,
    addCard,
    addArtifact,
    markArtifactActionSubmitted,
    revertArtifactAction,
    removeCard,
    selectCard,
    toggleCardPin,
    buildReasoningTimeline,
  }

  function persistWorkspace() {
    if (typeof localStorage === 'undefined') return
    // Signed actions belong to the active server session. Never retain them in
    // browser storage, even if the card happened to be pinned.
    const persistedCards = cards.value
      .filter(card => card.pinned === true && !card.artifact)
      .slice(0, MAX_PERSISTED_CARDS)
      .map(({ artifact: _artifact, ...card }) => card)
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
        cards: persistedCards,
        activeCardId: persistedCards.some(card => card.id === activeCardId.value)
          ? activeCardId.value
          : persistedCards[0]?.id ?? null,
      }))
    } catch {
      // Storage quota or privacy mode must not make the workbench unusable.
    }
  }
})

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
