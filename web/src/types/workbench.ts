/** 工作台层类型定义 */

/** 工作台面板标签页 */
export type WorkbenchTab = 'reasoning' | 'canvas'

/** Canvas 卡片类型 */
export type CanvasCardType =
  | 'code'
  | 'table'
  | 'summary'
  | 'confirmation'
  | 'choice'
  | 'html'
  | 'json'
  | 'markdown'

export interface ArtifactAction {
  id: string
  label: string
  token: string
  style: 'primary' | 'secondary' | 'danger'
}

/** A server-issued, schema-validated card. It never contains HTML or scripts. */
export interface InteractiveArtifact {
  version: 1
  id: string
  type: 'confirmation' | 'choice'
  title: string
  body: string
  actions: ArtifactAction[]
}

/** Canvas 卡片 — 从消息流 pin 到画布的结构化内容 */
export interface CanvasCard {
  /** 唯一 ID（crypto.randomUUID()） */
  id: string
  /** 卡片类型 */
  type: CanvasCardType
  /** 卡片标题（从工具名或用户自定义） */
  title: string
  /** 卡片内容（类型取决于 type） */
  content: string
  /** 来源工具名（可选） */
  sourceTool?: string
  /** 来源 turn ID（可选，用于追溯） */
  sourceTurnId?: string
  /** 创建时间戳 */
  createdAt: number
  /** Pinned cards are restored when the desktop app is reopened. */
  pinned?: boolean
  /** Interactive artifacts are rendered by a local, allow-listed component. */
  artifact?: InteractiveArtifact
}

/** A local tab is a safe projection of a card, never independently executable content. */
export interface CanvasWorkspaceTab {
  id: string
  cardId: string
  title: string
  type: CanvasCardType
  pinned: boolean
  sourceTurnId?: string
}

/** 推理时间线条目 — 从 ChatTurn.events 派生 */
export interface ReasoningEntry {
  /** 条目 ID（turnId + event index） */
  id: string
  /** 条目类型 */
  kind: 'thinking' | 'tool' | 'answer'
  /** 显示文本 */
  label: string
  /** 工具名（tool 类型才有） */
  toolName?: string
  /** 状态（tool 类型才有） */
  status?: 'running' | 'done' | 'error'
  /** 耗时毫秒（tool 类型才有） */
  elapsed?: number
  /** 时间戳 */
  timestamp: number
}
