# 修复计划：api/index.ts 路径编码与错误处理一致性

## 范围
文件：`D:\Maxma\MaxmaHere\web\src\api\index.ts`

---

## 修改 1：为 9 个方法添加 `encodeURIComponent` 编码

在 URL 路径中拼接 `sessionId`/`id` 参数时包裹 `encodeURIComponent()`，防止特殊字符破坏 URL。

| # | 方法 | 当前代码 (行) | 修改后 |
|---|------|--------------|--------|
| 1 | `getSession` | 182: `` `/sessions/${id}` `` | `` `/sessions/${encodeURIComponent(id)}` `` |
| 2 | `getMessages` | 185: `` `/sessions/${id}/messages` `` | `` `/sessions/${encodeURIComponent(id)}/messages` `` |
| 3 | `deleteSession` | 188: `` `/sessions/${id}` `` | `` `/sessions/${encodeURIComponent(id)}` `` |
| 4 | `getContextUsage` | 265: `` `/sessions/${sessionId}/context-usage` `` | `` `/sessions/${encodeURIComponent(sessionId)}/context-usage` `` |
| 5 | `undoMessages` | 268: `` `/sessions/${sessionId}/undo?n=${n}` `` | `` `/sessions/${encodeURIComponent(sessionId)}/undo?n=${n}` `` |
| 6 | `compressSession` | 278: `` `/sessions/${sessionId}/compress` `` | `` `/sessions/${encodeURIComponent(sessionId)}/compress` `` |
| 7 | `constifySession` | 407: `` `/sessions/${id}/const` `` | `` `/sessions/${encodeURIComponent(id)}/const` `` |
| 8 | `unconstifySession` | 413: `` `/sessions/${id}/const` `` | `` `/sessions/${encodeURIComponent(id)}/const` `` |
| 9 | `generateSessionTitle` | 416: `` `/sessions/${id}/generate-title` `` | `` `/sessions/${encodeURIComponent(id)}/generate-title` `` |

不需要修改的方法（已使用 `encodeURIComponent` 或无 sessionId 参数）：
- `getSessionPermissionMode` (190-193)
- `setSessionPermissionMode` (195-202)
- `listDeferredRuns` (205-206)
- `getDeferredRun` (208-211)
- `cancelDeferredRun` (213-217)
- `listWorkflowRuns` (223-224)
- `startWorkflow` (226-228)
- `getWorkflowRun` (232-235)
- `cancelWorkflowRun` (237-240)
- `resumeWorkflowRun` (243-246)
- `getNarrative` (249-250) — 无 sessionId 参数
- `getMoment` (252-253) — 无 sessionId 参数

---

## 修改 2：参数名统一 (`id` → `sessionId`)

| # | 方法 | 当前签名 (行) | 修改后 |
|---|------|--------------|--------|
| 1 | `constifySession` | 406: `(id: string, name: string)` | `(sessionId: string, name: string)` |
| 2 | `unconstifySession` | 412: `(id: string)` | `(sessionId: string)` |
| 3 | `generateSessionTitle` | 415: `(id: string)` | `(sessionId: string)` |

相应地，修改 1 中这 3 个方法的 URL 模板变量也要从 `${id}` 改为 `${sessionId}`（尽管编码后效果相同，但保持参数名语义一致）。

---

## 修改 3：统一 `uploadImage` 与 `uploadKbDocument` 的错误处理

**现状：** `uploadImage` (153-172) 和 `uploadKbDocument` (616-624) 直接抛出 `new Error(\`...失败: ${res.status}\`)`，没有尝试解析服务端返回的 `body.detail`，而通用 `request()` 函数做了此处理。

**修改方案：** 让这两个函数在请求失败时也尝试解析响应 body 中的 `detail` 字段，提供更丰富的错误信息。

### `uploadImage` (行 ~153-172)

修改后逻辑：
```typescript
if (!res.ok) {
  let detail = `图片上传失败: ${res.status}`
  try {
    const body = await res.json()
    if (body.detail) detail += `: ${body.detail}`
  } catch { /* ignore */ }
  throw new Error(detail)
}
```

### `uploadKbDocument` (行 ~616-624)

修改后逻辑（保持链式风格或改为 async/await）：
如果保持链式 `.then()`：
```typescript
return tauriFetch(...)
  .then(async res => {
    if (!res.ok) {
      let detail = `上传失败: ${res.status}`
      try {
        const body = await res.json()
        if (body.detail) detail += `: ${body.detail}`
      } catch { /* ignore */ }
      throw new Error(detail)
    }
    return res.json()
  })
```

---

## 修改顺序

1. 修改 1：9 处添加 `encodeURIComponent`（使用 Edit 逐行替换）
2. 修改 2：3 处参数名统一（使用 Edit 逐行替换）
3. 修改 3：2 处错误处理增强（使用 Edit 逐块替换）

## 验证

执行 `npx vue-tsc --noEmit` 确认 TypeScript 编译通过。
