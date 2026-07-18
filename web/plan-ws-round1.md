# plan-ws-round1: 修复 Token 刷新竞态条件

## 问题 1：`resetToken()` 与 `ensureTokenLoaded()` 竞态条件

**位置：** `D:\Maxma\MaxmaHere\web\src\api/index.ts`

**场景：** 当 `resetToken()` 在 `ensureTokenLoaded()` 的异步请求**执行期间**被调用时：

1. `resetToken()` 将 `tokenLoadPromise` 设为 `null`
2. 旧 `ensureTokenLoaded()` 请求完成后，其 `finally` 块也会执行 `tokenLoadPromise = null`
3. 如果在旧请求的 `finally` 执行前，有新的 `ensureTokenLoaded()` 调用到达：
   - `tokenFetchedAtRuntime` 为 `false`，所以继续执行
   - `tokenLoadPromise` 为 `null`（被 resetToken 清空），所以创建一个新 Promise
   - 但旧 `finally` 块随后执行，将新创建的 `tokenLoadPromise` 也清空为 `null`
   - 新调用的 `await tokenLoadPromise` 等待到的是一个已经被清空的变量，后续调用可能重复创建多个 Promise

**修复方案：引入版本号计数器，防止 finally 块误清除后续创建的 Promise**

```typescript
let tokenLoadVersion = 0  // 新增

export function resetToken(): void {
  tokenFetchedAtRuntime = false
  token = ''
  tokenLoadVersion++       // 标记版本变化
  tokenLoadPromise = null
}

export async function ensureTokenLoaded(): Promise<void> {
  if (tokenFetchedAtRuntime) return
  if (!tokenLoadPromise) {
    const myVersion = tokenLoadVersion     // 记录创建时的版本
    tokenLoadPromise = (async () => {
      try {
        await ensurePortLoaded()
        BASE = getApiBase()
        const res = await tauriFetch(`${BASE}/auth/token`)
        if (res.ok) {
          const data = await res.json()
          token = data.token || ''
          tokenFetchedAtRuntime = true
          console.log('[api] Token acquired at runtime')
        }
      } catch (e) {
        console.warn('[api] Failed to fetch token at runtime:', e)
      } finally {
        // 只在版本未变化时清除 promise（即 resetToken 未被调用过）
        if (tokenLoadVersion === myVersion) {
          tokenLoadPromise = null
        }
      }
    })()
  }
  await tokenLoadPromise
}
```

## 问题 2：WebSocket 重连时 Token 刷新延迟

**位置：** `D:\Maxma\MaxmaHere\web\src\composables\useChat.ts`

**结论：不做修改。** 当前 `tokenLoadPromise` 机制已防止并发 token 获取。`onclose(4001)` → `resetToken()` → 退避延迟 → `connectSession()` → `ensureTokenLoaded()` 链路正确。问题 1 修复后，WebSocket 重连路径自然受益。

## 执行步骤

1. 修改 `D:\Maxma\MaxmaHere\web\src\api/index.ts`：
   - 添加 `let tokenLoadVersion = 0`
   - 修改 `resetToken()`：增加 `tokenLoadVersion++`
   - 修改 `ensureTokenLoaded()`：在创建 promise 时捕获版本，finally 中检查版本匹配
2. 运行 `npx vue-tsc --noEmit` 验证 TypeScript 编译通过
3. 打印修改摘要
