# useChatInput 接入 ChatView/ChatInput 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `useChatInput` composable 接入 `ChatView.vue` 与 `ChatInput.vue`，替换原先 8 个 props + 5 个 emits 的传递方式，改为通过 `provide/inject` 共享同一个 composable 实例。这是一次纯重构，不改变任何现有功能。

**Architecture:** ChatView 在 setup 中调用 `useChatInput({...})` 创建实例（外部 ref + 事件回调全部接线），通过 Vue 的 `provide()` 注入；ChatInput 通过 `inject()` 取出实例，直接读取状态和调用方法，不再声明 props/emits。composable 内部 `providerId`/`modelName` ref 与 ChatView 的 `selectedProviderId`/`selectedModelName` 是同一个 ref（引用透传），因此 ChatInput 修改它们即等价于原来的 `emit('modelChange')`。

**Tech Stack:** Vue 3 Composition API、TypeScript、Vitest、vue-tsc。

---

## 独占文件范围（仅修改这三个）

- `web/src/composables/useChatInput.ts` — 完善 composable + 新增 provide/inject 辅助
- `web/src/views/ChatView.vue` — 接入 useChatInput、provide、移除 ChatInput 的 props/emits 绑定
- `web/src/components/ChatInput.vue` — inject useChatInput、移除 props/emits 声明、改用 composable 方法

**严禁修改：** `DsSelect.vue`、`Icon.vue`（Agent 40）、`App.vue`、`ChatWindow.vue`（Agent 43）及其他任何文件。

---

## 现状回顾

### ChatView 向 ChatInput 传递的 8 个 props

```vue
<ChatInput
  :is-streaming="isStreaming"
  :disabled="false"
  :can-send="connected"
  :initial-provider-id="selectedProviderId"
  :initial-model-name="selectedModelName"
  :think-path-enabled="health?.think_path_enabled === true"
  :quoted-selections="quotedSelections"
  :quote-candidate="quoteCandidate"
  @send="onSend"
  @stop="cancel"
  @model-change="onModelChange"
  @commit-quote="commitCandidate"
  @remove-quote="removeQuote"
/>
```

### ChatInput 内部使用 props 的位置

- `props.canSend` → `inputPlaceholder`、`sendButtonTitle`、`handleSend` 守卫
- `props.disabled` → textarea `:disabled`、`toggleMenu` 守卫、`handleSend` 守卫、按钮 `:disabled`
- `props.isStreaming` → 模板 `v-if="!isStreaming"` 切换 send/stop 按钮、ThinkPathChooser `:disabled`
- `props.thinkPathEnabled` → ThinkPathChooser `:enabled`
- `props.quotedSelections` → 模板 `v-if="quotedSelections.length"` 渲染卡片栏
- `props.quoteCandidate` → 模板 `v-if="quoteCandidate"` 渲染浮动按钮、`watchEffect` 定位
- `props.initialProviderId` / `props.initialModelName` → `loadProviders` 初始选择逻辑

### useChatInput 现状

- 8 个状态 ref（text/isStreaming/disabled/canSend/providerId/modelName/thinkPathEnabled/quotedSelections/quoteCandidate）已定义
- 5 个方法（send/stop/onModelChange/commitQuote/removeQuote）已实现为"回调存在则调用，否则打印 warning"的骨架
- 3 个文本方法（clearText/appendText/setText）已实现
- `canSubmit` computed 已实现
- **缺失：** provide/inject 辅助、清理"骨架模式"注释

---

## Task 1: 完善 useChatInput（清理骨架注释 + 新增 provide/inject 辅助）

**Files:**
- Modify: `web/src/composables/useChatInput.ts`

### Step 1: 更新文件头注释

将 `web/src/composables/useChatInput.ts` 第 1-13 行的"骨架/未接入"注释替换为"已接入"说明。

- [ ] **Step 1: 替换文件头注释**

