# types/index.ts 进一步拆分（Provider/AuditLog）+ 侧栏背景抽出评估 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打破 `types/provider.ts` / `types/audit-log.ts` 与 `types/index.ts` 之间的循环 re-export，将 Provider 和 AuditLog 类型定义的"源头"从 index.ts 迁移到各自的域文件，index.ts 退化为聚合点；同时对 App.vue 侧栏背景抽出方案做探索性评估（不修改 App.vue）。

**Architecture:**
- Part A：Provider 类型定义从 `index.ts` 移到 `provider.ts`（实定义），AuditLog 类型定义从 `index.ts` 移到 `audit-log.ts`（实定义）。`index.ts` 用 `export * from './provider'` 和 `export * from './audit-log'` re-export。这样依赖方向变为 **域文件（源头）→ index.ts（聚合）**，无循环。
- Part B：仅评估 App.vue 侧栏背景（`.sidebar::before/::after`）抽出方案，记录结论，不修改 App.vue。

**Tech Stack:** Vue 3.4 + TypeScript 5.4 + Vite 5 + Vitest 2.1 + vue-tsc 2.0

---

## 范围与约束

### 独占文件范围（仅可修改这些文件）
- `web/src/types/index.ts`（删除 Provider/AuditLog 定义，改为 re-export）
- `web/src/types/provider.ts`（从 re-export 改为实定义）
- `web/src/types/audit-log.ts`（从 re-export 改为实定义，保留已有的 McpAuditSummary*）

### 不修改的文件
- `web/src/App.vue`（侧栏背景仅评估；且属 Agent 46 验证范围）
- `ModelSelector.vue` / `ChatInput.vue` / `ProvidersView.vue` / `tsconfig`（Agent 44 负责）
- 所有消费方文件（`api/index.ts`、`stores/provider.ts`、`stores/auditLog.ts`、`components/ChatInput.vue`、`views/ProvidersView.vue`）——通过 re-export 保持向后兼容，无需改动

### 关键约束
1. **向后兼容**：所有现有 import 必须仍然工作
   - `import { ProviderConfig } from '@/types'` → 通过 `index.ts` 的 `export * from './provider'` ✓
   - `import { McpAuditSummaryResponse } from '@/types/audit-log'` → audit-log.ts 仍导出 ✓
   - `import { AuditLogRecord } from '@/types'` → 通过 `index.ts` 的 `export * from './audit-log'` ✓
2. **打破循环依赖**：迁移后 provider.ts 和 audit-log.ts 不再 `from './index'`，index.ts 改为 `from './provider'` / `from './audit-log'`
3. **类型签名原样保留**：不改名、不改字段、不改注释

---

## 消费方调研结果（已通过 Grep 确认）

### Provider 类型消费方
- `web/src/api/index.ts:11,16-19` — `import { ListProvidersResponse, ProviderConfig, TestConnectionResponse, ProviderHealthCheckResponse, DiscoverModelsResponse } from '@/types'`
- `web/src/components/ChatInput.vue:228` — `import type { ProviderConfig, ... } from '@/types'`
- `web/src/stores/provider.ts:4` — `import type { ProviderConfig } from '@/types'`
- `web/src/views/ProvidersView.vue:158` — `import type { ComponentHealth, ProviderConfig, TestConnectionResponse } from '@/types'`
- `web/src/types/provider.ts` — 当前 `export type { ... } from './index'`（**无直接消费方**，Grep `@/types/provider` 零命中）

### AuditLog 类型消费方
- `web/src/api/index.ts:43-45` — `import { AuditLogRecord, AuditLogStats, AuditLogListResponse } from '@/types'`
- `web/src/api/index.ts:71` — `import type { McpAuditSummaryResponse } from '@/types/audit-log'`（**唯一直接消费方**）
- `web/src/stores/auditLog.ts:4` — `import type { AuditLogRecord, AuditLogStats } from '@/types'`

### 结论
- `@/types/provider` 无直接消费方 → 迁移 provider.ts 为实定义零风险
- `@/types/audit-log` 仅 1 直接消费方（McpAuditSummaryResponse，已在 audit-log.ts 本地定义）→ 迁移 audit-log.ts 为实定义零风险
- 所有 Provider/AuditLog 类型的 `@/types` 消费方通过 index.ts 的 `export *` 继续工作

