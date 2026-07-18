# 空/null props 防御审计计划

## 审查结果摘要

| 组件 | 问题 | 严重度 | 需修复 |
|------|------|--------|--------|
| MessageBubble.vue | content null → useStickerSegments 已有 `if (!text) return []` 防御；refs 使用了 `?.` 可选链 | 低 | 否 |
| ChatWindow.vue | **turns undefined → `v-for` 和脚本中的 `.length` / `.some()` 直接崩溃** | **高** | **是** |
| ToolCallCard.vue | **toolCall null → 模板和脚本全面崩溃** | **高** | **是** |
| RenderMarkdown.vue | content null → `renderMarkdown()` 内部有 `!content` 空值检查；`useSandbox` 也有 `!content` 检查 | 低 | 否 |
| HealthPanel.vue | health null → 模板已有 `v-if="health"` 根级防御 | 无 | 否 |

---

## 详细分析

### 1. MessageBubble.vue — 无需修改

- **`content` null/undefined**: `useStickerSegments(toRef(props, 'content'))` 内部第 31 行有 `if (!text) return []`，返回空数组，不会崩溃。
- **`refs` undefined**: 模板第 21 行 `v-if="refs?.length"` 使用了可选链，安全。
- 结论：已有足够防御。

### 2. ChatWindow.vue — 需要修复 (HIGH)

- **`turns` undefined 时崩溃点**:
  - 模板第 220 行 `v-for="(turn, idx) in turns"` → Vue 3 对 undefined 的 `v-for` 会报错
  - 脚本第 387 行 `props.turns.some(...)` → `undefined.some()` 崩溃
  - 脚本第 394 行 `props.turns.length` → `undefined.length` 崩溃
  - 脚本第 460 行 `watch(() => props.turns.length, ...)` → 同上
  - 脚本第 573 行 `props.turns.length` → 同上

**修复方案**:
- 在 `defineProps` 中为 `turns` 添加默认值 `() => []`
- 这一步即可覆盖所有访问点

### 3. ToolCallCard.vue — 需要修复 (HIGH)

- **`toolCall` null/undefined 时崩溃点**:
  - 模板第 5 行 `toolCall.status === 'running'`
  - 模板第 9 行 `toolCall.name`
  - 模板第 10 行 `toolCall.elapsed !== null`
  - 模板第 18 行 `toolCall.input`
  - 模板第 33 行 `toolCall.output`
  - 脚本第 132 行 `props.toolCall.input`
  - 脚本第 138 行 `props.toolCall.output`
  - 脚本第 147-149 行 `props.toolCall.name`, `props.toolCall.output`, `props.toolCall.input`
  - 等等（几乎所有模板/脚本都直接访问 `toolCall.*`）

**修复方案**:
- 模板根元素 `<div class="tool-card">` 添加 `v-if="toolCall"` 即可防御整个组件

### 4. RenderMarkdown.vue — 无需修改

- `renderMarkdown()`（第 227 行）和 `renderMarkdownRaw()`（第 233 行）都有 `if (!content) return ''`
- `contentNeedsIsolation()`（第 255 行）有 `if (!markdown) return false`
- `useSandbox` computed 第 73 行有 `if (!props.content) return false`
- `renderedHtml` computed 有 try-catch 兜底
- 唯一隐患是 catch 块中的 `props.content.slice(0, 200)`（第 55 行），但仅当 `renderMarkdown` 抛异常时才执行，而 null content 不会触发异常（函数内部已防御）
- 结论：已有足够防御。

### 5. HealthPanel.vue — 无需修改

- 模板第 2 行 `v-if="health"` 已防御整组件
- `items` computed 只在模板访问时求值，`v-if="health"` 为 false 时模板不访问，因此安全

---

## 执行计划

1. **ChatWindow.vue**: 在 `defineProps` 中修改 `turns` 类型为 `ChatTurn[]` + 默认值 `() => []`
2. **ToolCallCard.vue**: 模板根 `<div>` 添加 `v-if="toolCall"`
3. 运行 `npx vue-tsc --noEmit` 验证无类型错误
4. 打印审计摘要

## 不修改的理由

- **MessageBubble**: useStickerSegments 已有 `!text` 防御；refs 使用可选链
- **RenderMarkdown**: 底层 `renderMarkdown()` 已有空值检查；计算属性有 try-catch
- **HealthPanel**: 模板已有 `v-if="health"` 根级防御
