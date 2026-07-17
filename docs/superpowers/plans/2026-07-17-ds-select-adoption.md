# DsSelect 接入实施计划

> **执行者**：独立 sub-agent（独占 ModelSelector.vue + ChatInput.vue）
> **日期**：2026-07-17
> **技术栈**：Vue 3 + TypeScript + Vite + Vitest

## 目标

将 Agent 32 已创建的 `DsSelect.vue`（combobox 模式，含 ARIA + 键盘导航 + 主题适配）接入到 `ModelSelector.vue` 和 `ChatInput.vue` 中，替换原有的自定义 dropdown，统一获得 WAI-ARIA Combobox 模式与键盘导航能力（Arrow/Home/End/Enter/Escape/type-ahead）。

---

## Context Findings（执行前已确认的事实）

### DsSelect API（`web/src/components/ui/DsSelect.vue`，490 行）

**Props**（`withDefaults` 定义）：
- `modelValue?: string | number | null` — 当前选中值
- `options: DsSelectOption[]` — 选项数组，每项 `{ value: string|number; label: string; disabled?: boolean }`
- `placeholder?: string`
- `disabled?: boolean`（默认 false）
- `id?: string`
- `ariaLabel?: string`
- `size?: 'sm' | 'md'`（默认 'md'，sm=28px，md=36px）

**Emits**：
- `update:modelValue: [value: string | number]`
- `open: []`
- `close: []`

**Expose**：`openList()`, `closeList()`, `toggle()`

**关键限制**：
- **没有 slot**：listbox 的 `<li>` 内容直接是 `{{ opt.label }}`，纯文本，无法自定义选项渲染
- **没有分组**：options 是平铺数组，无 group 概念
- **没有 `label-key` / `value-key` props**：任务描述里提到的这两个 props 实际不存在，需要在外部把数据源转换为 `{ value, label }` 格式
- trigger 是 `<input readonly>` + caret `<button>`，整体表单风格（与原紧凑按钮 trigger 视觉不同）

### ModelSelector 现状（`web/src/components/ModelSelector.vue`，85 行）

- 行 2-27：自定义 dropdown（`@click.stop="toggleOpen"` + `v-if="isOpen"` + `@click="selectModel"`）
- 数据源：`store.availableModels`（`ModelInfo[]`，含 `id`/`provider`/`name`/`contextWindow`）
- 用 `groupedModels` 按 provider 分组渲染
- 每项显示 `model.name` + `formatCtx(model.contextWindow)`（如 "8k"）
- 选中值：`store.currentModel`（model.id）
- 全局 `document.addEventListener('click', onDocumentClick)` 关闭 dropdown
- trigger 含 model.svg icon + name + arrow

### ChatInput 现状（`web/src/components/ChatInput.vue`）

- 行 128-146：两个自定义 dropdown（provider + model）
- 用 `openDropdown` 状态管理单个 dropdown 打开
- provider options 来自 `providerStore.enabledProviders`（`ProviderConfig[]`，含 `id`/`label`/`models`）
- model options 来自 `currentModels`（`string[]`，是 model 名字符串数组）
- 选中值：`selectedProviderId`（string）、`selectedModelName`（string）
- `selectProvider` / `selectModel` 触发 `modelChange` emit
- 全局 `document.addEventListener('click', onDocumentClick)` 关闭

### 测试基线

- `web/tests/modelSelector.spec.ts`：验证 `addEventListener('click', ...)` 注册和 `removeEventListener` 卸载
- `web/package.json` 无 test script，直接 `npx vitest run`
- `web/vite.config.ts` 已配置 vitest（jsdom + setupFiles）

---

## 关键决策与偏差说明

### 决策 1：严格遵守"不修改 DsSelect.vue"约束

DsSelect 没有 slot 也没有分组支持。任务描述里"保留 ctx 显示，可能需要用 slot 自定义选项渲染"与"不要修改 DsSelect.vue 本身"存在冲突。

