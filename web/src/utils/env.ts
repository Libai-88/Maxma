/**
 * 运行时环境工具：后端基址、健康轮询、外链打开、UUID 生成。
 *
 * 两种已发布形态都是同源 HTTP 页面 —— Web 便携包由后端直接托管
 * web/dist，Electron 壳（desktop/electron/main.cjs，sandbox:true、无 preload）
 * 加载的也是后端自身 origin。因此 API/WS 一律用相对路径 + location.host，
 * 原生 fetch 即可；上一代桌面壳的 IPC 探测与 Rust HTTP 代理层已随壳一并移除。
 */

/**
 * 检查后端健康状态（带重试）。
 * 便携包冷启动时后端需要完成数据目录准备与引擎加载，可能耗时数十秒，
 * 此函数会反复重试直到后端就绪或超时。
 *
 * @param maxAttempts 最大重试次数（默认 45 次，每次间隔 2 秒，共 90 秒 — 覆盖后端最大启动时间）
 * @param intervalMs 重试间隔（毫秒，默认 2000）
 * @returns true 如果后端就绪，false 如果超时
 */
export async function waitForBackend(
  maxAttempts: number = 45,
  intervalMs: number = 2000,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const url = `${getApiBase()}/health`
      const resp = await fetch(url, { method: 'GET' })
      if (resp.ok) {
        return true
      }
    } catch {
      // Backend not ready yet; retry on next iteration.
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }
  return false
}

/** 所有 HTTP API 请求的基础路径（同源相对路径：开发期走 Vite 代理，生产由后端直供） */
export function getApiBase(): string {
  return '/api'
}

/** 后端 origin（同源形态下恒为空串，拼接结果即相对路径，用于 /api 前缀之外的路径） */
export function getBackendOrigin(): string {
  return ''
}

/** WebSocket 基础路径（不含 /ws/chat/... 后缀），与页面同源 */
export function getWsBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}`
}

/**
 * 安全的 URL 协议白名单 — 只允许 HTTP/HTTPS/mailto 等安全协议。
 * 禁止 javascript: data: vbscript: file: 等危险协议。
 */
const ALLOWED_PROTOCOLS = /^(https?:|mailto:|tel:|sms:)/i

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_PROTOCOLS.test(parsed.protocol)
  } catch {
    // URL 解析失败（如相对路径）视为不安全
    return false
  }
}

/**
 * 在新标签页打开外部链接（两种形态都是普通 HTTP 页面，直接用 window.open）。
 * 对 javascript: data: 等危险协议直接拒绝。
 */
export function openExternal(url: string): void {
  if (!isSafeUrl(url)) {
    console.warn('[env] 拒绝打开不安全的 URL:', url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * 安全地生成 UUID v4。
 * 优先使用 crypto.randomUUID()，在不支持的旧环境（非 HTTPS、旧浏览器）中
 * 回退到 crypto.getRandomValues() 手动构造，保证始终可用。
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 降级方案：使用 crypto.getRandomValues 构造 UUID v4
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    // UUID v4: 版本位 4 (第 7-8 字节), 变体位 10xx (第 9 字节)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // 终极降级：Math.random（极低概率碰撞，仅用于无法使用 crypto 的极端环境）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
