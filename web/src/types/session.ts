/** 会话（Session）与延迟任务（Deferred Run）类型定义 */

export interface SessionInfo {
  session_id: string
  message_count: number
  created_at: number
  last_active?: number
  has_active_agent?: boolean
  is_subagent?: boolean
  auto_approve?: boolean
  is_const?: boolean
  const_name?: string
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

