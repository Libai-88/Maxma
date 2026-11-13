/**
 * stores/extensionUi.ts — 扩展对话框队列（EXT-UI-001）。
 *
 * pi 扩展通过 `ctx.ui.select/confirm/input/editor` 请求用户交互。kernel 把它转成
 * `extension_ui_request` WS 帧，这里排队并交给 `ExtensionPromptDialog` 渲染；
 * 用户答复后由调用方发 `extension_ui_response`。
 *
 * ## 为什么单独一个 store，不塞进 chat channel
 *
 * 扩展对话框是**全局模态**：它不属于某一轮对话，也不该被回合切换清掉。
 * 审批卡（ask_user）挂在具体工具调用上，语义是"这次调用能不能跑"；
 * 扩展对话框语义是"这个扩展想问你一件事"。两者生命周期不同，混放会互相干扰。
 *
 * ## 为什么是队列
 *
 * pi 允许扩展嵌套/并发请求（`ExtensionRunner.withUIPrompt` 会合并外层区间）。
 * 一次只显示一个，答复后自动出下一个。
 */

import { create } from 'zustand'

import type { ExtensionUiRequestEvent } from '@/types'

export type ExtensionUiRequest = ExtensionUiRequestEvent['payload']

/** 前端回给后端的应答体（与 kernel `ExtensionUiReply` 同形）。 */
export interface ExtensionUiReply {
  value?: string
  confirmed?: boolean
  cancelled?: boolean
}

interface ExtensionUiState {
  /** 待处理的对话框（FIFO）。 */
  queue: ExtensionUiRequest[]
  /** 当前展示的那条（= queue[0]）。 */
  current: () => ExtensionUiRequest | null
  /** 收到一条扩展请求。notify 不入队，直接弹 toast。 */
  push: (req: ExtensionUiRequest) => void
  /** 弹出队首并返回（用户答复后调用）。 */
  shift: () => ExtensionUiRequest | null
  /** 清空（会话切换/断线时）。 */
  clear: () => void
}

export const useExtensionUiStore = create<ExtensionUiState>((set, get) => ({
  queue: [],

  current: () => get().queue[0] ?? null,

  push: (req) => {
    set((s) => ({ queue: [...s.queue, req] }))
  },

  shift: () => {
    const [head, ...rest] = get().queue
    set({ queue: rest })
    return head ?? null
  },

  clear: () => set({ queue: [] }),
}))
