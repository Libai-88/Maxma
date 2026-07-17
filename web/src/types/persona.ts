/**
 * Persona（人格）类型定义
 *
 * 用于 /personas 系列接口：列表、切换、创建。
 * 注意：getPersona / updatePersona 接口因复用 Markdown 文本接口
 * （{ content: string; type: string }），未在本文件中重复定义。
 */

/** 人格信息（列表元素） */
export interface PersonaInfo {
  id: string
  file: string
  name: string
  description: string
  /** 是否为当前激活的人格 */
  active: boolean
}

/** 人格记忆模式：shared（共享）/ isolated（独立） */
export type PersonaMemoryMode = 'shared' | 'isolated'

/** 列表响应 */
export interface ListPersonasResponse {
  personas: PersonaInfo[]
  active_file: string
}

/** 切换人格响应 */
export interface SwitchPersonaResponse {
  status: string
  active_file: string
}

/** 创建人格请求体 */
export interface CreatePersonaBody {
  name: string
  description?: string
  /** 工具白名单（逗号分隔字符串），缺省表示继承全部工具 */
  tools?: string
  /** 记忆模式：shared / isolated */
  memory?: PersonaMemoryMode | string
}

/** 创建人格响应 */
export interface CreatePersonaResponse {
  status: string
  file: string
  memory_mode: string
  tools: string
}