---

## File Structure

### 修改文件
- `web/src/types/provider.ts` — 删除 `export type { ... } from './index'`，改为实定义（从 index.ts 行 541-595 原样迁移）
- `web/src/types/audit-log.ts` — 删除 `export type { ... } from './index'`，改为实定义（从 index.ts 行 651-673 原样迁移）；保留已有的 `McpAuditSummaryResponse` / `McpAuditSummaryEntry`
- `web/src/types/index.ts` — 删除 Provider 区段（行 541-595）和 AuditLog 区段（行 651-673）；在末尾 re-export 区追加 `export * from './provider'` 和 `export * from './audit-log'`

### 不新增文件

---

## Task 1: Part A — provider.ts 改为实定义

**Files:**
- Modify: `web/src/types/provider.ts`

- [ ] **Step 1: 读取 provider.ts 确认当前内容**

当前 provider.ts 仅 15 行，全部是 `export type { ... } from './index'` 反向 re-export。

- [ ] **Step 2: 用实定义替换 re-export**

将 provider.ts 改为（从 index.ts 行 541-595 原样迁移 5 个 interface，保留原注释）：

```ts
/**
 * Provider（模型供应商）类型定义
 *
 * 本文件是 Provider 类型的源头（real definitions），types/index.ts 通过
 * `export * from './provider'` 聚合再导出，保证 `import { X } from '@/types'` 向后兼容。
 */

// === 提供商管理 ===

export interface ProviderConfig {
  id: string
  provider_type: string
  label: string
  api_key: string
  base_url: string
  models: string[]
  enabled: boolean
  context_window?: number
  // 阶段 3.3：优先级（数字越小优先级越高，0 = 最高），用于 fallback 排序
  priority?: number
  // 阶段 3.3：运行时健康状态（由后台 health_monitor 维护，未持久化）
  health_status?: 'ok' | 'degraded' | 'error' | 'unknown'
  health_detail?: string | null
  health_latency_ms?: number | null
  health_reason_code?: string | null
  health_retry_at?: number | null
  health_updated_at?: number | null
  health_summary?: string | null
  last_check_time?: number
  consecutive_failures?: number
}

export interface ListProvidersResponse {
  providers: ProviderConfig[]
}

export interface TestConnectionResponse {
  status: 'ok' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  retry_at?: number | null
  updated_at?: number | null
  summary?: string | null
}

// 阶段 3.3：按需健康检查响应（POST /providers/{id}/health）
export interface ProviderHealthCheckResponse {
  status: 'ok' | 'degraded' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  retry_at?: number | null
  updated_at?: number | null
  summary?: string | null
  last_check_time: number
  consecutive_failures: number
}

export interface DiscoverModelsResponse {
  models: string[]
}
```

- [ ] **Step 3: 运行类型检查（此时 index.ts 仍有旧定义，会暂时重复，但 TS 允许同名 interface 合并；不过 export 重复会报错——因此本步骤仅作 sanity，预期 vue-tsc 可能报 "Duplicate identifier" 或正常通过）

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 此时 provider.ts 已是实定义，index.ts 仍是实定义，但 provider.ts 没有 `export ... from './index'`，所以 index.ts 不再从 provider.ts 导入，无循环。但 index.ts 仍导出同名类型——外部从 `@/types` import 仍解析到 index.ts 本地定义。vue-tsc 应通过（类型在 index.ts 和 provider.ts 各自定义，互不引用）。**此步仅过渡态，Task 3 会消除重复。**

---

## Task 2: Part A — audit-log.ts 改为实定义

**Files:**
- Modify: `web/src/types/audit-log.ts`

- [ ] **Step 1: 读取 audit-log.ts 确认当前内容**

当前 audit-log.ts 33 行：前 13 行是 `export type { ... } from './index'`，后 20 行是本地定义的 `McpAuditSummaryResponse` / `McpAuditSummaryEntry`。

- [ ] **Step 2: 用实定义替换 re-export，保留 McpAuditSummary***

将 audit-log.ts 改为：

