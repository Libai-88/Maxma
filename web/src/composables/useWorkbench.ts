/** 工作台状态管理 — 面板开关 + Canvas 卡片 + 推理时间线派生。

职责：
- 管理 WorkbenchPanel 的展开/关闭、标签切换
- 管理 Canvas 卡片的增删
- 从 ChatTurn[] 派生 ReasoningEntry[] 时间线

不管理 WS 通信，不修改 ChatTurn 数据。纯前端状态。
*/
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { ChatTurn } from '@/types'
import type { CanvasCard, CanvasCardType, ReasoningEntry, WorkbenchTab } from '@/types/workbench'

/** 最大保留的 turn 数量（推理时间线） */
const MAX_TURNS = 3

export function useWorkbench() {
  const isOpen: Ref<boolean> = ref(false)
  const activeTab: Ref<WorkbenchTab> = ref('reasoning')
  const cards: Ref<CanvasCard[]> = ref([])

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
  }) {
    const card: CanvasCard = {
      id: crypto.randomUUID(),
      type: params.type,
      title: params.title,
      content: params.content,
      sourceTool: params.sourceTool,
      sourceTurnId: params.sourceTurnId,
      createdAt: Date.now(),
    }
    cards.value = [card, ...cards.value]
    // 自动打开面板并切换到 canvas 标签
    open()
    setTab('canvas')
  }

  function removeCard(id: string) {
    cards.value = cards.value.filter(c => c.id !== id)
  }

  function clearCards() {
    cards.value = []
  }

  function buildReasoningTimeline(turns: ChatTurn[]): ReasoningEntry[] {
    const recentTurns = turns.slice(-MAX_TURNS)
    const entries: ReasoningEntry[] = []

    for (const turn of recentTurns) {
      for (const event of turn.events) {
        if (event.kind === 'thinking') {
          // 跳过已消费的中间思考块
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
      // 最终答案
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
    open,
    close,
    toggle,
    setTab,
    addCard,
    removeCard,
    clearCards,
    buildReasoningTimeline,
  }
}
