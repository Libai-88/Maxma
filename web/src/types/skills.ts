/** Anthropic Skills & Macros 类型定义 */

export interface SkillInfo {
  id: string
  name: string
  description: string
  path: string
  source: 'builtin' | 'user'
  enabled?: boolean
}

export interface SkillDetail {
  id: string
  name: string
  description: string
  content: string
  source: 'builtin' | 'user'
}

export interface SkillCreateBody {
  name: string
  description?: string
  content?: string
}

export interface SkillUpdateBody {
  name?: string
  description?: string
  content?: string
}

export interface ListSkillsResponse {
  skills: SkillInfo[]
}

export interface MacroInfo {
  id: string
  name: string
  description: string
  path: string
  source: 'builtin' | 'user'
  enabled?: boolean
}

export interface MacroDetail {
  id: string
  name: string
  description: string
  content: string
  source: 'builtin' | 'user'
}

export interface MacroCreateBody {
  name: string
  description?: string
  content?: string
}

export interface MacroUpdateBody {
  name?: string
  description?: string
  content?: string
}

export interface ListMacrosResponse {
  macros: MacroInfo[]
}