把第 1-13 行：
```ts
// web/src/composables/useChatInput.ts
//
// useChatInput — ChatInput 状态收敛 composable（骨架）
//
// 当前状态：骨架文件，未接入 ChatView.vue / ChatInput.vue。
//   - ChatView.vue 当前向 ChatInput 传 8 个 props + 5 个 emits，状态分散
//   - 本 composable 预留统一的输入状态接口，供后续 Agent 33/35 协调接入
//   - 接入前不要调用本 composable；下面方法为占位实现
//
// 接入计划（不在本次范围内）：
//   1. ChatView 用 useChatInput() 收敛 isStreaming/canSend/providerId/modelName/... 状态
//   2. ChatInput 改为接收单个 composable 返回对象（或保留 props 但从 composable 取值）
//   3. send/stop/modelChange/commitQuote/removeQuote 由 composable 通过回调上抛
```

替换为：
```ts
// web/src/composables/useChatInput.ts
//
// useChatInput — ChatInput 状态收敛 composable
//
// 已接入 ChatView.vue / ChatInput.vue：
//   - ChatView 在 setup 中调用 useChatInput({...}) 创建实例并 provide
//   - ChatInput 通过 inject(CHAT_INPUT_KEY) 取出实例，直接读写状态、调用方法
//   - send/stop/onModelChange/commitQuote/removeQuote 通过回调上抛到 ChatView
//   - clearText/appendText/setText 可独立使用（操作内部 text ref）
//
// 提供 CHAT_INPUT_KEY（InjectionKey）+ provideChatInput/useChatInputInjected 辅助，
// 保证 provide/inject 类型安全。
```

- [ ] **Step 2: 更新 useChatInput 函数头注释**

把第 73-80 行的 JSDoc：
```ts
/**
 * ChatInput 状态收敛 composable。
 *
 * ⚠️ 骨架：当前未被 ChatView/ChatInput 引用。
 *   - send/stop/onModelChange/commitQuote/removeQuote 为占位实现（未接线时打印 warning）
 *   - clearText/appendText/setText 为真实实现，可独立使用（不依赖回调接线）
 * 接入工作由 Agent 33/35 协调完成（不在本 agent 独占文件范围内）。
 */
```

替换为：
```ts
/**
 * ChatInput 状态收敛 composable。
 *
 * 已接入：ChatView 创建实例并 provide，ChatInput inject 后直接使用。
 *   - send/stop/onModelChange/commitQuote/removeQuote 调用 ChatView 提供的回调
 *   - 未提供回调时打印 warning（防御性，便于排查接线遗漏）
 *   - clearText/appendText/setText 操作内部 text ref，可独立使用
 */
```

- [ ] **Step 3: 在文件末尾新增 provide/inject 辅助**

在 `useChatInput` 函数 `return { ... }` 之后、文件结束之前，追加：

```ts
// ── provide/inject 辅助：保证 ChatView → ChatInput 类型安全传递 ──

import { inject, type InjectionKey } from 'vue'

/** ChatInput composable 实例的注入键 */
export const CHAT_INPUT_KEY: InjectionKey<UseChatInputReturn> = Symbol('chatInput')

/**
 * 由 ChatView 调用：创建 useChatInput 实例并 provide 给后代。
 * 返回原实例，便于 ChatView 自身也持有引用。
 */
export function provideChatInput(options: UseChatInputOptions = {}): UseChatInputReturn {
  const instance = useChatInput(options)
  provide(CHAT_INPUT_KEY, instance)
  return instance
}

/**
 * 由 ChatInput（及其后代组件）调用：取出最近祖先 provide 的 useChatInput 实例。
 * 若未找到则抛错（避免静默失效）。
 */
export function useChatInputInjected(): UseChatInputReturn {
  const instance = inject(CHAT_INPUT_KEY)
  if (!instance) {
    throw new Error('[useChatInput] useChatInputInjected() called outside of a provider tree — ChatView must call provideChatInput() first')
  }
  return instance
}
```

注意：`inject` 和 `InjectionKey` 从 `vue` 导入，放在文件中部导入是合法的 ES module（会被 hoisted），但为可读性追加在文件末尾。实际实现时把 `import { inject, type InjectionKey } from 'vue'` 合并到文件顶部的现有 `import { ref, computed, type Ref, type ComputedRef } from 'vue'` 中。

- [ ] **Step 4: 合并 vue 导入**

把第 15 行：
```ts
import { ref, computed, type Ref, type ComputedRef } from 'vue'
```

