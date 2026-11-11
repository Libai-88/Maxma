/** 全局用户反馈通道：派发 maxma:toast，由 AppShell 的 Toaster 按 level 渲染。 */
export type ToastLevel = 'info' | 'success' | 'error' | 'warning'

export interface ToastDetail {
  message: string
  level?: ToastLevel
  duration?: number
}

export function showToast(message: string, level: ToastLevel = 'info', duration?: number): void {
  window.dispatchEvent(new CustomEvent('maxma:toast', {
    detail: { message, level, duration } satisfies ToastDetail,
  }))
}

export function showSuccess(message: string, duration?: number): void {
  showToast(message, 'success', duration)
}

export function showError(message: string, duration?: number): void {
  showToast(message, 'error', duration)
}
