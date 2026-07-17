# 前端最终清扫与全面验证实施计划

> **执行者**: 独立高级前端工程师（清扫性质）
> **日期**: 2026-07-17
> **工作目录**: `d:\Maxma\MaxmaHere\web`
> **技术栈**: Vue 3 + TypeScript + Vite + Vitest

---

## 独占文件范围（可修改）

**显式范围**:
- `web/src/components/AutocompletePanel.vue`
- `web/src/components/RenderMarkdown.vue`
- `web/src/components/StickerInline.vue`
- `web/src/components/tools/*`（除 `FileEditBubble.vue`）
- `web/src/components/ui/DsTooltip.vue`
- `web/src/views/KbView.vue`
- `web/src/views/MemoryView.vue`

**Agent 41 报告中提到的有 TS6133/TS6196 错误的文件（除排除项）**:
- `web/src/api/index.ts`
- `web/src/views/McpView.vue`

**禁止修改（其他 agent 独占）**:
- `ModelSelector.vue`、`ChatInput.vue`、`ProvidersView.vue`、`tsconfig.json`（Agent 44）
- `types/`（Agent 45）
- `App.vue`、`ChatView.vue`、`ChatWindow.vue`（保留不动）
- `DsSelect.vue`（Agent 40 产物）
- `FileEditBubble.vue`（其他 agent 范围）

---

## Part A — 当前状态全面验证

### A.1 vue-tsc 基线

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

**结果**: ✅ EXIT=0，**0 个类型错误**

当前 `tsconfig.json` 配置 `noUnusedLocals: false` / `noUnusedParameters: false`，因此 TS6133/TS6196 不会触发。

