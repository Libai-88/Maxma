/**
 * stores/sessionTabs.ts — 并行会话标签（P3）。
 *
 * 最多 3 个 live tab。切换 tab 不销毁 useChat 通道：后台流式输出继续收，
 * 回来时从同一 channel 读。存储只记 id，标题从 session store 派生。
 */

import { create } from 'zustand'
import { safeGetItem, safeSetItem } from '@/lib/storage'

const STORAGE_KEY = 'maxmahere.session-tabs.v1'
export const MAX_SESSION_TABS = 3

export function parseTabIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, MAX_SESSION_TABS)
  } catch {
    return []
  }
}

export function pushTabId(ids: string[], id: string): string[] {
  if (!id) return ids
  if (ids[0] === id) return ids
  return [id, ...ids.filter((item) => item !== id)].slice(0, MAX_SESSION_TABS)
}

function readInitial(): string[] {
  return parseTabIds(safeGetItem(STORAGE_KEY))
}

function persist(ids: string[]) {
  safeSetItem(STORAGE_KEY, JSON.stringify(ids))
}

interface SessionTabsState {
  ids: string[]
  open: (id: string) => void
  close: (id: string) => void
}

export const useSessionTabs = create<SessionTabsState>()((set, get) => ({
  ids: readInitial(),
  open: (id) => {
    if (!id) return
    const current = get().ids
    if (current[0] === id) return
    const next = pushTabId(current, id)
    persist(next)
    set({ ids: next })
  },
  close: (id) => {
    const next = get().ids.filter((item) => item !== id)
    persist(next)
    set({ ids: next })
  },
}))
