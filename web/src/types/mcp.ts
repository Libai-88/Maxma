/** MCP 服务器配置类型定义 */

export type MCPTransport = 'stdio' | 'sse' | 'streamable_http' | 'websocket'

export interface MCPServerInfo {
  server_id: string
  transport: MCPTransport
  enabled: boolean
  description: string
  tool_count: number
  // 阶段 4.1：工具级 allowlist / blocklist
  allowed_tools?: string[] | null
  blocked_tools?: string[] | null
  // 阶段 4.3：TLS 校验开关（仅 sse / streamable_http / websocket）
  tls_verify?: boolean
}

export interface MCPServerConfig extends MCPServerInfo {
  // stdio 专用
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // sse / streamable_http / websocket 专用
  url?: string
  headers?: Record<string, string>
  timeout?: number
  sse_read_timeout?: number
}

export interface ListMCPServersResponse {
  servers: MCPServerInfo[]
  tool_count: number
}

export interface MCPServerCreateBody {
  server_id: string
  transport: MCPTransport
  enabled?: boolean
  description?: string
  // 阶段 4.1
  allowed_tools?: string[] | null
  blocked_tools?: string[] | null
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // 阶段 4.3
  url?: string
  headers?: Record<string, string>
  timeout?: number
  sse_read_timeout?: number
  tls_verify?: boolean
}

export interface MCPServerUpdateBody {
  enabled?: boolean
  description?: string
  // 阶段 4.1
  allowed_tools?: string[] | null
  blocked_tools?: string[] | null
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  // 阶段 4.3
  url?: string
  headers?: Record<string, string>
  timeout?: number
  sse_read_timeout?: number
  tls_verify?: boolean
}

// OMP 自动发现的 MCP 服务器
export interface DiscoveredServer {
  id: string
  name: string
  status: string
  tools?: string[]
}

// 阶段 4.1：列出某个 MCP 服务器所有工具名（供前端勾选 allowlist）
export interface MCPServerToolsResponse {
  server_id: string
  tools: string[]
}

// ── Smithery Registry 市场 ──

export interface RegistryServer {
  name: string
  display_name: string
  description: string
  author: string
  downloads: number
  icon_url: string
  verified: boolean
}

export interface RegistryListResponse {
  servers: RegistryServer[]
  total: number
  page: number
  page_size: number
}

export interface RegistryServerDetail extends RegistryServer {
  readme: string
  config: Record<string, unknown>
  connection: Record<string, unknown>
}

export interface RegistryInstallResponse {
  status: string
  server: Record<string, unknown>
  registry_name: string
  servers: MCPServerInfo[]
  tool_count: number
}

// ── OAuth 授权 ──

export interface OAuthAuthorizeResponse {
  auth_url: string
  state: string
  server_name: string
}

export interface OAuthCallbackResponse {
  status: string
  server_name: string
  token_type: string
  expires_in: number
}

export interface OAuthStatusResponse {
  server_name: string
  authorized: boolean
  status: 'not_authorized' | 'active' | 'expired'
  token_type?: string
  scope?: string
  authorized_at?: number
  expires_at?: number
  has_refresh_token?: boolean
}