```ts
/**
 * Audit Log（审计日志）类型定义
 *
 * 本文件是 AuditLog 类型的源头（real definitions），types/index.ts 通过
 * `export * from './audit-log'` 聚合再导出，保证 `import { X } from '@/types'` 向后兼容。
 */

// === 审计日志 AuditLog ===

export interface AuditLogRecord {
  timestamp: string
  epoch: number
  type: string
  target: string
  detail: string
  data_size: number
  status: string
  extra?: Record<string, any>
}

export interface AuditLogStats {
  total: number
  by_type: Record<string, number>
  by_status: Record<string, number>
  top_targets: Array<{ target: string; count: number }>
}

export interface AuditLogListResponse {
  records: AuditLogRecord[]
}

/**
 * MCP 调用审计聚合统计响应（GET /audit-log/mcp-summary）。
 *
 * 后端目前由 OMP 替代审计子系统，该端点会返回 404；
 * 这里仅为前端类型完整性与未来恢复时使用。
 */
export interface McpAuditSummaryResponse {
  /** 聚合统计条目，每项对应一个 MCP 服务器或工具的调用统计 */
  summary: McpAuditSummaryEntry[]
  event_type: string
}

/** MCP 调用审计单条聚合统计（字段为渐进式契约，后端可能扩展） */
export interface McpAuditSummaryEntry {
  server_id?: string
  tool_name?: string
  call_count?: number
  error_count?: number
  last_called_at?: number
  [key: string]: unknown
}
```

- [ ] **Step 3: 运行类型检查（过渡态，同 Task 1 Step 3）**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 通过（index.ts 和 audit-log.ts 各自定义同名类型，互不引用）。

---

## Task 3: Part A — index.ts 删除旧定义并加 re-export

**Files:**
- Modify: `web/src/types/index.ts`

- [ ] **Step 1: 删除 index.ts 中 Provider 区段（行 541-595）**

删除从 `// === 提供商管理 ===` 注释到 `DiscoverModelsResponse` interface 结束的整段（含区段注释和 5 个 interface）。

- [ ] **Step 2: 删除 index.ts 中 AuditLog 区段（行 651-673）**

删除从 `// === 审计日志 AuditLog ===` 注释到 `AuditLogListResponse` interface 结束的整段（含区段注释和 3 个 interface）。

- [ ] **Step 3: 在 index.ts 末尾 re-export 区追加 provider 和 audit-log**

在现有 re-export 块（行 675-685）中，按字母序或逻辑顺序追加：

```ts
// === Re-export 已按域拆分的类型（保持向后兼容） ===
// 以下类型的定义已迁移到独立的域文件，此处通过 re-export 保证
// 现有 `import { X } from '@/types'` 用法不破坏。
export * from './provider'
export * from './session'
export * from './workflow'
export * from './mcp'
export * from './news'
export * from './skills'
export * from './metrics'
export * from './kb'
export * from './activity'
export * from './audit-log'
```

说明：`provider` 和 `audit-log` 加入 re-export 列表。顺序无功能影响，按字母序放首位/末位均可，本计划放 provider 在最前、audit-log 在最后（与现有风格一致）。

- [ ] **Step 4: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无错误。这是关键验证点：
- `import { ProviderConfig } from '@/types'` → index.ts `export * from './provider'` → provider.ts 实定义 ✓
- `import { ProviderConfig } from '@/types/provider'` → provider.ts 实定义 ✓
- `import { AuditLogRecord } from '@/types'` → index.ts `export * from './audit-log'` → audit-log.ts 实定义 ✓
- `import { McpAuditSummaryResponse } from '@/types/audit-log'` → audit-log.ts 实定义 ✓
- 循环依赖已消除：provider.ts / audit-log.ts 不再 `from './index'`

- [ ] **Step 5: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 所有测试通过（无新增失败）。

- [ ] **Step 6: 提交 Part A**

```bash
cd d:\Maxma\MaxmaHere\web
git add src/types/provider.ts src/types/audit-log.ts src/types/index.ts
git commit -m "refactor(types): break circular re-export by making provider.ts and audit-log.ts the source of truth

Provider and AuditLog types were previously defined in index.ts and reverse
re-exported by provider.ts/audit-log.ts (circular). Move real definitions into
the domain files; index.ts now aggregates via `export *`."
```

---

