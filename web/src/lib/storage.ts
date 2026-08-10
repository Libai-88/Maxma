/**
 * storage.ts — localStorage 安全访问包装。
 *
 * COMPAT-STORAGE-001：Safari「阻止所有 Cookie」/Firefox 严格隐私模式/
 * 被禁用的 WebView2 中，访问 localStorage 属性本身即抛 SecurityError，
 * 写入时抛 QuotaExceededError。此前 useChat.ts 在模块加载期直接
 * `localStorage.length`（存储不可用时整个应用白屏无法启动）、
 * session.ts 的 `setItem` 无保护（首次启动路径崩溃）。
 * 所有读写统一走本模块，存储不可用时静默降级为"无持久化"。
 */

/** 访问 localStorage 是否可用（惰性探测，访问属性本身也会抛异常） */
let _storageAvailable: boolean | null = null

function storage(): Storage | null {
  if (_storageAvailable !== null) return _storageAvailable ? (globalThis.localStorage ?? null) : null
  try {
    const probe = '__maxma_storage_probe__'
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    _storageAvailable = true
  } catch {
    _storageAvailable = false
  }
  return _storageAvailable ? (globalThis.localStorage ?? null) : null
}

/** 安全读取；存储不可用或值不存在时返回 null。 */
export function safeGetItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 安全写入；存储不可用/配额超限时静默失败（返回 false）。 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    storage()?.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 安全删除；存储不可用时静默。 */
export function safeRemoveItem(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    // 静默
  }
}

/** 安全枚举键；存储不可用时返回空数组。 */
export function safeKeys(): string[] {
  try {
    const s = storage()
    if (!s) return []
    const keys: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k !== null) keys.push(k)
    }
    return keys
  } catch {
    return []
  }
}