改为：
```ts
import { ref, computed, provide, inject, type Ref, type ComputedRef, type InjectionKey } from 'vue'
```

并删除 Step 3 中临时写在末尾的 `import { inject, type InjectionKey } from 'vue'` 行。

- [ ] **Step 5: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无新增错误（已有的与本次无关的错误可忽略）

- [ ] **Step 6: 提交**

```bash
git -C d:\Maxma\MaxmaHere add web/src/composables/useChatInput.ts
git -C d:\Maxma\MaxmaHere commit -m "refactor(composable): wire useChatInput with provide/inject helpers"
```

---

## Task 2: ChatView 接入 useChatInput

**Files:**
- Modify: `web/src/views/ChatView.vue`

### Step 1: 引入 useChatInput 与 provideChatInput

- [ ] **Step 1: 在 `<script setup>` 顶部追加 import**

在 `import { useSelectionQuote } from '@/composables/useSelectionQuote'`（第 171 行）之后追加：
```ts
import { provideChatInput } from '@/composables/useChatInput'
```

### Step 2: 提取 thinkPathEnabled 为 computed ref

useChatInput 选项需要一个 `Ref<boolean>`，而 ChatView 当前直接传 `health?.think_path_enabled === true` 表达式。需要把它包成 computed。

- [ ] **Step 2: 在 useSelectionQuote 调用之后新增 thinkPathEnabled computed**

定位第 207-213 行的 useSelectionQuote 块，在其后追加：
```ts
// 服务端 think_path 能力开关（包成 ref 以便传入 useChatInput）
const thinkPathEnabled = computed(() => health.value?.think_path_enabled === true)
```

### Step 3: 创建 useChatInput 实例并 provide

- [ ] **Step 3: 在 onModelChange 函数定义之后（第 259 行后）插入实例创建**

定位第 253-259 行的 `function onModelChange(...)`，在其后追加：
```ts
// ── ChatInput 状态收敛：创建 useChatInput 实例并 provide 给 ChatInput ──
const chatInput = provideChatInput({
  isStreaming,
  canSend: connected,
  initialProviderId: selectedProviderId,
  initialModelName: selectedModelName,
  thinkPathEnabled,
  quotedSelections,
  quoteCandidate,
  onSend,
  onStop: cancel,
  onModelChange,
  onCommitQuote: commitCandidate,
  onRemoveQuote: removeQuote,
})
```

注意：
- `isStreaming`、`connected` 来自 useChat 返回的 ref（第 186-189 行）
- `selectedProviderId`、`selectedModelName` 是 ChatView 本地 ref（第 218-219 行）
- `quotedSelections`、`quoteCandidate`、`commitCandidate`、`removeQuote` 来自 useSelectionQuote（第 207-213 行）
- `onSend`、`onModelChange` 是 ChatView 本地函数（第 253、273 行）——function 声明会 hoist，可在 useChatInput 调用前引用
- `cancel` 来自 useChat（第 187 行）

### Step 4: 移除 ChatInput 模板上的 8 个 props 和 5 个 emits

- [ ] **Step 4: 替换 ChatInput 标签**

定位第 107-123 行的 `<ChatInput ... />`，把：
```vue
<ChatInput
  v-if="!isSubagent"
  ref="chatInputRef"
  :is-streaming="isStreaming"
  :disabled="false"
  :can-send="connected"
  :initial-provider-id="selectedProviderId"
  :initial-model-name="selectedModelName"
  :think-path-enabled="health?.think_path_enabled === true"
  :quoted-selections="quotedSelections"
  :quote-candidate="quoteCandidate"
  @send="onSend"
  @stop="cancel"
  @model-change="onModelChange"
  @commit-quote="commitCandidate"
  @remove-quote="removeQuote"
/>
```

替换为：
```vue
<ChatInput
  v-if="!isSubagent"
  ref="chatInputRef"
/>
```

保留 `v-if` 和 `ref="chatInputRef"`（ChatView 仍通过 `chatInputRef.value?.addRef(ref)` 注入引用，见第 269-271 行 `addCitation`）。

### Step 5: 类型检查 + 测试