**选择**：严格遵守"不修改 DsSelect.vue"硬约束。这导致 ModelSelector 的 ctx 显示和 provider 分组无法保留，属于任务约束的硬性副作用。在最终报告中明确说明。

### 决策 2：ModelSelector 的 label 取值

**选项 A**：`label = name` — trigger 显示 name（与原一致），listbox 只显示 name（丢失 ctx）
**选项 B**：`label = \`${name} · ${formatCtx(ctx)}\`` — trigger 显示 "name · ctx"（与原 trigger 不一致），listbox 显示 "name · ctx"（保留 ctx 信息但无样式）

**选择 A**：保持 trigger 视觉与原一致（仅显示 model name），listbox 丢失 ctx 显示。理由：
1. ModelSelector 在工具栏中，trigger 必须紧凑
2. ctx 信息在 `ContextUsageBadge` 组件中已有展示（ChatInput 工具栏里同时渲染了 `ContextUsageBadge`）
3. 视觉一致性优先于 listbox 中的冗余信息

### 决策 3：ChatInput 两个 dropdown 的视觉处理

DsSelect 默认 input 高度 36px（sm=28px），与原 `dropdown-trigger`（约 24px、12px 字体、紧凑 inline-flex）视觉差异较大。

**选择**：
- 用 `size="sm"`（28px）
- 通过外部 `:deep()` 选择器覆盖 input 样式，使其接近原 `dropdown-trigger` 视觉（紧凑、12px 字体、透明背景、hover 边框）
- listbox 是 Teleport to body，无法用 scoped `:deep` 覆盖，保留 DsSelect 默认 listbox 样式

### 决策 4：v-model 同步

ModelSelector：
- DsSelect 的 `update:modelValue` emit `string | number`
- `store.currentModel` 是 `Ref<string>`
- 用 computed + setter 桥接：`get() => store.currentModel`，`set?(v) => store.setModel(String(v))`

ChatInput：
- `selectedProviderId` / `selectedModelName` 都是 `Ref<string>`
- 直接用 `v-model="selectedProviderId"` / `v-model="selectedModelName"`，在 `@update:modelValue` 里调用 `selectProvider` / `selectModel` 保持原 emit 行为

---

## File Structure

- **创建**：`docs/superpowers/plans/2026-07-17-ds-select-adoption.md` — 本计划
- **修改**：`web/src/components/ModelSelector.vue` — 接入 DsSelect
- **修改**：`web/src/components/ChatInput.vue` — 只改 provider/model dropdown 部分（行 128-146）
- **只读**：`web/src/components/ui/DsSelect.vue` — 不修改
- **运行**：`cd web && npx vitest run` + `cd web && npx vue-tsc --noEmit`

---

## Task 1: 写入并提交本计划

**Files**:
- Create: `docs/superpowers/plans/2026-07-17-ds-select-adoption.md`

- [ ] **Step 1**：写入本计划文档
- [ ] **Step 2**：提交
  ```bash
  cd d:\Maxma\MaxmaHere
  git add docs/superpowers/plans/2026-07-17-ds-select-adoption.md
  git commit -m "docs: add DsSelect adoption plan for ModelSelector and ChatInput"
  ```

---

## Task 2: ModelSelector 接入 DsSelect

**Files**:
- Modify: `web/src/components/ModelSelector.vue`

### 设计

**模板替换**（行 2-27）：
```vue
<template>
  <div class="model-selector">
    <DsSelect
      :model-value="store.currentModel"
      :options="modelOptions"
      :placeholder="'选择模型'"
      :aria-label="'模型选择器'"
      size="sm"
      @update:model-value="onSelectModel"
    />
  </div>
</template>
```

