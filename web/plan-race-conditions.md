# 计划：修复前端数据加载竞态条件

## 检查结果

### SkillsView.vue (`D:/Maxma/MaxmaHere/web/src/views/SkillsView.vue`)
- **状态**: 已有完整竞态保护
- `loadSeq` 在 `loadData()` 中用于列表加载
- `editSeq` 在 `startEdit()` 中用于编辑详情的加载
- `onUnmounted` 中：递增 `loadSeq` / `editSeq` + 清除所有 setTimeout
- `schedule()` 统一管理延迟操作
- ✅ **无需修改**

### McpView.vue (`D:/Maxma/MaxmaHere/web/src/views/McpView.vue`)
- **状态**: 存在竞态漏洞
- `loadServers()` **缺少 `loadSeq` 保护** — 快速切换视图再回来，旧 promise 会覆盖新数据
- `loadDiscovered()` **缺少 `loadSeq` 保护** — 同上
- `onUnmounted` 只清除了 timers，但**没有递增序列号**来废弃未完成的请求
- `editSeq` 仅保护了编辑流程，列表加载未被保护
- ❌ **需要修复**

### ProvidersView.vue (`D:/Maxma/MaxmaHere/web/src/views/ProvidersView.vue`)
- **状态**: 通过 Pinia store 间接安全
- 数据来自 `providerStore` 的 computed，store 是单例，组件卸载重挂时不会出现"更新已卸载组件状态"
- 但 `handleDiscover()` / `handleTest()` 等用户触发的操作没有 loadSeq 保护（非 onMounted 异步，风险较低）
- ⚠️ **无需修改 onMounted 竞态，但建议改进**（非必须）

### PlaygroundView.vue (`D:/Maxma/MaxmaHere/web/src/views/PlaygroundView.vue`)
- **状态**: 无异步请求，纯客户端 mock 数据
- ✅ **无需修改**

## 修复方案

### McpView.vue

**修改 1**: 添加 `loadSeq` 全局变量
```typescript
let loadSeq = 0
```

**修改 2**: 在 `loadServers()` 中添加 loadSeq 保护
```typescript
async function loadServers() {
  const mySeq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const res = await api.listMcpServers()
    if (mySeq !== loadSeq) return
    servers.value = (res.servers || []) as MCPServerConfig[]
  } catch (e: unknown) {
    if (mySeq !== loadSeq) return
    loadError.value = toErrorMessage(e)
  } finally {
    if (mySeq === loadSeq) {
      loading.value = false
    }
  }
}
```

**修改 3**: 在 `loadDiscovered()` 中添加 loadSeq 保护
```typescript
async function loadDiscovered() {
  const mySeq = ++loadSeq
  try {
    const res = await fetch('/api/mcp/discovered')
    const data: unknown = await res.json()
    if (mySeq !== loadSeq) return
    discoveredServers.value = Array.isArray(data) ? (data as DiscoveredServer[]) : []
  } catch {
    if (mySeq !== loadSeq) return
    discoveredServers.value = []
  }
}
```

**修改 4**: 在 `onUnmounted` 中递增 `loadSeq`
```typescript
onUnmounted(() => {
  loadSeq++  // 废弃未完成的请求
  while (timers.length) {
    window.clearTimeout(timers.pop())
  }
})
```

## 验证
- 运行 `npx vue-tsc --noEmit` 检查类型