- [ ] **Step 5: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: ChatView 无类型错误（ChatInput 此时仍声明了 props 但父组件不再传，Vue 不会报错因为 props 都有默认值或可选）

- [ ] **Step 6: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 全部通过（现有测试不直接挂载 ChatView/ChatInput）

- [ ] **Step 7: 提交**

```bash
git -C d:\Maxma\MaxmaHere add web/src/views/ChatView.vue
git -C d:\Maxma\MaxmaHere commit -m "refactor(view): ChatView provides useChatInput, drops ChatInput props/emits"
```

---

## Task 3: ChatInput 接入 useChatInput

**Files:**
- Modify: `web/src/components/ChatInput.vue`

### Step 1: 引入 useChatInputInjected

- [ ] **Step 1: 在 `<script setup>` 顶部追加 import**

在 `import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'`（第 231 行）之后追加：
```ts
import { useChatInputInjected } from '@/composables/useChatInput'
```

### Step 2: 替换 props/emits 为 inject

- [ ] **Step 2: 替换 props + emits 定义**

定位第 242-263 行的 `const props = withDefaults(...)` 和 `const emit = defineEmits<...>`，把整块替换为：
```ts
// ChatView 通过 provide 注入 useChatInput 实例；ChatInput 直接读写状态、调用方法
const chatInput = useChatInputInjected()
```

### Step 3: 解构出常用 ref（保持模板兼容）

模板里大量使用 `isStreaming`、`disabled`、`canSend`、`thinkPathEnabled`、`quotedSelections`、`quoteCandidate` 等名字。为了最小改动，从 `chatInput` 解构出这些 ref（解构 ref 保持响应性，因为 ref 本身是对象）。

- [ ] **Step 3: 在 inject 之后追加解构**

紧接 `const chatInput = useChatInputInjected()` 之后追加：
```ts
const {
  isStreaming,
  disabled,
  canSend,
  thinkPathEnabled,
  quotedSelections,
  quoteCandidate,
} = chatInput
```

注意：不解构 `providerId`/`modelName`，因为 ChatInput 有自己的 `selectedProviderId`/`selectedModelName` 局部 ref（见 Step 4）。`text` 也不解构，保留 ChatInput 本地 `text` ref（第 265 行）。

### Step 4: 让 ChatInput 的 selectedProviderId/selectedModelName 复用 composable 的 ref

ChatInput 原本有 `const selectedProviderId = ref('')` / `const selectedModelName = ref('')`（第 726-727 行）。现在 composable 已经持有 ChatView 传入的 `selectedProviderId` ref（同一个引用），ChatInput 应直接使用它，避免双份状态。

- [ ] **Step 4: 替换本地 selectedProviderId/selectedModelName 为 composable 的 ref**

定位第 721-727 行：
```ts
// ── LLM 选择器 ──
// provider 列表来自全局 store（含重试），消除此前各组件独立请求导致的状态不一致
const providerStore = useProviderStore()
const chatStore = useChatStore()
const providers = computed(() => providerStore.enabledProviders)
const selectedProviderId = ref('')
const selectedModelName = ref('')
```

替换为：
```ts
// ── LLM 选择器 ──
// provider 列表来自全局 store（含重试），消除此前各组件独立请求导致的状态不一致
// selectedProviderId/selectedModelName 直接复用 useChatInput 的 ref（与 ChatView 同一引用）
const providerStore = useProviderStore()
const chatStore = useChatStore()
const providers = computed(() => providerStore.enabledProviders)
const selectedProviderId = chatInput.providerId
const selectedModelName = chatInput.modelName
```

### Step 5: selectProvider/selectModel 改用 composable 方法

原本 `emit('modelChange', ...)` 改为 `chatInput.onModelChange(...)`。

- [ ] **Step 5: 替换 selectProvider 内的 emit**

定位第 737-744 行 `selectProvider` 函数：
```ts
function selectProvider(value: string | number) {
  const id = String(value)
  selectedProviderId.value = id
  const p = providers.value.find(p => p.id === id)
  currentModels.value = p?.models ?? []
  selectedModelName.value = currentModels.value[0] || ''
  emit('modelChange', selectedProviderId.value, selectedModelName.value)
}
```

