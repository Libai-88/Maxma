# FileDiffView 懒加载 & types/index.ts 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FileEditBubble.vue 中同步导入的 FileDiffView 改为 defineAsyncComponent 懒加载；将 types/index.ts 按域拆分为 8 个新类型文件，并通过 re-export 保持向后兼容。

**Architecture:**
- Part A：仅修改 `FileEditBubble.vue` 一行 import，用 `defineAsyncComponent(() => import(...))` 包裹。FileDiffView 仅在工具结果渲染 diff 时使用，懒加载可减小初始 bundle。
- Part B：将 `types/index.ts` 中 8 个域的类型定义迁移到独立的 `session.ts / mcp.ts / news.ts / skills.ts / metrics.ts / kb.ts / activity.ts / workflow.ts`。index.ts 末尾用 `export * from './<domain>'` re-export，保证所有现有 `import { X } from '@/types'` 不破坏。

**Tech Stack:** Vue 3.4 + TypeScript 5.4 + Vite 5 + Vitest 2.1 + vue-tsc 2.0

---

## 范围与约束

### 独占文件范围（仅可修改这些文件）
- `web/src/components/tools/FileEditBubble.vue`（Part A）
- `web/src/types/index.ts`（Part B，改为 re-export）
- 新增 8 个文件：`web/src/types/{session,mcp,news,skills,metrics,kb,activity,workflow}.ts`

### 不修改的文件
- `App.vue`、`ChatWindow.vue`（Agent 43 范围）
- `ChatView.vue`、`ChatInput.vue`、`useChatInput.ts`（Agent 41 范围）
- `DsSelect.vue`、`Icon.vue`（Agent 40 范围）
- `ModelSelector.vue`（已完成）

### 关键约束
1. **向后兼容**：所有现有 `import { X } from '@/types'` 必须仍然工作（通过 `export *` re-export 保证）
2. **不破坏已有 split 文件**：`types/provider.ts` 和 `types/audit-log.ts` 已用 `export type { X } from './index'` 反向 re-export。**必须保留** `ProviderConfig / ListProvidersResponse / TestConnectionResponse / ProviderHealthCheckResponse / DiscoverModelsResponse` 和 `AuditLogRecord / AuditLogStats / AuditLogListResponse` 在 index.ts 中的定义，否则会破坏这两个文件的 re-export。
3. **无跨文件依赖**：8 个新域文件内的类型彼此无依赖，仅依赖同文件内类型。

---

## File Structure

### 新增文件
- `web/src/types/session.ts` — SessionInfo, CreateSessionResponse, ConstifyResponse, ListSessionsResponse, PermissionMode, SessionPermissionModeResponse, DeferredRunStatus, DeferredRun, ListDeferredRunsResponse
- `web/src/types/workflow.ts` — WorkflowRunStatus, WorkflowStepSummary, WorkflowRun, WorkflowDefinitionsResponse, ListWorkflowRunsResponse
- `web/src/types/mcp.ts` — MCPTransport, MCPServerInfo, MCPServerConfig, ListMCPServersResponse, MCPServerCreateBody, MCPServerUpdateBody, MCPServerToolsResponse
- `web/src/types/news.ts` — NewsEntry, ListNewsResponse
- `web/src/types/skills.ts` — SkillInfo, SkillDetail, SkillCreateBody, SkillUpdateBody, ListSkillsResponse, MacroInfo, MacroDetail, MacroCreateBody, MacroUpdateBody, ListMacrosResponse
- `web/src/types/metrics.ts` — MetricsHistogram, MetricsSnapshot, MetricsHistoryResponse
- `web/src/types/kb.ts` — KbDocument, KbSearchResult
- `web/src/types/activity.ts` — ActivityRecord, ActivityRecentResponse, ActivityStatsResponse, ActivityClearResponse

### 修改文件
- `web/src/components/tools/FileEditBubble.vue` — import 改 defineAsyncComponent
- `web/src/types/index.ts` — 删除已迁移类型定义；末尾加 `export * from './<domain>'`

