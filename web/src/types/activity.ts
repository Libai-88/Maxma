/** 活动中心（Activity）类型定义 */

export interface ActivityRecord {
  timestamp: number
  category: string
  event_type: string
  session_id: string
  turn_id: string
  tool_name: string
  level: string
  message: string
  payload: Record<string, unknown>
}

export interface ActivityRecentResponse {
  records: ActivityRecord[]
  total: number
}

export interface ActivityStatsResponse {
  total: number
  by_category: Record<string, number>
  started_at: number
  uptime_seconds: number
}

export interface ActivityClearResponse {
  cleared: number
}
