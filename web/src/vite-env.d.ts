/// <reference types="vite/client" />

/** Tauri v2 在 WebView 中注入的全局对象 */
interface Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  }
}

/** Vite 编译期注入的 API Token（桌面端为空字符串） */
declare const __API_TOKEN__: string
