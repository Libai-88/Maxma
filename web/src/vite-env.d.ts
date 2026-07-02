/// <reference types="vite/client" />

/** Tauri v2 在 WebView 中注入的全局对象 */
interface Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  }
}
