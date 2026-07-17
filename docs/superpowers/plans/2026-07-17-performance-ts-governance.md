# 性能优化与 TypeScript 类型治理计划

**日期**: 2026-07-17
**执行者**: Agent 35（性能与 TS 治理）
**工作目录**: `d:\Maxma\MaxmaHere\web`

## frontend-skill 关键指导原则

- **克制优于堆砌**：默认 cardless 布局，用 sections/columns/dividers 替代卡片网格
- **App UI 遵循 Linear 式克制**：calm surface hierarchy, few colors, dense but readable
- **Utility Copy 优于营销文案**：product UI 应优先 orientation/status/action
- **Motion 用于 hierarchy 而非 noise**：2-3 intentional motions，removed if ornamental only
- **Litmus check**: 扫描 headings/labels/numbers 能否立即理解页面

## 现状基线

- ✅ 47 个 vitest 测试全部通过
- ✅ `vue-tsc --noEmit` 类型检查通过（0 错误）
- ✅ `router/index.ts` 中 **所有 21 条路由已经是懒加载**（`() => import('@/views/XxxView.vue')`），P1-1 任务无需修改
- ✅ `vue-virtual-scroller ^2.0.0-beta.8` 已安装，已在 vite.config.ts 的 `vue-vendor` manualChunk 中预声明
- ✅ vue-virtual-scroller 的 `DynamicScroller` 组件支持 `#default`、`#before`、`#after`、`#empty` 四个 slot
- ✅ `DynamicScroller` 暴露 `scrollToItem(index, options?)`、`scrollToPosition(position, options?)`、`scrollToBottom()`、`forceUpdate()` 等方法
- ✅ `DynamicScrollerItem` 支持 `sizeDependencies` prop，当依赖值变化时自动重新测量高度

## 任务清单

### Task 1: 路由级懒加载（P1-1）— 已完成

**发现**: `router/index.ts` 中所有 21 条路由已使用 `() => import('@/views/XxxView.vue')` 懒加载语法。
**结论**: 无需修改，记录现状。

### Task 2: ChatWindow 虚拟列表（P0-1）

**现状**: `ChatWindow.vue` 行 6 使用 `<template v-for="(turn, mergedIdx) in mergedTurns" :key="turn.id">` 直接渲染所有轮次，每个轮次包含用户消息 + 助手侧复杂内容（PlanCard/SubAgentCard/ThinkingBlock/ToolBubbleRouter/MemoryToolLog 等）。行 578-583 已使用 CSS `content-visibility: auto` 做初步优化。

**改造方案**: 使用 `DynamicScroller`（支持变高 item）包裹消息轮次。

#### 实现要点

1. **导入 DynamicScroller 组件**
   ```ts
   import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
   import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
   ```

2. **模板结构调整**：
   - `.chat-window` 移除 `overflow-y: auto`，改为 flex 容器
   - `DynamicScroller` 成为滚动容器（class `messages-list`）
   - 每个轮次的内容（cite-source + assistant-side）包裹在 `<div class="turn-wrapper">` 中
   - `DynamicScrollerItem` 用 `sizeDependencies` 跟踪 `turn.finalAnswer`、`turn.events.length`、`turn.userMessage`、`turn.memoryEvents?.length` 变化以触发重新测量
   - `#after` slot 放 error banner + typing indicator
   - `#empty` slot 放 empty state

3. **滚动逻辑适配**：
   - `scrollToBottom()`: 改用 `scrollerRef.value?.scrollToBottom()`
   - `scrollToTurn(index)`: 改用 `scrollerRef.value?.scrollToItem(index)`
   - `isNearBottom()`: 通过 `@scroll` 事件监听 scroller 根元素的 scrollTop/scrollHeight/clientHeight
   - `chatSessionAliveCache` 的 save/restore: 用 `scrollToPosition(savedScrollTop)` 替代直接 `el.scrollTop`

4. **`data-user-msg-idx` 属性保留**: 仍放在 `.cite-source` 上，不影响 `querySelector` 逻辑

5. **CSS 调整**：
   - `.chat-window`: `display: flex; flex-direction: column;` 去掉 `overflow-y: auto`
   - `.messages-list`（DynamicScroller 根）: `flex: 1; max-width: 768px; width: 100%; margin: 0 auto;`
   - 新增 `.turn-wrapper`: `display: flex; flex-direction: column; gap: 6px;` 维持用户消息与助手侧的间距
   - 移除旧的 `.messages-list > .cite-source` content-visibility 规则
   - `.messages-list:has(.empty-state)` 改为 `.empty-state` 直接 `height: 100%`

#### Before/After 对比

