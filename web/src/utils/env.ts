/**
 * 运行时环境检测 + Tauri-aware fetch 包装器。
 *
 * WebView2 不允许从 tauri://localhost 向 http:// 发起原生 fetch()，
 * 因此 Tauri 环境下使用 @tauri-apps/plugin-http（经 Rust reqwest 发出请求）。
 * 浏览器环境下使用原生 fetch，行为不变。
 */

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'

/** Tauri 桌面端后端地址（与 main.py uvicorn.run 保持一致）。
 *  优先读取 Vite 环境变量，fallback 为默认端口 8000。 */
const DEFAULT_API_PORT = 8000
const apiPort = Number(import.meta.env.VITE_MAXMA_API_PORT) || DEFAULT_API_PORT
const TAURI_HTTP = `http://127.0.0.1:${apiPort}`
const TAURI_WS = `ws://127.0.0.1:${apiPort}`

/** 实时检测是否在 Tauri WebView 中运行 */
function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__
}

/** True when running inside a Tauri v2 WebView.
 * 注意：必须调用 isTauri() 而非直接引用，Proxy 对象永远 truthy。
 */
export function isTauri(): boolean {
  return detectTauri()
}

/** 所有 HTTP API 请求的基础路径 */
export function getApiBase(): string {
  return detectTauri() ? `${TAURI_HTTP}/api` : '/api'
}

/** WebSocket 基础路径（不含 /ws/chat/... 后缀） */
export function getWsBase(): string {
  return detectTauri()
    ? TAURI_WS
    : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
}

/**
 * 跨环境 fetch — Tauri 走 plugin-http（Rust reqwest），浏览器走原生 fetch。
 * 接口与原生 fetch 完全一致，可直接替换。
 */
export function tauriFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (detectTauri()) {
    return tauriHttpFetch(input, init)
  }
  return fetch(input, init)
}

/**
 * 在系统浏览器中打开外部链接。
 * Tauri 环境下通过 shell 插件打开，浏览器环境下用 window.open。
 */
export function openExternal(url: string): void {
  if (detectTauri() && (window as any).__TAURI_INTERNALS__) {
    ;(window as any).__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: url })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