**脚本替换**：
- 移除：`isOpen`、`toggleOpen`、`selectModel`、`onDocumentClick`、`onMounted`/`onUnmounted` 里的 document listener
- 移除：`groupedModels`、`formatCtx`（不再需要）
- 保留：`store`、`displayName`（仅用于 placeholder fallback，可选）
- 新增：`modelOptions` computed（`store.availableModels.map(m => ({ value: m.id, label: m.name }))`）
- 新增：`onSelectModel(id: string | number)` 调用 `store.setModel(String(id))`
- 保留：`onMounted(() => store.fetchAvailableModels())`

**样式替换**：
- 删除原 `.model-trigger`、`.model-dropdown`、`.dropdown-header`、`.model-list`、`.provider-group`、`.provider-label`、`.model-item`、`.model-item-name`、`.model-item-ctx`、`.empty-state`、`.close-btn` 等样式
- 保留 `.model-selector` 容器（最小化）
- 通过 `:deep(.ds-select__input)` 覆盖 DsSelect input 样式，保持紧凑视觉

### 测试影响

`modelSelector.spec.ts` 验证 `document.addEventListener('click', ...)` 注册和卸载。接入 DsSelect 后，ModelSelector 不再注册全局 click listener（DsSelect 内部自己管理 outside click）。

**处理**：更新测试，改为验证 DsSelect 被正确渲染（如验证 `.ds-select` class 存在、options 传递正确）。或者保留测试逻辑但移除全局 click listener 断言。

**选择**：更新测试，验证：
1. 组件挂载成功
2. 渲染了 DsSelect（`.ds-select` 存在）
3. options 正确传递
4. 选中 store.currentModel 对应的 option

### 验证步骤

- [ ] **Step 1**：读取 `ModelSelector.vue` 现状（已读）
- [ ] **Step 2**：用 DsSelect 替换自定义 dropdown
- [ ] **Step 3**：更新 `modelSelector.spec.ts`
- [ ] **Step 4**：运行 `cd d:\Maxma\MaxmaHere\web && npx vitest run modelSelector.spec.ts`
- [ ] **Step 5**：运行 `cd d:\Maxma\MaxmaHere\web && npx vitest run`
- [ ] **Step 6**：运行 `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
- [ ] **Step 7**：提交
  ```bash
  git add web/src/components/ModelSelector.vue web/tests/modelSelector.spec.ts
  git commit -m "refactor(model-selector): adopt DsSelect for ARIA combobox + keyboard nav

Replace custom dropdown with DsSelect component to gain WAI-ARIA Combobox
pattern, keyboard navigation (Arrow/Home/End/Enter/Escape/type-ahead),
and theme adaptation. Drop provider grouping and ctx display in listbox
since DsSelect has no slot support (constraint: do not modify DsSelect.vue).
Update test to verify DsSelect rendering instead of global click listener."
  ```

---

## Task 3: ChatInput provider/model dropdown 接入 DsSelect

**Files**:
- Modify: `web/src/components/ChatInput.vue`（只改行 128-146 的 dropdown 部分）

### 设计

**模板替换**（行 127-147 附近）：
```vue
<div class="input-right-group">
  <DsSelect
    class="provider-select"
    :model-value="selectedProviderId"
    :options="providerOptions"
    :placeholder="providers.length === 0 ? '未配置模型' : '选择提供商'"
    :aria-label="'LLM 提供商'"
    size="sm"
    @update:model-value="onSelectProvider"
  />
  <DsSelect
    v-if="currentModels.length"
    class="model-select"
    :model-value="selectedModelName"
    :options="modelOptions"
    :placeholder="'选择模型'"
    :aria-label="'模型'"
    size="sm"
    @update:model-value="onSelectModel"
  />
  <span class="input-separator"></span>
  ...
