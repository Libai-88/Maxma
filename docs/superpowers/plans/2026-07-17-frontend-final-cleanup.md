# 前端收尾优化实施计划（2026-07-17）

## 范围与独占文件

仅修改以下 4 个源文件（+ 1 个测试文件需联动更新）：

- `web/src/components/ModelSelector.vue` — Part A
- `web/src/components/ChatInput.vue` — Part B
- `web/src/views/ProvidersView.vue` — Part C
- `web/tsconfig.json` — Part C
- `web/tests/modelSelector.spec.ts` — Part A 联动（测试直接断言 options 形状，恢复 provider 字段后必须同步更新；该测试只测 ModelSelector，属本任务职责范围）

**不碰**：`types/`、`App.vue`、`ChatView.vue`、`DsSelect.vue`（已由 Agent 40 增强）、其他 agent 文件。

## 关键前置事实（已读取确认）

1. **DsSelect API（Agent 40 已增强）**
   - `groupKey?: string` prop：按 `opt[groupKey]` 字段聚合分组，渲染不可选的 group header（`role="presentation"`）。字段缺失归入 "其他"。
   - `#option` slot：入参 `{ option, active, selected }`，可自定义选项渲染。
   - `#trigger` slot：入参 `{ open, toggle }`，可自定义触发器（默认是 input+caret）。
   - ARIA + 键盘导航（ArrowUp/Down/Home/End/Enter/Escape/Tab/type-ahead）完全在 DsSelect 内部实现，使用 slot 不会破坏。

2. **ModelInfo 类型**（`web/src/types/chat.ts`，Agent 45 负责不改）：
   ```ts
   export interface ModelInfo {
     id: string
     provider: string
     name: string
     contextWindow: number  // tokens
   }
   ```

3. **ModelSelector 当前实现**：仅 `{ value: m.id, label: m.name }`，丢失 provider 与 ctx。

4. **ChatInput StickerPicker import**：第 223 行同步 `import StickerPicker from '@/components/StickerPicker.vue'`；`stickerPickerRef` 类型为 `InstanceType<typeof StickerPicker> | null`。模板第 175 行 `<StickerPicker v-if="showStickerPicker" ref="stickerPickerRef" ... />`（已 v-if 条件渲染，懒加载收益明确）。

5. **discoverProvider**：`ProvidersView.vue:404` 定义，全文件仅此一处出现，模板未引用 → 真正的死代码，直接删除。

6. **tsconfig.json**：当前 `noUnusedLocals: false`、`noUnusedParameters: false`。

7. **现有测试**：`web/tests/modelSelector.spec.ts` 用 `toEqual([{value,label}])` 严格断言 options 形状。Part A 加 provider 字段后必须同步更新此断言（使用 `toMatchObject` 或更新为含 provider 的完整对象）。

## Part A: ModelSelector 恢复 ctx 显示 + provider 分组

### 目标
- 按 provider 分组渲染（使用 DsSelect `groupKey="provider"`）
- 每个选项显示 `model.name` + ctx 标记（如 "8k"、"128k"）
- 保留 DsSelect 全部 ARIA + 键盘导航

### 实现
1. `modelOptions` computed 扩展为：
   ```ts
   store.availableModels.map(m => ({
     value: m.id,
     label: m.name,
     provider: m.provider,
     contextWindow: m.contextWindow,
   }))
   ```
2. 模板加 `group-key="provider"` prop。
3. 模板加 `#option` slot：
   ```html
   <template #option="{ option }">
     <span class="model-option-name">{{ option.label }}</span>
     <span v-if="option.contextWindow" class="model-option-ctx">{{ formatCtx(option.contextWindow) }}</span>
   </template>
   ```
4. 新增 `formatCtx` 工具函数：tokens → 人类可读（≥1000 → `${Math.round(n/1000)}k`，否则原数）。
5. trigger slot 不改（原 input 触发器视觉已与 DsSelect 融合，恢复 svg icon 非必需且会增加复杂度；任务说"可选"）。
6. 加少量 scoped 样式：`.model-option-ctx` 右对齐、小字号、tertiary 色。
7. 更新 `tests/modelSelector.spec.ts`：options 断言改为含 provider+contextWindow 的完整对象（保持 toEqual 严格性，反映新契约）。

### 验证
- `cd web && npx vitest run tests/modelSelector.spec.ts`
- `cd web && npx vue-tsc --noEmit`

### 提交
`feat(ModelSelector): restore provider grouping and context-window display via DsSelect slots`

## Part B: StickerPicker 懒加载

### 目标
将同步 import 改为 `defineAsyncComponent`，减小初始 chunk。

### 实现
1. 第 236 行 vue import 中加 `defineAsyncComponent`。
2. 第 223 行改为：
   ```ts
   const StickerPicker = defineAsyncComponent(() => import('@/components/StickerPicker.vue'))
   ```
3. `stickerPickerRef` 类型 `InstanceType<typeof StickerPicker> | null` 仍成立（defineAsyncComponent 返回的组件类型与原组件兼容）。
4. 模板 `<StickerPicker v-if="showStickerPicker" ... />` 不变（v-if 已保证仅在打开时挂载，懒加载进一步推迟 chunk 加载）。

### 验证
- `cd web && npx vue-tsc --noEmit`
- `cd web && npx vitest run`

### 提交
`perf(ChatInput): lazy-load StickerPicker via defineAsyncComponent`

## Part C: 修复 discoverProvider + 开启 noUnusedLocals

### 目标
删除死代码 `discoverProvider`，开启 `noUnusedLocals` + `noUnusedParameters`，全量 vue-tsc 无 TS6133。

### 实现
1. 删除 `ProvidersView.vue` 第 404-411 行 `discoverProvider` 函数。
2. `tsconfig.json`：`noUnusedLocals: true`、`noUnusedParameters: true`。
3. 运行 `npx vue-tsc --noEmit`，确认无 TS6133/TS6133 等未使用错误。若出现新错误（非本任务独占文件），记录为偏差但**不修改**（属其他 agent 职责）。

### 验证
- `cd web && npx vue-tsc --noEmit`
- `cd web && npx vitest run`

### 提交
`chore(tsconfig): enable noUnusedLocals/noUnusedParameters; remove dead discoverProvider`

## 风险与回退

- **Part A 测试联动**：如不更新 modelSelector.spec.ts，vitest 会失败。更新是必要的、最小化的，仅改 options 断言形状。
- **Part C 全量 tsc**：开启 noUnusedLocals 可能暴露其他文件未使用变量。任务背景称 Agent 43 评估仅 1 个错误（discoverProvider），但其他 agent 可能已引入新代码。若发现非独占文件的新错误，记录偏差，不擅自修改。
- 回退：每个 Part 独立 commit，可逐个 `git revert`。
