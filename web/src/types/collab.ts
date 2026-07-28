/**
 * 协作类型定义
 */

/** 会话分享链接 */
export interface SessionShare {
  share_id: string
  session_id: string
  created_by: string
  created_at: string
  expires_at?: string
  access_mode: 'read' | 'comment' | 'edit'
  password_protected: boolean
  access_count: number
  max_access?: number
}

/** 创建分享请求 */
export interface CreateShareRequest {
  session_id: string
  access_mode: 'read' | 'comment' | 'edit'
  expires_in_hours?: number
  password?: string
  max_access?: number
}

/** 会话快照 */
export interface SessionSnapshot {
  snapshot_id: string
  session_id: string
  title: string
  created_at: string
  turn_count: number
  context_usage: {
    used: number
    capacity: number
  }
}

/** 创建快照请求 */
export interface CreateSnapshotRequest {
  title: string
}

/** 协作事件（预留接口） */
export interface CollabEvent {
  type: 'user_joined' | 'user_left' | 'cursor_move' | 'selection_change'
  user_id: string
  timestamp: string
  data: unknown
}

/** 协作会话状态 */
export interface CollabSessionState {
  session_id: string
  active_users: CollabUser[]
  share_links: SessionShare[]
  snapshots: SessionSnapshot[]
}

/** 协作用户 */
export interface CollabUser {
  user_id: string
  username: string
  avatar?: string
  access_mode: 'read' | 'comment' | 'edit'
  joined_at: string
  cursor_position?: { line: number; column: number }
}
