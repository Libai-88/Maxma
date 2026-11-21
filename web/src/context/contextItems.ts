/**
 * web/src/context/contextItems.ts — 工作台上下文总线（M3 / C5）。
 *
 * 目标不是"再加一个 @ 引用"，而是把工作台里不同面板的"我正在看的东西"
 * 归一成同一种 ContextItem，再统一变成对话引用。这样：
 *   - 文件、网页选区、画布元素走的是同一条入对话链路；
 *   - 每个引用都带来源（路径/URL/选择器）与正文，模型知道"这段从哪来"；
 *   - 会话级快照可以恢复（关掉工作台再打开，引用还在）。
 *
 * 边界：
 *   - 只做前端引用，不读磁盘、不调后端；文件是否存在由后续工具自己报错；
 *   - 文本截断 8000 字符，最多 20 条，防止把整本书塞进一次对话；
 *   - 不自动引用 Office 段落：当前没有 Office 预览面板，没有真实入口就不造。
 */

import type { FolderRef, ImageRef, ParsedRef, WebLinkRef } from '@/utils/references'

export const CONTEXT_KINDS = [
  'file',
  'folder',
  'image',
  'browser-selection',
  'canvas-element',
  'code-symbol',
  'office-paragraph',
  'command-output',
  'web-link',
] as const

export type ContextKind = typeof CONTEXT_KINDS[number]

export const MAX_CONTEXT_ITEMS = 20
export const MAX_CONTEXT_TEXT = 8_000

export interface ContextItem {
  id: string
  kind: ContextKind
  label: string
  sessionId: string
  createdAt: number
  /** 文件路径 / 图片路径。 */
  path?: string
  /** 网页或链接地址。 */
  url?: string
  /** 被引用的正文、选区、元素摘要或命令输出。 */
  text?: string
  /** 来源细节（选择器、工作表名、画板名等），只用于展示与提示模型。 */
  meta?: Record<string, string>
}

export interface ContextSnapshot {
  version: 1
  sessionId: string
  savedAt: number
  items: ContextItem[]
}