</div>
```

**脚本修改**：
- 移除：`openDropdown` ref、`toggleDropdown` 函数
- 移除：`onDocumentClick`、`onMounted`/`onUnmounted` 里的 document listener（行 749-753）
- 新增 computed：
  - `providerOptions = computed(() => providers.value.map(p => ({ value: p.id, label: p.label })))`
  - `modelOptions = computed(() => currentModels.value.map(m => ({ value: m, label: m })))`
- 重命名 `selectProvider` / `selectModel` 为 `onSelectProvider` / `onSelectModel`，参数类型改为 `string | number`，内部 `String(v)` 转换
  - `onSelectProvider(v)`：保留原 `selectProvider` 全部逻辑（设置 `selectedProviderId`、更新 `currentModels`、设置 `selectedModelName`、emit `modelChange`），只是不再操作 `openDropdown`
  - `onSelectModel(v)`：保留原 `selectModel` 全部逻辑

**样式修改**：
- 保留原 `.dropdown`、`.dropdown-trigger`、`.dropdown-menu`、`.dropdown-option` 等样式不再使用，可删除或保留（选择删除以保持整洁）
- 新增 `.provider-select` / `.model-select` 样式，用 `:deep(.ds-select__input)` 覆盖 input，使其接近原 `dropdown-trigger` 视觉：
  - 字体 12px
  - padding 4px 28px 4px 8px
  - 背景 transparent
  - border transparent（hover 时显示）
  - max-width 160px
  - color var(--text-secondary)
- provider 为空时显示红色：通过 `:class="{ empty: providers.length === 0 }"` 在外部加 class，用 `:deep` 覆盖 input color

### 验证步骤

- [ ] **Step 1**：读取 `ChatInput.vue` 现状（已读）
- [ ] **Step 2**：替换两个 dropdown 为 DsSelect
- [ ] **Step 3**：移除 `openDropdown` / `toggleDropdown` / `onDocumentClick` 及相关 onMounted/onUnmounted
- [ ] **Step 4**：调整样式
- [ ] **Step 5**：运行 `cd d:\Maxma\MaxmaHere\web && npx vitest run`
- [ ] **Step 6**：运行 `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
- [ ] **Step 7**：提交
  ```bash
  git add web/src/components/ChatInput.vue
  git commit -m "refactor(chat-input): adopt DsSelect for provider/model dropdowns

Replace custom provider and model dropdowns with DsSelect to gain
WAI-ARIA Combobox pattern and keyboard navigation. Preserve all existing
behavior: selectProvider updates currentModels and emits modelChange;
selectModel emits modelChange. Only the dropdown UI is replaced; textarea,
refs, drag/drop, resize, sticker, autocomplete, link input are untouched."
  ```

---

## Risk & Rollback

- **风险 1**：DsSelect listbox 是 Teleport to body + fixed 定位，在 ChatInput 的 `input-bottom-bar`（flex 容器）中可能定位异常。DsSelect 已有 `updatePopupPosition` 逻辑（计算 input rect，下方不够则上方），应该能正常工作。
- **风险 2**：DsSelect input 是 `<input readonly>`，可能与 ChatInput 的 `onKeydown`（textarea 上的）冲突。不会冲突，因为 DsSelect input 的 keydown 在 DsSelect 内部处理，不会冒泡到 textarea 的 `@keydown`（textarea 才有 `@keydown="onKeydown"`）。
- **风险 3**：测试 `modelSelector.spec.ts` 更新后可能遗漏边界。已在新测试中覆盖核心断言。
- **回滚**：`git revert` 两个 commit 即可恢复原状态。

## 偏差预期

- ModelSelector listbox 不再显示 ctx（context window）信息 — DsSelect 无 slot 约束
- ModelSelector listbox 不再按 provider 分组 — DsSelect 无分组支持
- ModelSelector trigger 不再有 model.svg icon — DsSelect trigger 是纯 input
- ChatInput 两个 dropdown 视觉略变 — DsSelect 是表单风格 input，原是紧凑 button
- 这些偏差均因"不修改 DsSelect.vue"约束导致，已在决策 1-3 中说明
