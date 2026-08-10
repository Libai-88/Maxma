/**
 * clipboard.ts — 安全剪贴板写入。
 *
 * COMPAT-CLIPBOARD-001：navigator.clipboard.writeText 在 WebView2 窗口
 * 失焦/权限被拒时 Promise reject（未捕获 → unhandledrejection → 全局
 * 错误 toast）；Safari 需用户手势。统一走 try/catch + execCommand 兜底
 * （与 ChatWindow.vue 既有实现对齐），任何环境都不抛未处理异常。
 */

/** 复制文本到剪贴板。返回是否成功（失败时静默，不抛异常）。 */
export async function safeCopyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 降级到 execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
