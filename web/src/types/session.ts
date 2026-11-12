/** 会话（Session）与延迟任务（Deferred Run）类型定义 */

export interface SessionInfo {
  session_id: string
  message_count: number
  /** 后端对活会话给 ISO 字符串、对历史会话给文件时间；统一用 formatSessionTime 解析。 */
  created_at: number | string
  last_active?: number
  has_active_agent?: boolean
  is_subagent?: boolean
  auto_approve?: boolean
  is_const?: boolean
  const_name?: string
  /** 只在磁盘历史里存在、尚未恢复到内核（点击时需要先 resume）。 */
  persisted?: boolean
  /** 已在本进程 hub 中存活。 */
  active?: boolean
  /** 最后一条用户消息摘要（历史会话列表显示用）。 */
  preview?: string
  updated_at?: number | string
}

/** `GET /api/sessions/history` 的条目（磁盘 pi 会话，恢复前不在 hub 中）。 */
export interface SessionHistoryEntry {
  session_id: string
  message_count: number
  created_at: string
  updated_at: string
  preview: string
  active?: boolean
}

export interface SessionHistoryResponse {
  sessions: SessionHistoryEntry[]
}

export interface CreateSessionResponse {
  session_id: string
  created_at: number
}

export interface ConstifyResponse {
  session_id: string
  is_const: boolean
  const_name: string
}

export interface ListSessionsResponse {
  sessions: SessionInfo[]
}

/** 会话权限模式四档；与 kernel 的 `MaxmaPermissionMode` 同名同义，由
 * `bun-backend/tests/permission-mode-contract.test.ts` 逐字对账，改名必红。 */
export type PermissionMode = 'read_only' | 'ask' | 'operate' | 'auto'

/**
 * `GET/PUT /api/sessions/:id/permission-mode` 的响应（服务端产出见
 * `bun-backend/src/routes/sessions.ts` 的 `permissionModeView`）。
 *
 * 没有 feature flag：四档在 kernel 里恒生效，可用性由 `available_permission_modes`
 * 表达——非空即可交互，前端并按该列表渲染选项。曾经这里读的是一个后端从不产出的
 * `permission_modes_enabled`，控件因此恒禁用、用户的切换被静默吞掉。
 */
export interface SessionPermissionModeResponse {
  session_id: string
  permission_mode: PermissionMode
  available_permission_modes: PermissionMode[]
}