替换为：
```ts
function selectProvider(value: string | number) {
  const id = String(value)
  selectedProviderId.value = id
  const p = providers.value.find(p => p.id === id)
  currentModels.value = p?.models ?? []
  selectedModelName.value = currentModels.value[0] || ''
  chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
}
```

- [ ] **Step 6: 替换 selectModel 内的 emit**

定位第 746-750 行 `selectModel` 函数：
```ts
function selectModel(value: string | number) {
  const name = String(value)
  selectedModelName.value = name
  emit('modelChange', selectedProviderId.value, selectedModelName.value)
}
```

替换为：
```ts
function selectModel(value: string | number) {
  const name = String(value)
  selectedModelName.value = name
  chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
}
```

### Step 6: loadProviders 改用 composable 的初始值

原本读 `props.initialProviderId`/`props.initialModelName`，现在读 `chatInput.providerId.value`/`chatInput.modelName.value`。

- [ ] **Step 7: 替换 loadProviders 内的 props 引用**

定位第 753-773 行 `loadProviders` 函数。把：
```ts
async function loadProviders() {
  await providerStore.loadProviders()
  // 优先使用父组件传入的初始值（跨对话持久化）
  if (props.initialProviderId) {
    const provider = providers.value.find(p => p.id === props.initialProviderId)
    if (provider) {
      selectedProviderId.value = provider.id
      currentModels.value = provider.models ?? []
      selectedModelName.value = props.initialModelName && currentModels.value.includes(props.initialModelName)
        ? props.initialModelName
        : (currentModels.value[0] || '')
      // 同步回父组件，确保父组件持有的状态与实际选中一致
      emit('modelChange', selectedProviderId.value, selectedModelName.value)
      return
    }
  }
  // 默认选中第一个已启用的提供商
  if (providers.value.length > 0 && !selectedProviderId.value) {
    selectProvider(providers.value[0].id)
  }
}
```

替换为：
```ts
async function loadProviders() {
  await providerStore.loadProviders()
  // 优先使用 ChatView 传入的初始值（跨对话持久化，存于 composable 的 providerId/modelName）
  const initialProviderId = selectedProviderId.value
  const initialModelName = selectedModelName.value
  if (initialProviderId) {
    const provider = providers.value.find(p => p.id === initialProviderId)
    if (provider) {
      selectedProviderId.value = provider.id
      currentModels.value = provider.models ?? []
      selectedModelName.value = initialModelName && currentModels.value.includes(initialModelName)
        ? initialModelName
        : (currentModels.value[0] || '')
      // 同步回 ChatView（触发 onModelChange 回调持久化到 localStorage）
      chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
      return
    }
  }
  // 默认选中第一个已启用的提供商
  if (providers.value.length > 0 && !selectedProviderId.value) {
    selectProvider(providers.value[0].id)
  }
}
```

### Step 7: watch providers 内的 props 引用与 emit

- [ ] **Step 8: 替换 watch(providers) 内的 props.initialProviderId 与 emit**

定位第 776-809 行 `watch(providers, ...)`。把：
```ts
watch(providers, (newList) => {
  // 如果有初始值且初始值有效，让 loadProviders 处理初始选择，避免竞态覆盖
  if (props.initialProviderId && newList.find(p => p.id === props.initialProviderId) && !selectedProviderId.value) {
    return
  }
  if (selectedProviderId.value) {
    // 当前选中的 provider 还在列表中
    const p = newList.find(p => p.id === selectedProviderId.value)
    if (p) {
      // 更新 currentModels（provider 的 models 可能被修改过）
      const newModels = p.models ?? []
      const modelsChanged = JSON.stringify(currentModels.value) !== JSON.stringify(newModels)
      if (modelsChanged) {
        currentModels.value = newModels
        // selectedModelName 不在新 models 中时重置为第一个
        if (!newModels.includes(selectedModelName.value)) {
          selectedModelName.value = newModels[0] || ''
          emit('modelChange', selectedProviderId.value, selectedModelName.value)
        }
      }
    } else {
      // 当前选中的 provider 不在新列表中（被删除或禁用），重置选中
      selectedProviderId.value = ''
      currentModels.value = []
      selectedModelName.value = ''
      if (newList.length > 0) {
        selectProvider(newList[0].id)
      }
    }
  } else if (!selectedProviderId.value && newList.length > 0) {
    // 之前没有 provider，现在有了，自动选中第一个
    selectProvider(newList[0].id)
  }
})
```

