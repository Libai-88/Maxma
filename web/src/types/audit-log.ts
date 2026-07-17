/**
 * Audit Log（审计日志）类型定义
 *
 * 本文件是 AuditLog 类型的源头（real definitions），types/index.ts 通过
 * `export * from './audit-log'` 聚合再导出，保证 `import { X } from '@/types'` 向后兼容。
 */

// === 审计日志 AuditLog ===

export interface AuditLogRecord {
  timestamp: string
  epoch: number
  type: string
  target: string
  detail: string
  data_size: number
  status: string
  extra?: Record<string, any>
}

export interface AuditLogStats {
  total: number
  by_type: Record<string, number>
  by_status: Record<string, number>
  top_targets: Array<{ target: string; count: number }>
}

export interface AuditLogListResponse {
  records: AuditLogRecord[]
}

/**
 * MCP 调用审计聚合统计响应（GET /audit-log/mcp-summary）。
 *
 * 后端目前由 OMP 替代审计子系统，该端点会返回 404；
 * 这里仅为前端类型完整性与未来恢复时使用。
 */
export interface McpAuditSummaryResponse {
  /** 聚合统计条目，每项对应一个 MCP 服务器或工具的调用统计 */
  summary: McpAuditSummaryEntry[]
  event_type: string
}

/** MCP 调用审计单条聚合统计（字段为渐进式契约，后端可能扩展） */
export interface McpAuditSummaryEntry {
  server_id?: string
  tool_name?: string
  call_count?: number
  error_count?: number
  last_called_at?: number
  [key: string]: unknown
}
