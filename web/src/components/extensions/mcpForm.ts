/**
 * components/extensions/mcpForm.ts — MCP 服务器表单的纯数据转换。
 *
 * 从 ExtensionView.tsx 抽出（FILE-SIZE-RATCHET-001）：那里已经贴着 800 行
 * 棘轮基线上限，新增"扩展"面板时不能继续变胖；这些函数没有任何 React 依赖，
 * 单独成文件更便于测试与复用。
 */

import type { MCPTransport } from '@/types'

/** 表单结构：把数组/对象字段都以「每行一条」的文本表示，保存时再解析。 */
export interface McpForm {
  server_id: string
  transport: MCPTransport
  enabled: boolean
  description: string
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
  tls_verify: boolean
  allowed_tools: string
  blocked_tools: string
}

export function emptyForm(): McpForm {
  return {
    server_id: '',
    transport: 'stdio',
    enabled: true,
    description: '',
    command: '',
    args: '',
    env: '',
    cwd: '',
    url: '',
    headers: '',
    timeout: '',
    tls_verify: true,
    allowed_tools: '',
    blocked_tools: '',
  }
}

export function linesToArray(lines: string): string[] {
  return lines
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function linesToObj(lines: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) {
      const key = line.slice(0, i).trim()
      if (key) out[key] = line.slice(i + 1).trim()
    }
  }
  return out
}

export function objToLines(obj?: Record<string, string>): string {
  if (!obj) return ''
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}