## Task 4: Part B — 侧栏背景抽出评估（仅记录，不修改代码）

**Files:**
- Read-only: `web/src/App.vue`

- [ ] **Step 1: 读取 App.vue 侧栏相关 template 和 CSS**

已读取 App.vue 全文。侧栏背景相关代码：

Template（行 10-52）：
```html
<aside class="sidebar" :class="{ collapsed: effectiveCollapsed }" @click="onSidebarClick">
  ...children...
</aside>
```

CSS（行 250-463）关键部分：
```css
.sidebar {
  width: 220px;
  min-width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 24px 20px;
  gap: 24px;
  position: relative;
  overflow: hidden;
}

/* ── Collapsible sidebar ── */
.sidebar { position: relative; transition: width 0.25s ease; }
.sidebar.collapsed { width: 58px; min-width: 58px; padding: 24px 10px; align-items: center; overflow: hidden; }

/* ── Sidebar background image with blur + white overlay ── */
.sidebar::before {
  content: '';
  position: absolute;
  inset: -5%;
  background-image: url('/images/sidebar-bg.jpg');
  background-size: cover;
  background-position: left center;
  background-repeat: no-repeat;
  filter: blur(10px);
  transform: scale(1.05);
  z-index: 0;
  pointer-events: none;
}

.sidebar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
  z-index: 0;
  pointer-events: none;
}

.sidebar > * {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 2: 评估方案 A — CSS 移到独立文件 `assets/styles/sidebar.css`**

**做法**：将 `.sidebar` 相关 CSS（含 `::before`/`::after`/`.collapsed`/`.sidebar > *`）从 App.vue `<style>` 移到 `web/src/assets/styles/sidebar.css`，App.vue 顶部 `@import '@/assets/styles/sidebar.css'`。

**优点**：
- 减小 App.vue 体积（当前 App.vue 463 行，侧栏 CSS 约 100+ 行）
- CSS 可被其他需要侧栏样式的场景复用（目前无此需求）
- 低风险：纯 CSS 移动，不改 DOM 结构、不改选择器、不改 JS 逻辑

**缺点**：
- App.vue 的 `<style>` 是全局（非 scoped），移到独立 CSS 文件后仍是全局，行为一致——但失去"样式与组件同文件"的局部性
- 需确认 `@import` 顺序（sidebar.css 中的 `.sidebar` 需在主题变量之后加载，避免被覆盖；当前 App.vue 的 `@import` 顺序是 tokens → animations → design-system → markdown → paper-texture → themes...，sidebar CSS 应放在 themes 之后）
- 抽出后 App.vue 仍需保留非侧栏 CSS（`.app-layout`、`.main`、`.sidebar-hover-trigger`、滚动条、`:root`、`::selection` 等），分割后 App.vue 的 `<style>` 仍会存在，只是变短

**风险**：低。纯 CSS 迁移，`@import` 顺序可控，vue-tsc + 浏览器视觉验证即可。

- [ ] **Step 3: 评估方案 B — 创建 `AppSidebarBackground.vue` 组件，绝对定位覆盖**

**做法**：新建 `AppSidebarBackground.vue`，内部渲染一个 `<div class="sidebar-bg">`，用绝对定位覆盖在 `.sidebar` 区域（需与 `.sidebar` 同尺寸、同折叠状态）。App.vue 在 `<aside>` 内或同级插入该组件。

**优点**：
- 背景逻辑完全独立，可单独维护、测试
- 未来可做动态背景切换（如主题化背景图）

**缺点**：
- **紧耦合问题**：背景层必须与 `.sidebar` 的尺寸/折叠状态完全同步。`.sidebar.collapsed` 时宽度从 220px→58px，背景层需同步过渡。当前用 `::before`/`::after` 天然继承 `.sidebar` 的尺寸和折叠状态；改为独立组件后，需通过 props/事件同步 `effectiveCollapsed`，并复制宽度/padding/transition 逻辑——**重复的样式契约**
- 需在 App.vue 引入新组件、传入 `collapsed` prop、处理 z-index 层叠（背景层 z-index:0，`.sidebar > *` z-index:1）——DOM 结构变复杂
- `.sidebar { overflow: hidden }` 用于裁剪 `::before` 的 `inset: -5%` + `blur(10px)` 溢出部分；独立组件若放在 `.sidebar` 内部可继承 overflow，但若放在同级则需自己处理
- **最大风险**：折叠过渡动画期间，背景层与 `.sidebar` 宽度过渡需完全同步（duration/easing/delay），否则出现错位

**风险**：中-高。引入同步状态和重复样式契约，得不偿失。

- [ ] **Step 4: 评估方案 C — 保持现状（伪元素留在 App.vue）**

**做法**：不做任何修改。

**优点**：
- 零风险
- `::before`/`::after` 天然继承 `.sidebar` 的尺寸、折叠状态、overflow 裁剪，无需同步
- 当前实现简洁、性能好（伪元素无额外 DOM 节点）

**缺点**：
- App.vue 体积略大（但侧栏 CSS 仅约 100 行，不算瓶颈）
- 背景逻辑与 App.vue 耦合——但侧栏本身就在 App.vue，这种耦合是合理的

- [ ] **Step 5: 记录评估结论**

**推荐方案：C（保持现状）**，次选 A（CSS 抽出，若未来 App.vue 需瘦身）。

**理由**：
1. 伪元素 `.sidebar::before`/`::after` 与 `.sidebar` 的 `position: relative` + `overflow: hidden` + `.sidebar > * { z-index: 1 }` 形成完整的层叠上下文契约。`::before` 用 `inset: -5%` + `blur(10px)` + `transform: scale(1.05)` 实现模糊背景不露边，依赖 `.sidebar` 的 overflow 裁剪——这是伪元素的惯用法，抽出反而破坏封装。
2. 折叠动画期间尺寸同步是方案 B 的致命伤：`.sidebar.collapsed` 的 width/padding/align-items 过渡需与背景层完全一致，引入重复契约。
3. 方案 A（CSS 抽出）技术上可行且低风险，但**收益有限**：App.vue 当前 463 行，侧栏 CSS 约 100 行，抽出后 App.vue 仍有 360+ 行（其他全局样式 + template + script），瘦身效果不显著；且 App.vue 的 `<style>` 本就是全局样式的聚合点（已 `@import` 12 个主题文件），再抽出一个 sidebar.css 只是增加了文件数，不改变架构。
4. 前一轮 Agent 43 评估"风险高"的结论在本轮评估中得到印证：伪元素紧耦合 `.sidebar` 类，抽出收益不抵成本。

**是否值得做：否。** 保持现状是最优选择。若未来有强需求（如动态背景切换、多套侧栏皮肤），再考虑方案 A（CSS 抽出）作为过渡，方案 B（独立组件）不推荐。

- [ ] **Step 6: 不修改 App.vue，不提交**

本任务仅产出评估结论，记录在本计划文档中。无代码变更，无提交。

---

## Self-Review Checklist

1. **Spec coverage**：
   - Part A（Provider/AuditLog 迁移打破循环依赖）→ Task 1 + Task 2 + Task 3 ✓
   - Part B（侧栏背景抽出评估）→ Task 4 ✓
   - 向后兼容（所有现有 import 仍工作）→ Task 3 Step 3 的 `export *` ✓
   - 频繁提交（Part A 完成后提交）→ Task 3 Step 6 ✓
   - 不修改 App.vue → Task 4 明确不修改 ✓

2. **Placeholder scan**：无 TBD/TODO；每个步骤都有具体代码或命令 ✓

3. **Type consistency**：迁移的类型签名原样保留（含注释），未改名；`export *` 无命名冲突（provider.ts 的 5 个类型、audit-log.ts 的 5 个类型与 index.ts 保留部分无重名）✓

4. **关键风险**：
   - 循环依赖打破方向：域文件（源头）→ index.ts（聚合），非反向 ✓
   - `@/types/provider` 无直接消费方 → 迁移零风险 ✓
   - `@/types/audit-log` 仅 1 直接消费方（McpAuditSummaryResponse，已在本地）→ 迁移零风险 ✓
   - vue-tsc + vitest 双重验证 → Task 3 Step 4 + Step 5 ✓

5. **侧栏评估**：
   - 三方案均评估 ✓
   - 推荐方案 C（保持现状），有明确理由 ✓
   - 不修改 App.vue ✓
