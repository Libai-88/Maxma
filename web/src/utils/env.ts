/**
 * 运行时环境检测 + Tauri-aware fetch 包装器。
 *
 * WebView2 不允许从 tauri://localhost 向 http:// 发起原生 fetch()，
 * 因此 Tauri 环境下使用 @tauri-apps/plugin-http（经 Rust reqwest 发出请求）。
 * 浏览器环境下使用原生 fetch，行为不变。
 */

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'

/** 默认后端端口（与 main.py uvicorn.run 保持一致） */
const DEFAULT_API_PORT = 8000

/** 运行时端口（Tauri 端口冲突回退时由 ensurePortLoaded() 动态更新） */
let runtimeApiPort: number = Number(import.meta.env.VITE_MAXMA_API_PORT) || DEFAULT_API_PORT
let portLoaded = false
let portLoadPromise: Promise<void> | null = null

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

/**
 * 在 Tauri 环境下从后端 Rust 命令获取实际监听端口。
 *
 * Tauri 启动时若默认端口 8000 被占用，会自动回退到 8001-8010。
 * 前端必须调用此函数获取真实端口，否则会连到错误端口。
 * 浏览器环境下此函数为空操作。
 *
 * 失败时自动重试（最多 5 次，每次间隔 1 秒），因为 Tauri 主进程可能在
 * setup 阶段还未完成端口注册。
 */
export async function ensurePortLoaded(): Promise<void> {
  if (!detectTauri() || portLoaded) return
  if (!portLoadPromise) {
    portLoadPromise = (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        // 重试 5 次，每次间隔 1 秒
        for (let attempt = 1; attempt <= 5; attempt++) {
          try {
            const port = await invoke<number>('get_api_port')
            if (typeof port === 'number' && port > 0) {
              runtimeApiPort = port
              console.log('[env] runtime api port:', port)
              break
            }
          } catch (e) {
            console.warn(`[env] get_api_port attempt ${attempt}/5 failed:`, e)
            if (attempt < 5) {
              await new Promise(resolve => setTimeout(resolve, 1000))
            }
          }
        }
      } catch (e) {
        console.warn('[env] failed to load runtime port, using default:', e)
      } finally {
        portLoaded = true
        portLoadPromise = null
      }
    })()
  }
  await portLoadPromise
}

/**
 * 检查后端健康状态（带重试）。
 * 在 Tauri 环境下，sidecar 启动可能需要 30-90 秒（PyInstaller onefile 解压 +
 * 数据库加载），此函数会反复重试直到后端就绪或超时。
 *
 * @param maxAttempts 最大重试次数（默认 30 次，每次间隔 2 秒，共 60 秒）
 * @param intervalMs 重试间隔（毫秒，默认 2000）
 * @returns true 如果后端就绪，false 如果超时
 */
export async function waitForBackend(
  maxAttempts: number = 30,
  intervalMs: number = 2000,
): Promise<boolean> {
  await ensurePortLoaded()
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = `${getApiBase()}/health`
      const resp = await tauriFetch(url, { method: 'GET' })
      if (resp.ok) {
        console.log(`[env] backend ready (attempt ${attempt})`)
        return true
      }
    } catch (e) {
      if (attempt === 1 || attempt % 5 === 0) {
        console.log(`[env] waiting for backend (attempt ${attempt}/${maxAttempts})`)
      }
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }
  console.warn(`[env] backend not ready after ${maxAttempts} attempts`)
  return false
}

/** 当前生效的 API 端口 */
function currentApiPort(): number {
  return runtimeApiPort
}

/** 所有 HTTP API 请求的基础路径 */
export function getApiBase(): string {
  return detectTauri() ? `http://127.0.0.1:${currentApiPort()}/api` : '/api'
}

/** 后端原始地址（不含 /api 前缀，用于非 API 路径如 /api/upload → 上传使用 getApiBase） */
export function getBackendOrigin(): string {
  return detectTauri() ? `http://127.0.0.1:${currentApiPort()}` : ''
}

/** WebSocket 基础路径（不含 /ws/chat/... 后缀） */
export function getWsBase(): string {
  return detectTauri()
    ? `ws://127.0.0.1:${currentApiPort()}`
    : `ws://127.0.0.1:${currentApiPort()}`
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
