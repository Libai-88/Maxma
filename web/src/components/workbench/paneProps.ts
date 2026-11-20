/**
 * Workbench Pane 的统一入参。
 *
 * 每个 Pane 只依赖这份上下文，不直接认识 ChatView 或 WorkbenchHost；
 * 新增 Pane 不需要改宿主，只要在 panes.ts 注册并实现组件。
 */

import type { ChatTurn } from '@/types'
import type { GoalChannelState } from '@/stores/chat'
import type { CanvasCard, WorkbenchTab } from '@/types/workbench'

export interface ArtifactActionPayload {
  artifactId: string
  actionId: string
  token: string
}

export interface WorkbenchPaneProps {
  /** 工作台是否可见；浏览器原生 view 用它决定 hide。 */
  isOpen: boolean
  /** 当前激活的 tab；仅浏览器这类原生层组件需要。 */
  activeTab: WorkbenchTab
  /** 命令面板等浮层打开时，原生 view 必须让开。 */
  overlayOpen: boolean
  sessionId?: string
  allTurns: ChatTurn[]
  taskTrackerData: Record<string, unknown> | null
  goalState: GoalChannelState | null
  cards: CanvasCard[]
  onArtifactAction: (payload: ArtifactActionPayload) => void
  onRemoveCard: (id: string) => void
}
