/**
 * toast.ts — 全局用户反馈通道（UX-TOAST-001）。
 *
 * 此前成功操作（日志已保存/日志已清理）也走 maxma:error 事件、以红色错误
 * 样式展示，语义完全错乱；失败操作则常常完全静默。统一为 maxma:toast 事件，
 * 携带 level 让 App.vue 按语义路由到对应 toast 样式；maxma:error 保留兼容
 * （映射为 error 级别）。
 */

export type ToastLevel = 'info' | 'success' | 'error' | 'warning'

export interface ToastDetail {
  message: string
  level?: ToastLevel
  duration?: number
}

/** 派发一条语义正确的全局 toast 通知。 */
export function showToast(message: string, level: ToastLevel = 'info', duration?: number): void {
  window.dispatchEvent(new CustomEvent('maxma:toast', {
    detail: { message, level, duration } satisfies ToastDetail,
  }))
}

/** 兼容旧调用：成功类通知（避免误用 error 语义）。 */
export function showSuccess(message: string, duration?: number): void {
  showToast(message, 'success', duration)
}

/** 兼容旧调用：失败类通知。 */
export function showError(message: string, duration?: number): void {
  showToast(message, 'error', duration)
}