替换为：
```ts
watch(providers, (newList) => {
  // 如果有初始值且初始值有效，让 loadProviders 处理初始选择，避免竞态覆盖
  const initialProviderId = selectedProviderId.value
  if (initialProviderId && newList.find(p => p.id === initialProviderId) && !selectedProviderId.value) {
    return
  }
  if (selectedProviderId.value) {
    // 当前选中的 provider 还在列表中
    const p = newList.find(p => p.id === selectedProviderId.value)
    if (p) {
      // 更新 currentModels（provider 的 models 可能被修改过）
      const newModels = p.models ?? []
      const modelsChanged = JSON.stringify(currentModels.value) !== JSON.stringify(newModels)
      if (modelsChanged) {
        currentModels.value = newModels
        // selectedModelName 不在新 models 中时重置为第一个
        if (!newModels.includes(selectedModelName.value)) {
          selectedModelName.value = newModels[0] || ''
          chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
        }
      }
    } else {
      // 当前选中的 provider 不在新列表中（被删除或禁用），重置选中
      selectedProviderId.value = ''
      currentModels.value = []
      selectedModelName.value = ''
      if (newList.length > 0) {
        selectProvider(newList[0].id)
      }
    }
  } else if (!selectedProviderId.value && newList.length > 0) {
    // 之前没有 provider，现在有了，自动选中第一个
    selectProvider(newList[0].id)
  }
})
```

注意：原 `watch` 第一行的 `!selectedProviderId.value` 与外层 `if (initialProviderId && ...)` 互斥（initialProviderId 取自 selectedProviderId.value），相当于恒为 false 的死分支。为保持行为完全等价（不"修复"逻辑），原样保留该条件。

### Step 8: toggleMenu 改用 disabled.value

- [ ] **Step 9: 替换 toggleMenu 内的 props.disabled**

定位第 821-824 行：
```ts
function toggleMenu() {
  if (props.disabled) return
  showMenu.value = !showMenu.value
}
```

替换为：
```ts
function toggleMenu() {
  if (disabled.value) return
  showMenu.value = !showMenu.value
}
```

### Step 9: handleSend 改用 composable 方法与 disabled/canSend

- [ ] **Step 10: 替换 handleSend**

定位第 969-995 行 `handleSend` 函数。把：
```ts
function handleSend() {
  const msg = text.value.trim()
  if ((!msg && imageRefs.value.length === 0) || props.disabled || !props.canSend) return
  emit(
    'send',
    msg,
    refs.value,
    selectedProviderId.value || undefined,
    selectedModelName.value || undefined,
    selectedThinkPathId.value || undefined,
    chatStore.currentModel,
    chatStore.temperature,
    chatStore.maxTokens,
  )
  text.value = ''
  // ThinkPath is intentionally one-shot: it is a confirmed preference for this
  // request, never an invisible session-level routing policy.
  selectedThinkPathId.value = null
  // 释放图片预览 URL
  for (const r of refs.value) {
    if (r.type === 'image' && r.preview.startsWith('blob:')) {
      URL.revokeObjectURL(r.preview)
    }
  }
  refs.value = []
  nextTick(() => autoResize())
}
```

替换为：
```ts
function handleSend() {
  const msg = text.value.trim()
  if ((!msg && imageRefs.value.length === 0) || disabled.value || !canSend.value) return
  chatInput.send(
    msg,
    refs.value,
    selectedThinkPathId.value || undefined,
    chatStore.currentModel,
    chatStore.temperature,
    chatStore.maxTokens,
  )
  text.value = ''
  // ThinkPath is intentionally one-shot: it is a confirmed preference for this
  // request, never an invisible session-level routing policy.
  selectedThinkPathId.value = null
  // 释放图片预览 URL
  for (const r of refs.value) {
    if (r.type === 'image' && r.preview.startsWith('blob:')) {
      URL.revokeObjectURL(r.preview)
    }
  }
  refs.value = []
  nextTick(() => autoResize())
}
```

