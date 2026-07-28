/**
 * 插件类型定义
 */

/** 插件基础信息（从 sidecar RPC 返回） */
export interface Plugin {
  name: string
  version?: string
  description?: string
  enabled: boolean
  features?: string[]
  homepage?: string
  author?: string
  repository?: string
  tags?: string[]
  category?: PluginCategory
}

/** 插件分类 */
export type PluginCategory =
  | 'productivity'
  | 'development'
  | 'ai-assistant'
  | 'integration'
  | 'utility'
  | 'other'

/** 插件详情（扩展基础信息） */
export interface PluginDetail extends Plugin {
  readme?: string
  license?: string
  dependencies?: Record<string, string>
  config_schema?: PluginConfigSchema
  installed_at?: string
  last_updated?: string
}

/** 插件配置 Schema */
export interface PluginConfigSchema {
  type: 'object'
  properties: Record<string, PluginConfigProperty>
  required?: string[]
}

export interface PluginConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
}

/** 插件安装请求 */
export interface InstallPluginRequest {
  spec: string
  features?: string[]
}

/** 插件安装响应 */
export interface InstallPluginResponse {
  ok: boolean
  plugin?: Plugin
  message?: string
}

/** 插件列表响应 */
export type ListPluginsResponse = Plugin[]

/** 插件搜索过滤器 */
export interface PluginFilter {
  query?: string
  category?: PluginCategory
  enabled?: boolean
  tags?: string[]
}
