/**
 * Audit Log（审计日志）类型定义
 *
 * 现有 AuditLogRecord / AuditLogStats / AuditLogListResponse 仍定义在 types/index.ts，
 * 此处以 re-export 形式集中暴露，新代码应优先从本文件导入审计相关类型。
 * 本文件补充 MCP 调用审计聚合统计的响应类型（getMcpAuditSummary）。
 */

export type {
  AuditLogRecord,
  AuditLogStats,
  AuditLogListResponse,
} from './index'

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