注意签名变化：`chatInput.send(text, refs, thinkPathId, model, temperature, maxTokens)` —— composable 的 `send` 会在内部把 `providerId`/`modelName` 一起传给 `onSend` 回调（见 useChatInput.ts 第 123-145 行）。原 `emit('send', msg, refs, selectedProviderId.value || undefined, ...)` 把 providerId/modelName 作为第 3、4 参数传出；现在 composable 内部从自己的 `providerId.value`/`modelName.value` 取，等价（因为 ChatInput 的 `selectedProviderId` 就是 composable 的 `providerId`，见 Step 4）。

### Step 10: 模板内 emit 替换为方法

模板里有 3 处 `$emit`：
- 第 75 行：`@remove="$emit('removeQuote', q.id)"`（QuotedSelectionCard 的 remove 事件）
- 第 167 行：`@click="$emit('stop')"`（btn-stop）
- 第 210 行：`@click="$emit('commitQuote')"`（quote-float-btn）

- [ ] **Step 11: 替换模板内 $emit('removeQuote', ...)**

定位第 75 行：
```vue
@remove="$emit('removeQuote', q.id)"
```

替换为：
```vue
@remove="chatInput.removeQuote(q.id)"
```

- [ ] **Step 12: 替换模板内 $emit('stop')**

定位第 167 行：
```vue
<button v-else class="btn-stop" @click="$emit('stop')">
```

替换为：
```vue
<button v-else class="btn-stop" @click="chatInput.stop()">
```

- [ ] **Step 13: 替换模板内 $emit('commitQuote')**

定位第 210 行：
```vue
@click="$emit('commitQuote')"
```

替换为：
```vue
@click="chatInput.commitQuote()"
```

### Step 11: 修正 inputPlaceholder 与 sendButtonTitle 中的 props.canSend

- [ ] **Step 14: 替换 inputPlaceholder**

定位第 271-275 行：
```ts
const inputPlaceholder = computed(() =>
  props.canSend
    ? '输入消息…… @技能 · #工具 · !宏'
    : '后端连接中，可先输入内容，连接完成后发送……'
)
```

替换为：
```ts
const inputPlaceholder = computed(() =>
  canSend.value
    ? '输入消息…… @技能 · #工具 · !宏'
    : '后端连接中，可先输入内容，连接完成后发送……'
)
```

- [ ] **Step 15: 替换 sendButtonTitle**

定位第 276-280 行：
```ts
const sendButtonTitle = computed(() => {
  if (noProvider.value) return '请先在模型设置中添加 LLM 提供商'
  if (!props.canSend) return '后端连接中，暂时还不能发送'
  return ''
})
```

替换为：
```ts
const sendButtonTitle = computed(() => {
  if (noProvider.value) return '请先在模型设置中添加 LLM 提供商'
  if (!canSend.value) return '后端连接中，暂时还不能发送'
  return ''
})
```

### Step 12: 修正 watchEffect 中对 quoteCandidate 的引用

- [ ] **Step 16: 替换 quoteCandidate watchEffect**

定位第 284-298 行：
```ts
watchEffect(() => {
  const el = quoteFloatRef.value
  if (!el || !props.quoteCandidate) return
  // CSP-safe CSSOM: position quote float btn via style.setProperty (was :style binding)
  const result = computeFloatingInputPosition(
    props.quoteCandidate.rect,
    ...
```

把其中的 `props.quoteCandidate` 替换为 `quoteCandidate.value`（两处）：
```ts
watchEffect(() => {
  const el = quoteFloatRef.value
  if (!el || !quoteCandidate.value) return
  // CSP-safe CSSOM: position quote float btn via style.setProperty (was :style binding)
  const result = computeFloatingInputPosition(
    quoteCandidate.value.rect,
    { width: 100, height: 32 },
    window.innerWidth,
    window.innerHeight,
    'top',
  )
  el.style.setProperty('left', `${result.left}px`)
  el.style.setProperty('top', `${result.top}px`)
  el.style.setProperty('transform-origin', result.origin)
}, { flush: 'post' })
```

### Step 13: 修正模板中 ThinkPathChooser 的 disabled 绑定