### A.2 vitest 基线

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vitest run`

**结果**: ✅ **17 文件 / 49 测试全部通过**（duration 8.59s）

### A.3 noUnusedLocals 评估（临时启用以发现潜在问题）

为发现未使用变量/导入，创建了临时配置 `tsconfig.unused-check.json`（extends 原 tsconfig，仅开启 `noUnusedLocals: true` + `noUnusedParameters: true`），运行 `npx vue-tsc --noEmit -p tsconfig.unused-check.json`。

**结果**: 17 个错误，分布如下：

| # | 文件 | 行:列 | 错误码 | 描述 | 是否在范围内 |
|---|------|-------|--------|------|--------------|
| 1 | `src/api/index.ts` | 43:3 | TS6196 | `'AuditLogRecord'` 未使用导入 | ✅ 范围内 |
| 2 | `src/components/AutocompletePanel.vue` | 37:7 | TS6133 | `'emit'` 未使用 | ✅ 范围内 |
| 3 | `src/components/ChatInput.vue` | 228:15 | TS6196 | `'ProviderConfig'` 未使用 | ❌ Agent 44 |
| 4 | `src/components/ChatInput.vue` | 236:41 | TS6133 | `'onUnmounted'` 未使用 | ❌ Agent 44 |
| 5 | `src/components/ChatInput.vue` | 692:9 | TS6133 | `'linePixel'` 未使用 | ❌ Agent 44 |
| 6 | `src/components/RenderMarkdown.vue` | 7:20 | TS6133 | `'onUnmounted'` 未使用 | ✅ 范围内 |
| 7 | `src/components/StickerInline.vue` | 35:7 | TS6133 | `'props'` 未使用 | ✅ 范围内 |
| 8 | `src/components/tools/AskUserBubble.vue` | 150:20 | TS6133 | `'onMounted'` 未使用 | ✅ 范围内 |
| 9 | `src/components/tools/HolidayBubble.vue` | 132:7 | TS6133 | `'emit'` 未使用 | ✅ 范围内 |
| 10 | `src/components/tools/ImageBubble.vue` | 34:7 | TS6133 | `'emit'` 未使用 | ✅ 范围内 |
| 11 | `src/components/tools/MemoryBubble.vue` | 53:7 | TS6133 | `'emit'` 未使用 | ✅ 范围内 |
| 12 | `src/components/tools/TarotBubble.vue` | 88:7 | TS6133 | `'emit'` 未使用 | ✅ 范围内 |
| 13 | `src/components/ui/DsSelect.vue` | 152:5 | TS6133 | `'inputFocusedBeforeList'` 未使用 | ❌ Agent 40 |
| 14 | `src/components/ui/DsTooltip.vue` | 20:15 | TS6133 | `'watch'` 未使用 | ✅ 范围内 |
| 15 | `src/views/KbView.vue` | 205:10 | TS6133 | `'schedule'` 未使用 | ✅ 范围内 |
| 16 | `src/views/McpView.vue` | 132:26 | TS6133 | `'arg'` 未使用 | ✅ 范围内 |
| 17 | `src/views/ProvidersView.vue` | 404:16 | TS6133 | `'discoverProvider'` 未使用 | ❌ Agent 44 |

**范围内待修复**: 12 个错误（10 个 TS6133 + 2 个 TS6196）
**范围外（其他 agent）**: 5 个错误（ChatInput ×3、DsSelect ×1、ProvidersView ×1）

### A.4 常见代码问题 Grep 检查

#### console.log 在生产代码中

**结果**: 63 行 `console.log`，分布在以下文件：

| 文件 | 行数 | 是否在范围内 |
|------|------|--------------|
| `src/splash/main.ts` | 1 | ❌ splash 入口，非范围 |
| `src/api/index.ts` | 1 | ✅ 范围内 |
| `src/components/ChatInput.vue` | 8 | ❌ Agent 44 |
| `src/composables/useChat.ts` | 35 | ❌ 非范围（composable） |
| `src/utils/env.ts` | 3 | ❌ 非范围 |
| `src/views/SoulView.vue` | 4 | ❌ 非范围 |
| `src/components/StickerPicker.vue` | 4 | ❌ 非范围 |
| `src/components/tools/AskUserBubble.vue` | 1 | ✅ 范围内 |
| `src/components/tools/WeatherBubble.vue` | 1 | ✅ 范围内 |

**处置**: Part A 仅记录。Part B 修复 TS6133 时如触及范围内文件，不主动清理 console.log（避免越界改动；任务 Part B 聚焦 TS6133/TS6196）。

#### TODO / FIXME 注释

**结果**: ✅ **0 处**（无 TODO/FIXME 注释）

#### @ts-ignore / @ts-expect-error

**结果**: ✅ **0 处**（无类型抑制注释）

### A.5 当前状态总结

| 维度 | 状态 |
|------|------|
| vue-tsc（默认配置） | ✅ 0 错误 |
| vitest | ✅ 49/49 通过 |
| noUnusedLocals 评估 | ⚠️ 17 错误（12 范围内 + 5 范围外） |
| console.log | ⚠️ 63 行（多数在范围外） |
| TODO/FIXME | ✅ 0 |
| @ts-ignore/@ts-expect-error | ✅ 0 |

---

## Part B — 清扫未使用变量和类型错误

### 修复策略

对每个范围内的文件：
1. 读取文件理解上下文
2. TS6133（未使用变量）：若变量确实未使用，删除声明；若是 Vue `defineEmits`/`defineProps` 的返回值未使用，可改为 `defineEmits()` 不赋值或前缀 `_`
3. TS6196（未使用导入）：删除该导入
4. 每修复 3-5 个文件运行一次 `npx vue-tsc --noEmit -p tsconfig.unused-check.json` 确认错误减少
5. 每 3-5 个文件提交一次

### Task B1: 修复 `src/api/index.ts` — 删除未使用导入 AuditLogRecord

- 第 43 行：`AuditLogRecord` 导入未使用
- 需先读取确认该类型在其他位置未使用（可能仅是 import 列表中遗留）
- 修复：从 import 语句中移除 `AuditLogRecord`

### Task B2: 修复 `src/components/AutocompletePanel.vue` — emit 未使用

- 第 37 行：`const emit = defineEmits(...)` 的 `emit` 未使用
- 若组件确实不触发事件，可改为 `defineEmits(...)` 不赋值
- 需读取确认无 `emit(` 调用

### Task B3: 修复 `src/components/RenderMarkdown.vue` — onUnmounted 未使用

- 第 7 行：从 `vue` 导入的 `onUnmounted` 未使用
- 修复：从 import 中删除 `onUnmounted`

### Task B4: 修复 `src/components/StickerInline.vue` — props 未使用

- 第 35 行：`const props = defineProps(...)` 的 `props` 未使用
- 若模板中使用 `defineProps` 暴露的字段（不需 `props.` 前缀），可改为 `defineProps(...)` 不赋值
- 需读取确认模板用法

### Task B5: 修复 `src/components/tools/AskUserBubble.vue` — onMounted 未使用

- 第 150 行：从 `vue` 导入的 `onMounted` 未使用
- 修复：从 import 中删除 `onMounted`

### Task B6: 修复 `src/components/tools/HolidayBubble.vue` — emit 未使用

- 第 132 行：`const emit = defineEmits(...)` 的 `emit` 未使用
- 修复：改为 `defineEmits(...)` 不赋值（需确认无 emit 调用）

### Task B7: 修复 `src/components/tools/ImageBubble.vue` — emit 未使用

- 第 34 行：`const emit = defineEmits(...)` 的 `emit` 未使用
- 修复：改为 `defineEmits(...)` 不赋值

### Task B8: 修复 `src/components/tools/MemoryBubble.vue` — emit 未使用

- 第 53 行：`const emit = defineEmits(...)` 的 `emit` 未使用
- 修复：改为 `defineEmits(...)` 不赋值

### Task B9: 修复 `src/components/tools/TarotBubble.vue` — emit 未使用

- 第 88 行：`const emit = defineEmits(...)` 的 `emit` 未使用
- 修复：改为 `defineEmits(...)` 不赋值

### Task B10: 修复 `src/components/ui/DsTooltip.vue` — watch 未使用

- 第 20 行：从 `vue` 导入的 `watch` 未使用
- 修复：从 import 中删除 `watch`

### Task B11: 修复 `src/views/KbView.vue` — schedule 未使用

- 第 205 行：`schedule` 变量声明未使用
- 需读取理解上下文，可能是解构遗留或未实现的功能
- 修复：删除该声明

### Task B12: 修复 `src/views/McpView.vue` — arg 未使用

- 第 132 行：`arg` 参数未使用（可能是回调参数）
- 修复：前缀 `_` 或删除（若是回调签名要求则前缀 `_`）

### 提交计划

- Commit 1（B1-B4）: api/index.ts + AutocompletePanel + RenderMarkdown + StickerInline
- Commit 2（B5-B9）: tools/AskUserBubble + HolidayBubble + ImageBubble + MemoryBubble + TarotBubble
- Commit 3（B10-B12）: DsTooltip + KbView + McpView

每个 commit 后运行 `npx vue-tsc --noEmit -p tsconfig.unused-check.json` 确认错误数下降。
全部完成后运行 `npx vue-tsc --noEmit`（默认配置）+ `npx vitest run` 确认无回归。

---

## Part C — 视觉一致性检查

### C.1 硬编码颜色（`#` 开头，在 .vue 的 `<style>` 块中）

**搜索范围**: `web/src/**/*.vue`

**结果**: 全仓库有大量硬编码颜色，但在我的独占范围内：

| 文件 | 行 | 颜色 | 用途 | 处置 |
|------|----|----|------|------|
| `StickerInline.vue` | 107 | `#fff` | 白色文字（贴纸前景） | tint 色，保留 |
| `McpView.vue` | 758-760 | sse/streamable_http/websocket 三组 tint | 传输类型徽章 | tint 色，保留 |
| `tools/GitDiffBubble.vue` | 多 | 绿/红/蓝 diff 色 | 代码差异语义色 | tint 色，保留 |
| `tools/FileDiffView.vue` | 多 | 绿/红/蓝 diff 色 | 代码差异语义色 | tint 色，保留 |
| `tools/GitStatusBubble.vue` | 多 | 绿/黄/蓝/红状态色 | git 状态徽章 | tint 色，保留 |
| `tools/HolidayBubble.vue` | 多 | 节日类型色 | legal/solar/lunar/term 分类 | tint 色，保留 |
| `tools/FilesBubble.vue` | 多 | 成功绿色 | 状态指示 | tint 色，保留 |
| `tools/AskUserBubble.vue` | 473-474 | 红色错误背景 | 错误状态 | tint 色，保留 |

**结论**: 我范围内所有硬编码颜色均为**语义状态 tint 色**（success/error/warning/diff/分类徽章），按任务"排除你已经知道保留的 tint 色"指示，**全部保留，不修改**。

### C.2 内联样式 `style="..."`

**搜索**: `style="` 在 .vue 文件

**结果**: ✅ **0 处**纯内联样式（grep 命中的 1 行实为 `:style=` 绑定，见下）

### C.3 `:style=` 绑定

**搜索**: `:style=` 在 .vue 文件

**结果**: 1 处
- `src/components/ui/DsSelect.vue:57` — `:style="popupStyle"`（动态弹出层定位）

**处置**: 该文件是 Agent 40 的产物，**不在我的范围内，不修改**。该 `:style` 绑定用于动态弹出层定位（`popupStyle` 是计算后的定位对象），属合理用法。

### C.4 视觉一致性结论

- 内联样式：✅ 0 处（clean）
- `:style=` 绑定：1 处（范围外，合理用法）
- 硬编码颜色：范围内全部为 tint 色，按指示保留
- **无需修复的视觉一致性问题**

---

## Part D — 最终全面验证

### D.1 vue-tsc 默认配置

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`

**预期**: ✅ EXIT=0，0 错误（与基线一致，因为默认 tsconfig 不开启 noUnusedLocals）

### D.2 noUnusedLocals 启用后验证

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit -p tsconfig.unused-check.json`

**预期**: 17 → 5 错误（范围内 12 个全部修复，剩余 5 个为其他 agent 范围）

### D.3 vitest

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vitest run`

**预期**: ✅ 49/49 测试通过（无回归）

### D.4 vite build

**命令**: `cd d:\Maxma\MaxmaHere\web && npx vite build`

**预期**: ✅ 构建成功

### D.5 清理临时文件

删除 `tsconfig.unused-check.json`（临时评估文件，不应提交）。

---

## 风险与回退

- **Part B 风险低**: 仅删除未使用的 import/变量，不影响运行时行为
- **defineEmits 改动**: 将 `const emit = defineEmits(...)` 改为 `defineEmits(...)` 不赋值，需确认模板/脚本中无 `emit(` 调用
- **defineProps 改动**: 类似，需确认模板中使用解构后的字段而非 `props.xxx`
- **回退**: 每个 commit 独立，可 `git revert` 单个 commit

## 执行顺序

1. ✅ Part A（已完成）：当前状态验证
2. ✅ Part B Task B1-B12：逐个修复未使用变量/导入
3. ✅ Part B 提交：3 个 commit
4. ✅ Part C（已完成）：视觉一致性检查（结论：无需修复）
5. ✅ Part D：最终验证（vue-tsc + vitest + vite build 全通过）
6. ✅ 清理临时文件 tsconfig.unused-check.json

---

## 执行结果（2026-07-17 实测）

### Part B — 修复结果

**12 个范围内 TS6133/TS6196 错误全部修复**：

| Task | 文件 | 修复内容 |
|------|------|----------|
| B1 | `src/api/index.ts` | 删除未使用的 `AuditLogRecord` 类型导入（TS6196） |
| B2 | `src/components/AutocompletePanel.vue` | `const emit = defineEmits<…>()` → `defineEmits<…>()`（模板用 `$emit`，TS6133） |
| B3 | `src/components/RenderMarkdown.vue` | 从 vue 导入中删除 `onUnmounted`（TS6133） |
| B4 | `src/components/StickerInline.vue` | `const props = defineProps<…>()` → `defineProps<…>()`（模板直接用字段，TS6133） |
| B5 | `src/components/tools/AskUserBubble.vue` | 从 vue 导入中删除 `onMounted`（TS6133） |
| B6 | `src/components/tools/HolidayBubble.vue` | `const emit = defineEmits<…>()` → `defineEmits<…>()`（TS6133） |
| B7 | `src/components/tools/ImageBubble.vue` | 同上（TS6133） |
| B8 | `src/components/tools/MemoryBubble.vue` | 同上（TS6133） |
| B9 | `src/components/tools/TarotBubble.vue` | 同上（TS6133） |
| B10 | `src/components/ui/DsTooltip.vue` | 从 vue 导入中删除 `watch`（TS6133） |
| B11 | `src/views/KbView.vue` | 删除从未调用的 `schedule()` 函数（TS6133） |
| B12 | `src/views/McpView.vue` | v-for `(arg, i)` → `(_arg, i)`（TS6133，模板未用 arg） |

**noUnusedLocals 验证**: 17 → 5 错误（范围内 12 个全清；剩余 5 个为其他 agent 范围：ChatInput ×3、DsSelect ×1、ProvidersView ×1）

### Commits

| Hash | Message |
|------|---------|
| `766fe27` | fix(web): remove unused imports/vars in api, AutocompletePanel, RenderMarkdown, StickerInline |
| `170f3f2` | fix(web/tools): remove unused emit bindings and onMounted import in 5 bubble components |
| `a2469cd` | fix(web): remove unused watch import, dead schedule fn, unused v-for arg in DsTooltip/KbView/McpView |

### Part C — 视觉一致性结论

- 内联 `style="..."`: **0 处**（clean）
- `:style=` 绑定: 1 处（DsSelect.vue，Agent 40 范围，合理用法）
- 硬编码颜色: 范围内全部为 tint 色（success/error/diff/分类徽章），按指示保留
- **无需修复**

### Part D — 最终验证

| 验证项 | 命令 | 结果 |
|--------|------|------|
| vue-tsc（默认） | `npx vue-tsc --noEmit` | ✅ EXIT=0，**0 错误** |
| vitest | `npx vitest run` | ✅ **17 文件 / 49 测试全通过**（9.13s） |
| vite build | `npx vite build` | ✅ **构建成功**（578 模块，10.20s） |

构建中的两个 warning 均为**预先存在**，与本次改动无关：
1. `api/index.ts` 被动态+静态混合导入（pre-existing chunking 提示）
2. codemirror/markdown-vendor chunk 超过 500 kB（pre-existing chunk size 提示）

### 临时文件清理

- ✅ `web/tsconfig.unused-check.json`（noUnusedLocals 评估用临时配置）已删除，未提交

### 偏差说明

1. **noUnusedLocals 未永久开启**: 当前 `tsconfig.json` 的 `noUnusedLocals`/`noUnusedParameters` 仍为 `false`（Agent 44 独占范围，不可修改）。范围内 12 个错误已全部修复，待 Agent 44 修复 ChatInput.vue（3 个）和 ProvidersView.vue（1 个）+ Agent 40 修复 DsSelect.vue（1 个）后即可安全开启。
2. **console.log 未清理**: Part A 记录了 63 行 console.log，但多数在范围外文件（useChat.ts/env.ts/SoulView.vue/StickerPicker.vue/splash/main.ts 等）。范围内仅 api/index.ts（1 行）、AskUserBubble.vue（1 行）、WeatherBubble.vue（1 行），但 Part B 任务聚焦 TS6133/TS6196，未越界清理 console.log（遵循"只做直接要求的改动"原则）。
3. **KbView.vue 的 schedule 函数移除**: 删除了从未调用的 `schedule()` 函数。保留了 `timers` 数组和 `onUnmounted` 清理逻辑（虽然成为 dead code，但不在 TS6133 报错范围内，未做额外重构）。
4. **并发 agent 干扰**: 执行期间 Agent 44 并发修改了 `ModelSelector.vue` 和 `modelSelector.spec.ts`（git status 可见），这些改动不属于本 agent，未被提交。