### 保留在 index.ts 的类型（不迁移）
- WebSocket 服务端事件（ThinkingStartEvent…ServerEvent）
- WebSocket 客户端消息（ChatMessage…ClientMessage）
- 前端 UI 状态（ThinkingBlock, AskUserInteraction, ToolCall, MemoryToolEvent, SystemTurnEvent, TurnEvent, ChatTurn, PlanCard）
- NarrativeResponse, MomentItem, MomentResponse
- Vignette 记忆分区类型
- DeepSeek 余额
- 上下文窗口用量
- 健康检查
- **Provider 类型**（provider.ts 反向 re-export 依赖）
- 内置工具 / 路径白名单 / MaxmaBlocker / 工具环境变量
- **AuditLog 类型**（audit-log.ts 反向 re-export 依赖）

---

## Task 1: Part A — FileDiffView 懒加载

**Files:**
- Modify: `web/src/components/tools/FileEditBubble.vue:147-152`

- [ ] **Step 1: 读取 FileEditBubble.vue 确认当前 import**

当前 `<script setup lang="ts">` 顶部：
```ts
import { computed } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'
import MaxmaBlockerError from './_shared/MaxmaBlockerError.vue'
import FileDiffView from './FileDiffView.vue'
```
FileDiffView.vue 实际位于 `web/src/components/tools/FileDiffView.vue`（同目录相对路径正确）。模板中 `<FileDiffView ... />` 在 `edit` / `multi_edit` 分支条件渲染（`v-if="hasDiff"`），仅当工具产生 diff 时才需要，适合懒加载。

- [ ] **Step 2: 改为 defineAsyncComponent**

将 import 块改为：
```ts
import { computed, defineAsyncComponent } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'
import MaxmaBlockerError from './_shared/MaxmaBlockerError.vue'

const FileDiffView = defineAsyncComponent(() => import('./FileDiffView.vue'))
```

说明：
- `defineAsyncComponent` 从 `vue` 顶层导入，与现有 `computed` 合并到同一 import 语句
- 保持相对路径 `./FileDiffView.vue`（与原代码一致，避免引入 `@/components/tools/...` 歧义）
- `const FileDiffView` 在 `<script setup>` 顶层声明，模板中可直接使用（Vue 自动暴露顶层绑定）
- 无需修改模板，`<FileDiffView ... />` 引用方式不变

- [ ] **Step 3: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无错误退出（exit 0）。若 vue-tsc 报错需检查 defineAsyncComponent 类型推导。

- [ ] **Step 4: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 所有测试通过（无新增失败）。

- [ ] **Step 5: 提交 Part A**

```bash
cd d:\Maxma\MaxmaHere\web
git add src/components/tools/FileEditBubble.vue
git commit -m "perf(tools): lazy-load FileDiffView in FileEditBubble via defineAsyncComponent"
```

---

## Task 2: Part B — 创建 8 个域类型文件并迁移定义

**Files:**
- Create: `web/src/types/session.ts`
- Create: `web/src/types/workflow.ts`
- Create: `web/src/types/mcp.ts`
- Create: `web/src/types/news.ts`
- Create: `web/src/types/skills.ts`
- Create: `web/src/types/metrics.ts`
- Create: `web/src/types/kb.ts`
- Create: `web/src/types/activity.ts`

每个新文件从 index.ts 原样迁移对应类型的定义（含注释），不修改类型本身。

- [ ] **Step 1: 创建 session.ts**

迁移 index.ts 行 432-492 的类型（SessionInfo, CreateSessionResponse, ConstifyResponse, ListSessionsResponse, PermissionMode, SessionPermissionModeResponse, DeferredRunStatus, DeferredRun, ListDeferredRunsResponse）。文件顶部加文件级注释。

- [ ] **Step 2: 创建 workflow.ts**

迁移 index.ts 行 494-525 的类型（WorkflowRunStatus, WorkflowStepSummary, WorkflowRun, WorkflowDefinitionsResponse, ListWorkflowRunsResponse）。

- [ ] **Step 3: 创建 mcp.ts**

迁移 index.ts 行 828-905 的类型（MCPTransport, MCPServerInfo, MCPServerConfig, ListMCPServersResponse, MCPServerCreateBody, MCPServerUpdateBody, MCPServerToolsResponse）。

- [ ] **Step 4: 创建 news.ts**

迁移 index.ts 行 690-706 的类型（NewsEntry, ListNewsResponse）。

- [ ] **Step 5: 创建 skills.ts**

