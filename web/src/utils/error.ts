/**
 * 将 unknown 类型的 catch 值收敛为可读字符串。
 *
 * 用法：
 * ```ts
 * try { ... } catch (e: unknown) {
 *   setError(toErrorMessage(e))
 * }
 * ```
 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return String(e)
}
