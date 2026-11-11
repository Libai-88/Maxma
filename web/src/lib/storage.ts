/**
 * storage.ts — localStorage 安全访问包装。
 *
 * Safari「阻止所有 Cookie」/Firefox 严格隐私模式/被禁用的 WebView2 中，
 * 访问 localStorage 属性本身即抛 SecurityError。所有读写统一走本模块，
 * 存储不可用时静默降级为「无持久化」。
 */
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

export function safeGetItem(key: string): string | null {
  try { return storage()?.getItem(key) ?? null } catch { return null }
}

export function safeSetItem(key: string, value: string): boolean {
  try { storage()?.setItem(key, value); return true } catch { return false }
}

export function safeRemoveItem(key: string): void {
  try { storage()?.removeItem(key) } catch { /* 静默 */ }
}

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
  } catch { return [] }
}