**Before**（template 行 3-181）:
```html
<div class="messages-list">
  <template v-for="(turn, mergedIdx) in mergedTurns" :key="turn.id">
    <div class="cite-source" :data-user-msg-idx="...">...</div>
    <div class="assistant-side">...</div>
  </template>
  <div v-if="error" class="error-banner">...</div>
  <div v-if="showTypingIndicator" class="typing-indicator">...</div>
  <div v-if="turns.length === 0 && !currentTurn" class="empty-state">...</div>
</div>
```

**After**:
```html
<DynamicScroller ref="scrollerRef" class="messages-list" :items="mergedTurns"
  :min-item-size="200" key-field="id" @scroll="onScrollerScroll">
  <template #default="{ item: turn, index: mergedIdx, active }">
    <DynamicScrollerItem :item="turn" :active="active" :index="mergedIdx"
      :size-dependencies="[turn.finalAnswer, turn.events.length, turn.userMessage, turn.memoryEvents?.length ?? 0]">
      <div class="turn-wrapper">
        <div class="cite-source" :data-user-msg-idx="...">...</div>
        <div class="assistant-side">...</div>
      </div>
    </DynamicScrollerItem>
  </template>
  <template #after>
    <div v-if="error" class="error-banner">...</div>
    <div v-if="showTypingIndicator" class="typing-indicator">...</div>
  </template>
  <template #empty>
    <div v-if="turns.length === 0 && !currentTurn" class="empty-state">...</div>
  </template>
</DynamicScroller>
```

**Before**（script 滚动逻辑）:
```ts
function scrollToBottom() {
  nextTick(() => { if (windowRef.value) windowRef.value.scrollTop = windowRef.value.scrollHeight })
}
function isNearBottom(): boolean {
  const el = windowRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
}
function scrollToTurn(index: number) {
  const el = windowRef.value?.querySelector(`[data-user-msg-idx="${index}"]`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
```

**After**:
```ts
const scrollerRef = ref<DynamicScrollerExposed | null>(null)
const isNearBottomRef = ref(true)
function onScrollerScroll(e: Event) {
  const el = e.target as HTMLElement
  isNearBottomRef.value = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
}
function scrollToBottom() {
  nextTick(() => scrollerRef.value?.scrollToBottom())
}
function isNearBottom(): boolean {
  return isNearBottomRef.value
}
function scrollToTurn(index: number) {
  scrollerRef.value?.scrollToItem(index, { align: 'start' })
}
```

### Task 3: 创建 `utils/error.ts` helper（P1-10）

**文件**: `web/src/utils/error.ts`（新增）

```ts
/** 将 unknown 类型的 catch 值收敛为可读字符串 */
export function toErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return String(e)
}
```

### Task 4: ProvidersView.vue any 清理（P1-10）

**现状**: 8 处 `catch (e: any)` + 2 处 `const body: any` / `const updateBody: any`
**改造**:
- 8 处 `catch (e: any)` → `catch (e: unknown)` + `toErrorMessage(e)`
- `const body: any` → `const body: Partial<ProviderConfig> & { models: string[] }` 或直接内联类型
- `const updateBody: any` → `const updateBody: Partial<ProviderConfig>`

### Task 5: McpView.vue any 清理（P1-10）

**现状**: 6 处 `catch (e: any)` + 1 处 `const body: any` + 1 处 `ref<any[]>` + 多处 `(full as any)`
**改造**:
- 6 处 `catch (e: any)` → `catch (e: unknown)` + `toErrorMessage(e)`
- `const body: any` → 使用 `MCPServerCreateBody & MCPServerUpdateBody` 交集类型或内联类型
- `ref<any[]>` → `ref<DiscoveredServer[]>` 或 `ref<unknown[]>`
- `(full as any).command` 等 → 使用 `MCPServerConfig` 类型（getMcpServer 已返回该类型）

### Task 6: 新增 types/ 类型文件（P2-10）

新增 4 个类型文件：

#### 6a. `web/src/types/event-hooks.ts`
```ts
export type HookType = 'file_change' | 'schedule' | 'webhook'
export type HookStatus = 'active' | 'paused' | 'error'

export interface FileChangeConfig {
  path?: string
  patterns?: string[]
  ignore_patterns?: string[]
}
export interface ScheduleConfig {
  interval?: number
}
export type HookConfig = FileChangeConfig & ScheduleConfig

export interface EventHook {
  hook_id: string
  name: string
  hook_type: HookType
  config: HookConfig
  action: string
  status: HookStatus
  enabled: boolean
  created_at: number
  last_triggered: number
  trigger_count: number
}

export interface EventHookHistoryRecord {
  trigger_id: string
  hook_id: string
  timestamp: number
  trigger_type: string
  trigger_detail: string
  status: string
  result: string
}

export interface ListHooksResponse { hooks: EventHook[] }
export interface CreateHookBody {
  name: string
  hook_type: HookType
  config: HookConfig
  action: string
}
export interface UpdateHookBody {
  name?: string
  hook_type?: HookType
  config?: HookConfig
  action?: string
  enabled?: boolean
}
export interface HookHistoryResponse { history: EventHookHistoryRecord[] }
export type HookMutationResponse = { status: string; hook: EventHook }
```

