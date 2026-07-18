# Emits 类型验证计划

## 检查范围

以下 6 个关键组件：

| 文件 | 路径 | 当前 emits 声明方式 |
|------|------|-------------------|
| ChatInput.vue | `src/components/ChatInput.vue` | 无 `defineEmits`（不向上发射事件） |
| ChatWindow.vue | `src/components/ChatWindow.vue` | **类型声明** ✅ |
| MessageBubble.vue | `src/components/MessageBubble.vue` | 无 `defineEmits`（不向上发射事件） |
| SessionItem.vue | `src/components/SessionItem.vue` | **类型声明** ✅ |
| ContextMenu.vue | `src/components/ContextMenu.vue` | **类型声明** ✅ |
| ModelSelector.vue | `src/components/ModelSelector.vue` | 无 `defineEmits`（不向上发射事件） |

## 初步发现

### 1. ChatInput.vue
- **状态**: 无 `defineEmits`
- **说明**: 该组件通过 `defineExpose({ addRef })` 暴露方法，通过组合式函数 `useChatInputInjected()` 读写共享状态，不需要向上 emit 事件。当前设计合理，无需修改。

### 2. ChatWindow.vue
- **状态**: 已使用类型声明 ✅
- **声明**: `defineEmits<{ (e: 'action', ...): void; (e: 'cite', ...): void; ... }>()`
- **验证**: 
  - `action` — 调用方匹配 ✅
  - `cite` — 调用方匹配 ✅
  - `togglePrivate` — 调用方匹配 ✅
  - `planRespond` — 调用方匹配 ✅
  - `pin` — 调用方匹配 ✅
- **结论**: 无需修改。

### 3. MessageBubble.vue
- **状态**: 无 `defineEmits`
- **说明**: 组件仅渲染消息气泡内容，子组件事件（如 `StickerInline` 的 `preview`）均在组件内部处理，不向上发射事件。当前设计合理，无需修改。

### 4. SessionItem.vue
- **状态**: 已使用类型声明 ✅
- **声明**: `defineEmits<{ switch: [id: string]; contextmenu: [event: MouseEvent, session: SessionInfo]; ... }>()`
- **验证**:
  - `switch` — 调用方匹配 ✅
  - `contextmenu` — 调用方匹配 ✅
  - `mouseenter` — 调用方匹配 ✅
  - `mouseleave` — 调用方匹配 ✅
  - `delete` — 调用方匹配 ✅
- **结论**: 无需修改。

### 5. ContextMenu.vue
- **状态**: 已使用类型声明 ✅
- **声明**: `defineEmits<{ select: [action: string]; close: [] }>()`
- **验证**: 
  - `select` — 调用方匹配 ✅
  - `close` — 调用方匹配 ✅
- **结论**: 无需修改。

### 6. ModelSelector.vue
- **状态**: 无 `defineEmits`
- **说明**: 组件直接使用 Pinia store (`useChatStore`) 读写模型选择状态，不需要向上 emit 事件。当前设计合理，无需修改。

## 行动计划

上述 6 个组件中，**没有组件使用运行时声明（`defineEmits(['...'])`）**。所有需要发射事件的组件均已使用类型声明。因此：

- **无需执行任何 Edit 修改**
- 建议运行 `npx vue-tsc --noEmit` 确认整体类型检查通过
- 如果用户仍希望检查其余 43 个组件，可以扩大检查范围

## 风险/注意事项

- 组件通过 `v-on="$listeners"` 或模板中的 `@click="$emit(...)"` 直接发射的情况已全部覆盖检查
- 事件名拼写一致，参数类型与消费方使用方式匹配
- 无运行时声明需要升级为类型声明的情况

---

**请确认是否按此计划执行（即：无需修改，仅运行 vue-tsc 验证后输出审计摘要）。**
