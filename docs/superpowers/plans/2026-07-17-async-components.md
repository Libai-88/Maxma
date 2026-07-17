# 重型组件懒加载实施计划

- 日期：2026-07-17
- 范围：将 5 个重型组件的同步 import 改为 `defineAsyncComponent` 懒加载
- 技术栈：Vue 3 + TypeScript + Vite + Vitest

## 1. 现状审计（Step 1 实测结果）

对 `web/src/` 全量 Grep，确认 5 个重型组件的**实际**引用方：

| 组件 | 实际 import 位置 | import 方式 | 是否在独占范围 |
| --- | --- | --- | --- |
| `MediaViewer.vue` | `App.vue:135` | 同步 `import MediaViewer from '@/components/MediaViewer.vue'` | ❌ App.vue 属 Agent 39 |
| `FileDiffView.vue` | `components/tools/FileEditBubble.vue:152` | 同步 `import FileDiffView from './FileDiffView.vue'` | ❌ 非独占范围（FileEditBubble 本身已在 registry.ts 懒加载） |
| `MapBubble.vue` | `components/tools/registry.ts:18` | **已懒加载** `lazyBubble(() => import('./MapBubble.vue'))` | — 已完成，无需改动 |
| `StickerPicker.vue` | `components/ChatInput.vue:222` | 同步 `import StickerPicker from '@/components/StickerPicker.vue'` | ❌ ChatInput 属 Agent 36 |
| `CodeCard.vue` | `components/workbench/canvas-registry.ts:2` | 同步 `import CodeCard from './cards/CodeCard.vue'` | ⚠️ 见下方说明 |

### 独占范围文件实测结论

- `web/src/views/ChatView.vue`：**未直接 import 任何一个 5 重型组件**。其 import 列表为 ChatInput、ChatWindow、ContextUsageBadge、SessionPermissionModeControl、WorkflowCard、StatusBadge、TaskTrackerBar、WorkbenchPanel、ReasoningTimeline、CanvasContainer、WelcomeScreen、ChatHeader、ModelSelector。无需改动。
- `web/src/components/ChatWindow.vue`：**未直接 import 任何一个 5 重型组件**。其 import 列表为 ContextMenu、MessageBubble、ThinkingBlock、ToolBubbleRouter、PlanCard、ApprovalBubble、SubAgentCard。无需改动。
- `web/src/components/workbench/CanvasContainer.vue`：**未直接 import CodeCard**，但通过 `getCardComponent()`（来自 `canvas-registry.ts`）间接使用 CodeCard（`code` 与 `json` 类型均映射到 CodeCard）。
- `web/src/components/workbench/Tabs.vue`：**文件不存在**。实际存在的是 `CanvasTabs.vue`，且其不 import CodeCard。不适用。

### 关键偏差说明

任务背景假设 5 个重型组件"在引用方（如 ChatView.vue、ChatWindow.vue）中是同步导入的"，但实测表明：
1. ChatView.vue / ChatWindow.vue **均不直接 import** 这 5 个组件；
2. 5 个组件中，MapBubble **已懒加载**；其余 4 个的实际同步 import 分布在 App.vue（Agent 39）、ChatInput.vue（Agent 36）、FileEditBubble.vue、canvas-registry.ts。

## 2. 可执行改动

### 2.1 CodeCard → 懒加载（本计划唯一代码改动）

- 文件：`web/src/components/workbench/canvas-registry.ts`
- 理由：CanvasContainer.vue（独占范围）通过本注册表间接引用 CodeCard；canvas-registry.ts 是 CanvasContainer.vue 的伴生 .ts 注册表，未被任何其他 agent 认领，且约束中明确禁止的是"其他 .vue 文件"，本文件为 .ts。
- 改动：

  before:
  ```ts
  import type { Component } from 'vue'
  import CodeCard from './cards/CodeCard.vue'
  ```
  after:
  ```ts
  import { defineAsyncComponent, type Component } from 'vue'
  const CodeCard = defineAsyncComponent(() => import('./cards/CodeCard.vue'))
  ```

- 类型兼容性：`defineAsyncComponent` 返回 `Component`，registry 的类型 `Record<CanvasCardType, Component>` 保持兼容；`getCardComponent` 签名不变；CanvasContainer.vue 模板与脚本均无需改动。
- 不加 loadingComponent：项目无现成 LoadingSpinner，采用最简形式。CodeCard 作为本地 chunk 加载极快，无 loading 态可接受。
- 仅改 CodeCard（任务点名的 5 组件之一），其余卡片（TableCard/SummaryCard 等）保持同步，遵循最小改动原则。

### 2.2 其余 4 个组件——不在独占范围，仅记录

- MediaViewer：App.vue → Agent 39 负责
- StickerPicker：ChatInput.vue → Agent 36 负责
- FileDiffView：FileEditBubble.vue 已被 registry.ts 懒加载，FileDiffView 随其按需加载，非独占范围
- MapBubble：已完成

### 2.3 ChatView.vue / ChatWindow.vue / Tabs.vue

- ChatView.vue、ChatWindow.vue：无 5 组件的直接 import，不改。
- Tabs.vue：不存在，不适用。

## 3. 验证步骤

1. `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
2. `cd d:\Maxma\MaxmaHere\web && npx vitest run`
3. （可选）`cd d:\Maxma\MaxmaHere\web && npx vite build` 查看 CodeCard 是否独立成 chunk

## 4. 提交策略

- 单次改动即提交一次，message 遵循仓库 conventional commit 风格：
  `perf(workbench): lazy-load CodeCard via defineAsyncComponent in canvas-registry`

## 5. 风险

- 极低。defineAsyncComponent 是 Vue 官方 API，返回值与同步组件在 `<component :is>` 中行为一致，仅延迟加载时机，不改变渲染结果。
