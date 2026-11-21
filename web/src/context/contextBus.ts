/**
 * web/src/context/contextBus.ts — 面板 → 输入框的窄事件桥（C5）。
 *
 * 工作台面板不持有 ChatInput 状态，统一用 CustomEvent 把 ContextItem 交给
 * 当前会话输入框；输入框按 sessionId 过滤，QuickChat/别的会话不会收到。
 */

import type { ContextItem } from './contextItems'

export const ADD_CONTEXT_EVENT = 'maxma:add-context'

export interface AddContextDetail {
  item: ContextItem
}

export function emitContextItem(item: ContextItem): void {
  window.dispatchEvent(new CustomEvent<AddContextDetail>(ADD_CONTEXT_EVENT, { detail: { item } }))
}

export function subscribeContextItems(
  sessionId: string | undefined,
  handler: (item: ContextItem) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AddContextDetail>).detail
    const item = detail?.item
    if (!item) return
    // 只收当前会话的引用；未指定会话（QuickChat）按空字符串严格匹配。
    if ((item.sessionId ?? '') !== (sessionId ?? '')) return
    handler(item)
  }
  window.addEventListener(ADD_CONTEXT_EVENT, listener)
  return () => window.removeEventListener(ADD_CONTEXT_EVENT, listener)
}
