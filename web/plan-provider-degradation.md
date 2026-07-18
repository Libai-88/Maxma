# Plan: Provider 配置页加载失败降级处理

## 问题分析

### 当前状态

**`provider.ts` (store)**:
- `loadProviders()` 使用 try-catch 包裹，内部重试 3 次后仍失败时仅 `console.warn`，**不向外抛出错误**
- `loaded` ref 只在成功时设为 `true`，失败时保持 `false`
- 没有暴露错误信息给消费方

**`ProvidersView.vue`**:
- 模板已存在 `loadError` 分支（显示错误 + 重试按钮）
- `loadProviders()` 函数直接 `await providerStore.loadProviders()`，不检查结果
- `retryLoad()` 使用 `try-catch` 包裹 `providerStore.refresh()`，但 `refresh()` 内部也吞掉了所有异常，catch 分支从不执行
- `loadError` ref 初始为 `''`，从未在初始加载流程中被赋值

### 关键发现

当 `/api/providers` 返回 500 时：
1. Store 内部 catch -> console.warn，不抛出
2. View 的 `loadProviders()` 完成时 `loadError` 仍为 `''`
3. `loading` 变为 `false`，`providers` 是空数组 `[]`
4. **用户看到"尚未配置任何提供商"——这是误导性的**，实际是加载失败而非空状态

## 修改方案

### 修改 1: `provider.ts` — 添加 errorMessage 状态

- 新增 `errorMessage` ref（string 类型，初始 `''`）
- 加载成功时清空 → `errorMessage.value = ''`
- 所有重试失败后设置 → `errorMessage.value = toErrorMessage(e)`
- 在 `return` 中暴露 `errorMessage`

### 修改 2: `ProvidersView.vue` — 检测加载失败并显示错误

- `loadProviders()` 函数：await 之后检查 `providerStore.loaded`，若为 false 则从 `providerStore.errorMessage` 获取错误信息
- `retryLoad()` 函数：同样检测 `providerStore.loaded`，替代原有的无效 try-catch
- 利用模板已有的 `loadError` 分支显示友好错误和重试按钮

### 不修改的部分

- API 层的异常抛出行为不变
- 模板结构和样式不变
- Store 的 `refresh()` 行为不变
