/* web/src/composables/useConfirm.ts
 * 全局确认对话框 — 替代 window.confirm 的品牌化方案
 * 用法：const ok = await confirmAction({ message: '确定删除？', danger: true })
 */
import { reactive } from 'vue'

export interface ConfirmOptions {
  /** 对话框标题（默认"请确认"） */
  title?: string
  /** 正文内容 */
  message: string
  /** 确认按钮文字（默认"确定"） */
  confirmText?: string
  /** 取消按钮文字（默认"取消"） */
  cancelText?: string
  /** 危险操作：确认按钮使用红色填充样式 */
  danger?: boolean
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  resolve: ((ok: boolean) => void) | null
}

const state = reactive<ConfirmState>({
  visible: false,
  options: { message: '' },
  resolve: null,
})

/** 弹出确认对话框，返回 Promise<boolean>（确认=true，取消/关闭=false） */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
  // 若已有对话框打开（极端并发），先以 false 结束上一个
  if (state.resolve) {
    state.resolve(false)
    state.resolve = null
  }
  state.options = opts
  state.visible = true
  return new Promise<boolean>(resolve => {
    state.resolve = resolve
  })
}

/** 供 ConfirmDialog 组件内部使用 */
export function useConfirmDialog() {
  function respond(ok: boolean) {
    state.visible = false
    state.resolve?.(ok)
    state.resolve = null
  }
  return { state, respond }
}