迁移 index.ts 行 708-772 的类型（SkillInfo, SkillDetail, SkillCreateBody, SkillUpdateBody, ListSkillsResponse, MacroInfo, MacroDetail, MacroCreateBody, MacroUpdateBody, ListMacrosResponse）。

- [ ] **Step 6: 创建 metrics.ts**

迁移 index.ts 行 932-978 的类型（MetricsHistogram, MetricsSnapshot, MetricsHistoryResponse）。

- [ ] **Step 7: 创建 kb.ts**

迁移 index.ts 行 907-930 的类型（KbDocument, KbSearchResult）。

- [ ] **Step 8: 创建 activity.ts**

迁移 index.ts 行 1004-1028 的类型（ActivityRecord, ActivityRecentResponse, ActivityStatsResponse, ActivityClearResponse）。

- [ ] **Step 9: 暂存所有新文件并运行类型检查（此时未改 index.ts，应仍通过）**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 通过（新文件尚未被引用，不影响现有编译）。

---

## Task 3: Part B — 更新 index.ts 删除已迁移定义并加 re-export

**Files:**
- Modify: `web/src/types/index.ts`

- [ ] **Step 1: 删除 index.ts 中已迁移到 8 个新文件的类型定义**

逐段删除：
- `// === 会话与 API 类型 ===` 区段中 SessionInfo…ListDeferredRunsResponse（保留 NarrativeResponse/MomentItem/MomentResponse）
- 同区段中 WorkflowRunStatus…ListWorkflowRunsResponse
- `// === 系统更新动态 ===` 整段
- `// === Anthropic Skills & Macros ===` 整段
- `// === MCP 服务器配置 ===` 整段
- `// === 知识库 KB ===` 整段
- `// === 运行时指标 Metrics ===` 整段
- `// === 活动中心 Activity ===` 整段

保留 `// === 会话与 API 类型 ===` 区段下的 NarrativeResponse / MomentItem / MomentResponse 三项，可改区段标题为 `// === 会话叙事与时刻 ===`。

- [ ] **Step 2: 在 index.ts 末尾追加 re-export**

```ts
// === Re-export 已按域拆分的类型（保持向后兼容） ===
export * from './session'
export * from './workflow'
export * from './mcp'
export * from './news'
export * from './skills'
export * from './metrics'
export * from './kb'
export * from './activity'
```

`export *` 会重新导出各文件中所有命名导出（全部为 type-only），与 index.ts 自身保留的类型无命名冲突（已逐一核对）。

- [ ] **Step 3: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无错误。这是关键验证点——任何 import 路径变化或遗漏的类型都会被 vue-tsc 抓住。

- [ ] **Step 4: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 所有测试通过。

- [ ] **Step 5: 提交 Part B**

```bash
cd d:\Maxma\MaxmaHere\web
git add src/types/session.ts src/types/workflow.ts src/types/mcp.ts src/types/news.ts src/types/skills.ts src/types/metrics.ts src/types/kb.ts src/types/activity.ts src/types/index.ts
git commit -m "refactor(types): split index.ts by domain into session/workflow/mcp/news/skills/metrics/kb/activity"
```

---

## Self-Review Checklist

1. **Spec coverage**：
   - Part A（FileDiffView 懒加载）→ Task 1 ✓
   - Part B（types/index.ts 拆分为 8 个域文件）→ Task 2 + Task 3 ✓
   - 向后兼容（`import { X } from '@/types'` 仍工作）→ Task 3 Step 2 的 `export *` ✓
   - 频繁提交（Part A/B 分别提交）→ Task 1 Step 5 + Task 3 Step 5 ✓

2. **Placeholder scan**：无 TBD/TODO；每个步骤都有具体代码或命令 ✓

3. **Type consistency**：迁移的类型签名原样保留，未改名；`export *` 无命名冲突（已逐一核对 8 个新文件与 index.ts 保留部分）✓

4. **关键风险**：
   - `types/provider.ts` 和 `types/audit-log.ts` 用 `export type { X } from './index'` 反向 re-export → **必须保留** ProviderConfig 等 5 个类型和 AuditLogRecord 等 3 个类型在 index.ts 中（已在 File Structure 标注）✓
   - `defineAsyncComponent` 在 `<script setup>` 中需在顶层声明 → Task 1 Step 2 已说明 ✓