#### 6b. `web/src/types/persona.ts`
```ts
export type PersonaType = 'soul' | 'user'

export interface PersonaContentResponse {
  content: string
  type: string
}

export interface PersonaSummary {
  id: string
  file: string
  name: string
  description: string
  active: boolean
}

export interface ListPersonasResponse {
  personas: PersonaSummary[]
  active_file: string
}

export interface SwitchPersonaResponse {
  status: string
  active_file: string
}

export interface CreatePersonaBody {
  name: string
  description?: string
  tools?: string
  memory?: string
}

export interface CreatePersonaResponse {
  status: string
  file: string
  memory_mode: string
  tools: string
}
```

#### 6c. `web/src/types/provider.ts`
```ts
import type { ProviderConfig, ListProvidersResponse, TestConnectionResponse, ProviderHealthCheckResponse, DiscoverModelsResponse } from './index'

export type {
  ProviderConfig,
  ListProvidersResponse,
  TestConnectionResponse,
  ProviderHealthCheckResponse,
  DiscoverModelsResponse,
}

/** MCP 审计聚合统计项 */
export interface McpAuditSummaryItem {
  server_id?: string
  tool_name?: string
  count?: number
  [key: string]: unknown
}

export interface McpAuditSummaryResponse {
  summary: McpAuditSummaryItem[]
  event_type: string
}
```

#### 6d. `web/src/types/audit-log.ts`
```ts
import type { AuditLogRecord, AuditLogStats, AuditLogListResponse } from './index'

export type {
  AuditLogRecord,
  AuditLogStats,
  AuditLogListResponse,
}
```

### Task 7: api/index.ts 的 any 类型替换（P2-10）

**现状**:
- 行 539: `summary: any[]` → `McpAuditSummaryItem[]`
- 行 545: `hooks: any[]` → `EventHook[]`
- 行 548: `request<any>` → `request<EventHook>`
- 行 550: `config: Record<string, any>` → `config: HookConfig`
- 行 551: `hook: any` → `hook: EventHook`
- 行 556: `Record<string, any>` → `UpdateHookBody`
- 行 557: `hook: any` → `hook: EventHook`
- 行 566: `history: any[]` → `history: EventHookHistoryRecord[]`

### Task 8: tsconfig.json 升级（P2-9）

**改造**:
- `target: ES2020` → `target: ES2022`
- `lib: ["ES2020", "DOM", "DOM.Iterable"]` → `lib: ["ES2022", "DOM", "DOM.Iterable"]`
- **不开启 `noUnusedLocals` / `noUnusedParameters`**: 因为会导致其他 agent 文件的未使用变量错误（如 ChatView.vue 等已修改但未提交的文件可能存在未使用变量），超出本 agent 的修复范围。在计划中记录原因。

## 执行顺序

1. ✅ Task 1（路由懒加载）：已确认完成，无需修改
2. Task 3（创建 error.ts helper）
3. Task 2（ChatWindow 虚拟列表）
4. Task 4（ProvidersView any 清理）
5. Task 5（McpView any 清理）
6. Task 6（新增 types/ 类型文件）
7. Task 7（api/index.ts any 替换）
8. Task 8（tsconfig 升级）
9. 验证：vitest + vue-tsc

## 验证标准

- `cd web && npx vitest run` → 47 个测试通过
- `cd web && npx vue-tsc --noEmit` → 类型检查通过
- ChatWindow 视觉与功能保持不变（滚动、scroll-marks、context menu、streaming 等）
- 路由懒加载配置不变
- 其他 agent 的文件不被修改

## 偏差与风险记录

1. **P1-2 重型组件 defineAsyncComponent**: 按任务要求，引用方不在本 agent 独占范围内，仅在计划中记录哪些组件应该被引用方懒加载（MediaViewer/FileDiffView/MapBubble/StickerPicker），不直接修改。
2. **ChatWindow 虚拟列表的 iframe 状态**: DynamicScroller 会在 item 滚动到视野外时移除 DOM，可能导致 iframe 类工具（如 HtmlSandbox）状态丢失。这是虚拟化的固有 tradeoff，比现有 `content-visibility: auto` 更激进。
3. **noUnusedLocals**: 暂不开启，避免影响其他 agent 文件。