- [ ] **Step 17: 检查 ThinkPathChooser 绑定（无需改动确认）**

模板第 96-101 行：
```vue
<ThinkPathChooser
  v-model="selectedThinkPathId"
  :enabled="thinkPathEnabled"
  :text="text"
  :disabled="disabled || isStreaming"
/>
```

这里 `thinkPathEnabled`、`disabled`、`isStreaming` 现在都是从 chatInput 解构出的 ref。在模板中 Vue 会自动 `.value` 解包，所以 `:enabled="thinkPathEnabled"` 和 `:disabled="disabled || isStreaming"` 都能正确工作。**无需改动。**

### Step 14: 验证 textarea :disabled 绑定

- [ ] **Step 18: 检查 textarea 绑定（无需改动确认）**

模板第 84-94 行：
```vue
<textarea
  ref="textareaRef"
  v-model="text"
  class="input-area"
  :placeholder="inputPlaceholder"
  :disabled="disabled"
  ...
```

`disabled` 是解构出的 ref，模板自动解包。**无需改动。**

### Step 15: 验证 send 按钮 disabled 绑定

- [ ] **Step 19: 检查 btn-send 绑定（无需改动确认）**

模板第 158-166 行：
```vue
<button
  v-if="!isStreaming"
  class="btn-send"
  :disabled="(!text.trim() && imageRefs.length === 0) || disabled || noProvider || !canSend"
  :title="sendButtonTitle"
  @click="handleSend"
>
```

`isStreaming`、`disabled`、`canSend` 都是解构出的 ref，模板自动解包。**无需改动。**

### Step 16: 类型检查 + 测试

- [ ] **Step 20: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无类型错误（特别确认：无 `props` / `emit` 未定义错误）

- [ ] **Step 21: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 全部通过

- [ ] **Step 22: 提交**

```bash
git -C d:\Maxma\MaxmaHere add web/src/components/ChatInput.vue
git -C d:\Maxma\MaxmaHere commit -m "refactor(component): ChatInput injects useChatInput, drops props/emits"
```

---

## 自检清单

### Spec 覆盖

- [x] Step 1 读取现状：已在"现状回顾"中完成
- [x] Step 2 完善 useChatInput：Task 1（清理注释 + provide/inject 辅助）
- [x] Step 3 ChatView 接入：Task 2
- [x] Step 4 ChatInput 接入：Task 3
- [x] 保留 ChatView 其他逻辑：Task 2 只改 ChatInput 标签 + 新增 import/computed/provide 调用，不动其他
- [x] 保留 ChatInput 其他逻辑：textarea、引用 chip、拖拽、缩放、sticker、autocomplete、链接输入栏、DsSelect 全部保留
- [x] 只修改独占文件：useChatInput.ts、ChatView.vue、ChatInput.vue
- [x] 频繁提交：每个 Task 一个 commit

### 类型一致性

- `useChatInputInjected()` 返回 `UseChatInputReturn`，与 `useChatInput()` 一致
- `provideChatInput(options)` 接受 `UseChatInputOptions`，与 `useChatInput()` 一致
- `chatInput.send(text, refs, thinkPathId, model, temperature, maxTokens)` 签名匹配 ChatInput 调用
- `chatInput.onModelChange(providerId, modelName)` 签名匹配 ChatInput 调用
- `chatInput.stop()` / `chatInput.commitQuote()` / `chatInput.removeQuote(id)` 签名匹配 ChatInput 调用

### 行为等价性

- 发送：`emit('send', msg, refs, providerId, modelName, thinkPathId, model, temp, maxTokens)` → `chatInput.send(msg, refs, thinkPathId, model, temp, maxTokens)`（composable 内部补 providerId/modelName）✓
- 停止：`emit('stop')` → `chatInput.stop()` ✓
- 模型切换：`emit('modelChange', p, m)` → `chatInput.onModelChange(p, m)` ✓
- 提交引用：`emit('commitQuote')` → `chatInput.commitQuote()` ✓
- 移除引用：`emit('removeQuote', id)` → `chatInput.removeQuote(id)` ✓
- 状态读取：`props.X` → `chatInput.X.value`（模板中自动解包）✓
