# 前端 UI 状态完整性审计计划

## 审计目标

系统性地检查 `ProvidersView.vue`、`McpView.vue`、`SkillsView.vue` 三个页面的 4 种状态（loading / empty / error / normal）是否完整，并对缺失状态进行修复。

---

## 检查结果

### 1. ProvidersView.vue

| 状态 | 是否存在 | 说明 |
|------|---------|------|
| loading | **是** | 第12行 `<div v-if="loading" class="loading">加载中...</div>` |
| empty | **是** | 第13-15行 `<div v-else-if="providers.length === 0" class="empty">尚未配置任何提供商...</div>` |
| error | **否** | **缺失关键状态。** `providerStore.loadProviders()` 内部吞掉所有异常（仅 console.warn），组件没有 `loadError` 变量，加载失败时用户看到的是空状态提示，而非错误信息。 |
| normal | **是** | 第16-87行 card-grid 卡片列表 |

**结论：需要修复 -- 添加 error 状态。**

### 2. McpView.vue

| 状态 | 是否存在 | 说明 |
|------|---------|------|
| loading | **是** | 第12行 `<div v-if="loading" class="loading">加载中...</div>` |
| error | **是** | 第13-18行 `<div v-else-if="loadError" class="empty">加载失败 + 重试按钮</div>` |
| empty | **是** | 第19-22行 `<div v-else-if="servers.length === 0" class="empty">尚未配置任何 MCP 服务器...</div>` |
| normal | **是** | 第23-85行 card-grid 卡片列表 + OMP 自动发现区 |

**结论：无需修改。**

### 3. SkillsView.vue

| 状态 | 是否存在 | 说明 |
|------|---------|------|
| loading | **是** | 第18行 `<div v-if="loading" class="loading">加载中...</div>` |
| error | **是** | 第19-24行 `<div v-else-if="loadError" class="empty">加载失败 + 重试按钮</div>` |
| empty | **是** | 第25-34行 `<div v-else-if="currentList.length === 0" class="empty">尚未创建任何 Skill/宏...</div>` |
| normal | **是** | 第35-84行 card-grid 卡片列表 |

**结论：无需修改。**

---

## 不一致性检查

| 检查项 | 结果 |
|--------|------|
| loading 样式类名 | 一致 -- 三个页面均使用 `.loading` 类（scoped），样式相同 |
| empty 样式类名 | 一致 -- 三个页面均使用 `.empty` 类（scoped），样式相同 |
| error 处理模式 | **不一致** -- McpView 和 SkillsView 使用 `loadError` ref + 重试按钮；ProvidersView 缺失 error 状态 |
| error 与 empty 分离 | McpView 和 SkillsView 将 error 和 empty 分离为互斥条件；ProvidersView 未分离 |
| 设计系统类使用 | 三个页面均未使用 `ds-empty-state*` 类，而是使用各自 scoped 样式 |

---

## 修复方案

### 修复 ProvidersView.vue (唯一需要修改的页面)

**目标：** 按照 McpView / SkillsView 的既有模式，为 ProvidersView 添加 error 状态。

**具体修改：**

#### 1. 添加 `loadError` 变量 (script 部分)
在 `<script setup>` 的 ref 区域末尾添加：
```ts
const loadError = ref('')
```

#### 2. 修改 `loadProviders` 函数
将原有函数改为检测 store 加载结果：
```ts
async function loadProviders() {
  loadError.value = ''
  await providerStore.loadProviders()
  if (!providerStore.loaded) {
    loadError.value = '加载提供商列表失败，请稍后重试'
  }
}
```
（`providerStore.loaded` 已是 store 中的状态，成功加载时为 true，所有重试失败后仍为 false）

#### 3. 修改模板渲染逻辑
在 loading 和 empty 之间插入 error 分支：
```html
<div v-if="loading" class="loading">加载中...</div>
<div v-else-if="loadError" class="empty">
  加载失败: {{ loadError }}
  <div class="retry-row">
    <button class="btn primary" @click="loadProviders">重试</button>
  </div>
</div>
<div v-else-if="providers.length === 0" class="empty">
  尚未配置任何提供商。点击上方按钮添加。
</div>
<div v-else class="card-grid">...</div>
```

#### 4. 添加重试按钮样式 (scoped style)
```css
.retry-row {
  margin-top: 12px;
}
```
（与 McpView 的 `.retry-row` 一致）

**不涉及的修改：**
- ProvidersView 的 empty/normal 状态不需改动
- McpView.vue 和 SkillsView.vue 不需任何改动
- 不引入设计系统 `ds-empty-state*` 类，保持现有 scoped 样式一致性

---

## 验证方式

修改完成后运行：
```bash
npx vue-tsc --noEmit
npx vite build  # 可选
```

确保无类型错误，且修改不破坏现有功能。
