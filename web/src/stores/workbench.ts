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
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ChatTurn } from '@/types'
import type { CanvasCard, CanvasCardType, CanvasWorkspaceTab, InteractiveArtifact, ReasoningEntry, WorkbenchTab } from '@/types/workbench'

/** 最大保留的 turn 数量（推理时间线） */
const MAX_TURNS = 3
const WORKSPACE_STORAGE_KEY = 'maxmahere.canvas-workspace.v1'
const MAX_PERSISTED_CARDS = 24
const MAX_CARD_CONTENT_LENGTH = 262_144

const CARD_TYPES: ReadonlySet<CanvasCardType> = new Set([
  'code', 'table', 'summary', 'confirmation', 'choice', 'html', 'json', 'markdown',
])

interface PersistedWorkspace {
  cards: CanvasCard[]
  activeCardId: string | null
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const isOpen = ref(false)
  const activeTab = ref<WorkbenchTab>('reasoning')
  const restored = restoreWorkspace()
  const cards = ref<CanvasCard[]>(restored.cards)
  const activeCardId = ref<string | null>(restored.activeCardId)
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
      id: crypto.randomUUID(),
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