export interface ContextStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function clip(value: string, limit = MAX_CONTEXT_TEXT): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n…（已截断 ${value.length - limit} 字符）`
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeMeta(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    out[key.slice(0, 40)] = raw.slice(0, 500)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 归一化一个引用；返回 null 表示"这条不该进对话"（缺来源或缺正文）。
 * id 由 kind + 来源 + 文本指纹生成，相同内容重复引用会去重。
 */
export function normalizeContextItem(raw: unknown, sessionId: string): ContextItem | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const kind = CONTEXT_KINDS.includes(record.kind as ContextKind) ? record.kind as ContextKind : null
  if (!kind) return null
  const label = asString(record.label)?.slice(0, 160)
  if (!label) return null
  const path = asString(record.path)
  const url = asString(record.url)
  const text = asString(record.text)
  if (!path && !url && !text) return null
  const meta = normalizeMeta(record.meta)
  const identity = `${kind}|${path ?? ''}|${url ?? ''}|${text ?? ''}|${meta ? JSON.stringify(meta) : ''}`
  return {
    id: `ctx_${shortHash(identity)}`,
    kind,
    label,
    sessionId,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(text ? { text: clip(text) } : {}),
    ...(meta ? { meta } : {}),
  }
}

/** 合并引用：新到先入列，超过 20 条丢最早；id 相同不重复。 */
export function mergeContextItems(existing: ContextItem[], incoming: ContextItem | null): ContextItem[] {
  if (!incoming) return existing
  if (existing.some((item) => item.id === incoming.id)) return existing
  return [...existing, incoming].slice(-MAX_CONTEXT_ITEMS)
}

export function removeContextItem(items: ContextItem[], id: string): ContextItem[] {
  return items.filter((item) => item.id !== id)
}

/** 给模型看的来源头 + 正文。 */
export function contextItemBody(item: ContextItem): string {
  const lines: string[] = [`[工作台上下文] ${item.label}`, `来源：${kindLabel(item.kind)}`]
  if (item.path) lines.push(`路径：${item.path}`)
  if (item.url) lines.push(`地址：${item.url}`)
  if (item.meta) {
    for (const [key, value] of Object.entries(item.meta)) lines.push(`${key}：${value}`)
  }
  if (item.text) lines.push('', item.text)
  return lines.join('\n')
}

export function kindLabel(kind: ContextKind): string {
  switch (kind) {
    case 'file': return '工作区文件'
    case 'folder': return '工作区文件夹'
    case 'image': return '图片'
    case 'browser-selection': return '内置浏览器页面/选区'
    case 'canvas-element': return '设计画布元素'
    case 'code-symbol': return '代码符号'
    case 'office-paragraph': return 'Office 文档内容'
    case 'command-output': return '命令输出'
    case 'web-link': return '网页链接'
    default: return kind
  }
}

/**
 * 转成对话引用。文件/文件夹/链接继续用现有原生类型（后端与 chip 已支持），
 * 其余统一用 `context` 类型，正文放进 text，模型能直接读到。
 */
export function contextItemToRef(item: ContextItem): ParsedRef {
  if (item.kind === 'file' && item.path) {
    return { type: 'file', label: item.label, path: item.path } as ParsedRef
  }
  if (item.kind === 'folder' && item.path) {
    return { type: 'folder', label: item.label, path: item.path } as FolderRef as ParsedRef
  }
  if (item.kind === 'web-link' && item.url) {
    try {
      const parsed = new URL(item.url)
      return { type: 'web_link', label: item.label, url: item.url, domain: parsed.hostname } as WebLinkRef as ParsedRef
    } catch {
      /* 落回 context */
    }
  }
  if (item.kind === 'image' && item.path && item.meta?.preview) {
    return { type: 'image', label: item.label, path: item.path, preview: item.meta.preview } as ImageRef as ParsedRef
  }
  return {
    type: 'context',
    label: item.label,
    kind: item.kind,
    text: contextItemBody(item),
    ...(item.path ? { path: item.path } : {}),
    ...(item.url ? { url: item.url } : {}),
  } as ParsedRef
}

export function contextItemsToRefs(items: ContextItem[]): ParsedRef[] {
  const seen = new Set<string>()
  const refs: ParsedRef[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    refs.push(contextItemToRef(item))
  }
  return refs
}

export function contextSnapshotKey(sessionId: string): string {
  return `maxma.context.${sessionId}`
}

export function saveContextSnapshot(storage: ContextStorage, sessionId: string, items: ContextItem[]): void {
  try {
    const snapshot: ContextSnapshot = { version: 1, sessionId, savedAt: Date.now(), items }
    if (items.length === 0) storage.removeItem(contextSnapshotKey(sessionId))
    else storage.setItem(contextSnapshotKey(sessionId), JSON.stringify(snapshot))
  } catch {
    // 存储不可用（隐私模式/配额满）时只丢快照，不影响当前对话。
  }
}

export function loadContextSnapshot(storage: ContextStorage, sessionId: string): ContextItem[] {
  try {
    const raw = storage.getItem(contextSnapshotKey(sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<ContextSnapshot>
    if (parsed.version !== 1 || parsed.sessionId !== sessionId || !Array.isArray(parsed.items)) return []
    const restored: ContextItem[] = []
    for (const rawItem of parsed.items) {
      const item = normalizeContextItem(rawItem, sessionId)
      if (item) restored.push(item)
    }
    return restored.slice(-MAX_CONTEXT_ITEMS)
  } catch {
    return []
  }
}

export function clearContextSnapshot(storage: ContextStorage, sessionId: string): void {
  try { storage.removeItem(contextSnapshotKey(sessionId)) } catch { /* 同上 */ }
}
