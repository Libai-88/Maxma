# App.vue 进一步拆分与 noUnusedLocals 评估 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 App.vue 的 MediaViewer 改为懒加载；评估并尝试抽出健康轮询逻辑到 composable；评估 noUnusedLocals 开启可行性。

**Architecture:** Part A 用 `defineAsyncComponent` 把 MediaViewer 同步 import 改异步。Part B 保守评估——健康轮询逻辑（startPolling + offline→online 兜底刷新）独立性强、风险低，抽到 `useHealthPolling.ts`；侧栏背景伪元素紧耦合 `.sidebar` 类，抽出会破坏 DOM/CSS 结构，**不抽**。Part C 试开 `noUnusedLocals`/`noUnusedParameters`，按错误分布决定是否保留。

**Tech Stack:** Vue 3 + TypeScript + Vite + Vitest + Pinia + vue-tsc

---

## 独占文件范围

- `web/src/App.vue`
- `web/src/components/ChatWindow.vue`（仅健康轮询协调；实测无健康逻辑，预期不改）
- `web/tsconfig.json`
- 新增：`web/src/composables/useHealthPolling.ts`
- 新增：`web/src/components/AppSidebarBackground.vue`（仅当侧栏背景可抽；评估后预期不创建）

**禁止修改：** DsSelect.vue/Icon.vue（Agent 40）、ChatView.vue/ChatInput.vue/useChatInput.ts（Agent 41）、FileEditBubble.vue/types/（Agent 42）及其他任何文件。

## 现状分析

### App.vue 当前结构（477 行）
- L1-74：template（sidebar + main + overlays）
- L76-174：script setup
  - L77-98：imports（MediaViewer 在 L93 同步导入）
  - L100-104：useSidebar / onboarding / useFloatSidebar
  - L106-138：事件处理函数（restartOnboarding / onSidebarClick / handleSwitchSession / openProviderSetup / handleConstify / handleUnconstify）
  - L140-149：sessionStore / chatStore
  - L151-152：`healthStore` + `health` ref
  - L154-163：`onMounted`（initIfNeeded / **startPolling** / onboarding.initialize / paperTexture）
  - L168-173：`watch(health, ...)`（offline→online 兜底 refreshSessions）
- L176-475：style（CSS @import + 全局 + sidebar 样式 + **`.sidebar::before`/`::after`** L448-475）

### ChatWindow.vue 健康轮询协调评估
实测 `ChatWindow.vue` 全文（1015 行）**未导入 `useHealthStore`/`health`，无任何健康轮询逻辑**。其 import 列表为 ContextMenu/MessageBubble/ThinkingBlock/ToolBubbleRouter/PlanCard/ApprovalBubble/SubAgentCard + vue-virtual-scroller + api + chatSessionAliveCache。与 App.vue 健康轮询无任何耦合点。**结论：ChatWindow.vue 无需改动。**

### 侧栏背景抽出风险评估
`.sidebar::before`（背景图 blur）和 `.sidebar::after`（白色叠层）是作用在 `<aside class="sidebar">` 上的伪元素：
- 抽到子组件用 `scoped` CSS 无法生效（子组件 scoped 不能样式化父元素）
- 用非 scoped CSS 移到子组件只是换文件，无隔离收益
- 包一层 wrapper 组件会改变 DOM 层级，可能影响 `.sidebar > *` z-index 规则与 flex 布局
- **结论：风险高，不抽。**

### 健康轮询抽出评估
逻辑仅 ~10 行，但边界清晰：
- 输入：healthStore + sessionStore
- 行为：onMounted 启动轮询；watch health 从 null→有值时兜底 refreshSessions
- 输出：`health` ref（template 中 PulsePanel/HealthPanel/OnboardingView 使用）
- 与 keep-alive / 路由 / SessionSidebar 无耦合
- **结论：风险低，抽出。** 与既有 useSidebar/useFloatSidebar/usePaperTexture 模式一致。

---

## Task 1: Part A — MediaViewer 懒加载

**Files:**
- Modify: `web/src/App.vue:89,93`

- [ ] **Step 1: 修改 App.vue 的 vue import，加入 defineAsyncComponent**

`web/src/App.vue` 第 89 行：
```ts
import { onMounted, watch } from 'vue';
```
改为：
```ts
import { defineAsyncComponent, onMounted, watch } from 'vue';
```

- [ ] **Step 2: 将 MediaViewer 同步 import 改为 defineAsyncComponent**

`web/src/App.vue` 第 93 行：
```ts
import MediaViewer from '@/components/MediaViewer.vue'
```
改为：
```ts
const MediaViewer = defineAsyncComponent(() => import('@/components/MediaViewer.vue'))
```

注意：原 import 块中 MediaViewer 与 LeavesOverlay/FloatSidebar 同组（L92-94）。改后 MediaViewer 从 import 声明变为 const 定义，需移到 import 块之后（与 `const { effectiveCollapsed, toggleSidebar } = useSidebar()` 等其他 const 一起，放在 L100 附近）。实际操作：删除 L93 的 import 行，在 imports 之后新增 const 行。

- [ ] **Step 3: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 全部通过（与改动前一致）

- [ ] **Step 5: 提交**

```bash
git add web/src/App.vue
git commit -m "perf(App): lazy-load MediaViewer via defineAsyncComponent"
```

---

## Task 2: Part B — 抽出健康轮询到 useHealthPolling.ts

**Files:**
- Create: `web/src/composables/useHealthPolling.ts`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 创建 useHealthPolling.ts composable**

`web/src/composables/useHealthPolling.ts`：
```ts
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useHealthStore } from '@/stores/health'
import { useSessionStore } from '@/stores/session'

/**
 * 健康轮询协调：启动后端健康轮询，并在后端从离线恢复到在线时兜底刷新会话列表。
 *
 * 修复背景：页面刷新时若后端仍在启动，initIfNeeded 的 refreshSessions 可能失败；
 * 此处在后端就绪后自动补刷会话列表。
 */
export function useHealthPolling() {
  const healthStore = useHealthStore()
  const sessionStore = useSessionStore()
  const { health } = storeToRefs(healthStore)

  onMounted(() => {
    healthStore.startPolling()
  })

  watch(health, (newHealth, oldHealth) => {
    if (!oldHealth && newHealth) {
      sessionStore.refreshSessions().catch((err) => console.warn('[App] refreshSessions failed:', err))
    }
  })

  return { health }
}
```

- [ ] **Step 2: App.vue 引入 useHealthPolling，删除原健康轮询代码**

在 App.vue script 中：
- 新增 import：`import { useHealthPolling } from '@/composables/useHealthPolling'`
- 删除 `import { useHealthStore } from '@/stores/health'`（不再直接用）
- 删除 `const healthStore = useHealthStore()` 和 `const { health } = storeToRefs(healthStore)`
- 删除 `onMounted` 中的 `healthStore.startPolling()` 行
- 删除整个 `watch(health, ...)` 块
- 新增 `const { health } = useHealthPolling()`（放在 useGlobalShortcut 之前，靠近其他 store 初始化）

注意：`onMounted` 仍保留（initIfNeeded / onboarding.initialize / paperTexture 仍在）；`storeToRefs` 仍被 sessionStore/chatStore 使用，不删 import。

- [ ] **Step 3: 运行类型检查**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 运行测试**

Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add web/src/composables/useHealthPolling.ts web/src/App.vue
git commit -m "refactor(App): extract health polling into useHealthPolling composable"
```

---

## Task 3: Part B — 侧栏背景评估（仅记录，不改动）

**Files:** 无（评估 only）

- [ ] **Step 1: 确认不抽出侧栏背景**

评估结论已在前文「侧栏背景抽出风险评估」记录：`.sidebar::before`/`::after` 紧耦合 `.sidebar` 类，抽出会破坏 DOM/CSS 结构或无隔离收益。**不创建 `AppSidebarBackground.vue`，不改 App.vue 的 style 块。**

本 Task 无代码改动，不提交。

---

## Task 4: Part C — noUnusedLocals 评估

**Files:**
- Modify: `web/tsconfig.json`（可能临时改动，按结果决定是否保留）

- [ ] **Step 1: 备份当前 tsconfig 状态**

记录当前值：`noUnusedLocals: false`，`noUnusedParameters: false`（L15-16）。

- [ ] **Step 2: 临时开启两个选项**

`web/tsconfig.json` L15-16：
```json
    "noUnusedLocals": false,
    "noUnusedParameters": false,
```
改为：
```json
    "noUnusedLocals": true,
    "noUnusedParameters": true,
```

- [ ] **Step 3: 运行类型检查，收集错误**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit 2>&1 | head -200`
Expected: 可能出现多个 TS6133（declared but never used）错误

- [ ] **Step 4: 评估错误分布**

判定规则：
- 若错误总数 < 20 且**全部**落在独占文件范围（App.vue / useHealthPolling.ts / ChatWindow.vue）→ 修复并保留开启
- 若错误总数 ≥ 20 或**跨其他 agent 文件**（DsSelect/Icon/ChatView/ChatInput/useChatInput/FileEditBubble/types 等）→ 不开启，恢复 tsconfig 原状，在计划与本 Task Step 5 记录错误清单

- [ ] **Step 5a（若不开启）: 恢复 tsconfig.json 原状**

将 L15-16 改回 `false` / `false`。

- [ ] **Step 5b（若开启）: 修复独占文件内的未使用变量**

仅修复 App.vue / useHealthPolling.ts / ChatWindow.vue 中的 TS6133 错误。

- [ ] **Step 6: 运行类型检查 + 测试验证**

Run: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
Run: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
Expected: 类型检查通过（或仅剩其他 agent 文件的已知错误，若不开启）；测试全部通过

- [ ] **Step 7: 提交**

若不开启：
```bash
git add web/tsconfig.json  # 仅当文件有变化才 add（恢复原状则无 diff，跳过 commit）
git commit -m "chore(tsconfig): evaluate noUnusedLocals — keep disabled (errors span other agents' files)"
```
若文件已恢复原状无 diff，则不提交（记录评估结论即可）。

若开启：
```bash
git add web/tsconfig.json web/src/App.vue web/src/composables/useHealthPolling.ts
git commit -m "chore(tsconfig): enable noUnusedLocals/noUnusedParameters"
```

---

## 风险与回退

- **Part A**：defineAsyncComponent 是 Vue 官方 API，`<MediaViewer />` 用法不变，仅延迟加载。回退：还原 import。
- **Part B**：composable 内 onMounted/watch 与 App.vue 其他生命周期自然组合；若测试失败，回退即将 useHealthPolling.ts 内容还原回 App.vue 并删除文件。
- **Part C**：仅改 tsconfig，无运行时影响；若开启导致其他 agent 文件报错，恢复 false。

## 自检

- [x] Spec 覆盖：Part A（MediaViewer 懒加载）→ Task 1；Part B 健康轮询 → Task 2，侧栏背景评估 → Task 3；Part C → Task 4。ChatWindow 协调经实测无需改动，已在现状分析记录。
- [x] 无占位符：每个代码步骤均给出完整代码。
- [x] 类型一致：useHealthPolling 返回 `{ health }`，与 App.vue 原 `const { health } = storeToRefs(healthStore)` 用法一致；template 中 `health` 引用不变。

---

## 执行结果（2026-07-17 实测）

### Part A — MediaViewer 懒加载 ✅
- Commit: `2142938 perf(App): lazy-load MediaViewer via defineAsyncComponent`
- 改动：`web/src/App.vue` 同步 `import MediaViewer` → `const MediaViewer = defineAsyncComponent(() => import('@/components/MediaViewer.vue'))`；vue import 加入 `defineAsyncComponent`、移除未使用的 `watch`（Part B 时移除）。
- 验证：vue-tsc EXIT=0；vitest 17 文件 / 49 测试全通过。

### Part B — 健康轮询抽出 ✅ / 侧栏背景不抽 ✅
- Commit: `c5531c2 refactor(App): extract health polling into useHealthPolling composable`
- 新增：`web/src/composables/useHealthPolling.ts`（28 行）——封装 `healthStore.startPolling()` + offline→online 兜底 `refreshSessions` watch，返回 `{ health }` ref。
- App.vue script 从 99 行降至 87 行（移除 useHealthStore import、healthStore/health 初始化、onMounted 中 startPolling、watch 块；新增 useHealthPolling import + 调用）。
- 侧栏背景 `.sidebar::before/::after`：**未抽**。伪元素紧耦合 `.sidebar` 类，scoped CSS 无法样式化父元素，wrapper 组件破坏 DOM 层级与 `.sidebar > *` z-index 规则。未创建 `AppSidebarBackground.vue`。
- ChatWindow.vue：**未改动**。实测全文 1015 行无任何健康轮询逻辑（不导入 useHealthStore/health），无协调点。
- 验证：vitest 49 测试全通过；vue-tsc 仅剩 Agent 41 并发重构 ChatInput.vue 引入的错误（与本改动无关，已在 git status 确认是 Agent 41 的 `89bb576` 提交所致）。

### Part C — noUnusedLocals 评估 ❌ 不开启
- 测试条件：`noUnusedLocals: true` + `noUnusedParameters: true`
- vue-tsc 错误总数：**1 个**
- 错误清单：
  ```
  src/views/ProvidersView.vue(404,16): error TS6133: 'discoverProvider' is declared but its value is never read.
  ```
- 决策：**不开启**。该错误在 `ProvidersView.vue`，不在本 agent 独占文件范围（App.vue / ChatWindow.vue / tsconfig.json / useHealthPolling.ts）。按约束"只修改独占文件范围内的文件"和"错误跨其他 agent 文件 → 不开启"，无法修复该错误。
- 处置：已用 `git checkout -- web/tsconfig.json` 恢复至原状（`noUnusedLocals: false` / `noUnusedParameters: false`），无 diff。
- 备注：错误数量其实很少（仅 1 个），若 ProvidersView.vue 的负责人后续修复 `discoverProvider` 未使用变量，即可安全开启这两个选项。本次不越权修改。

### 测试结果汇总
- vitest：17 文件 / 49 测试全通过（Part A、Part B 后均验证）
- vue-tsc：本 agent 独占文件（App.vue / useHealthPolling.ts / ChatWindow.vue）零错误；剩余错误均在其他 agent 并发重构的文件中（ChatInput.vue 等，非本范围）

### 偏差说明
1. **ChatWindow.vue 无需协调**：任务背景假设 ChatWindow.vue 与 App.vue 健康轮询有协调点，实测 ChatWindow.vue 不导入 health store，无健康逻辑，未做任何改动。
2. **并发 agent 干扰**：执行期间 Agent 40/41/42 并发提交（Icon.vue 注册、ChatInput useChatInput wiring、FileEditBubble 懒加载、types/ 拆分等），导致 vue-tsc 中途出现 ChatInput.vue 的 `Cannot find name 'props'` 等错误。这些错误随 Agent 41 提交 `89bb576` 后消失，与本 agent 改动无关。
3. **Part A 的 vue import 中 `watch` 移除时机**：Part A 仅加 `defineAsyncComponent`，保留了 `watch`；Part B 抽出 watch 块后才移除 `watch` import。最终状态一致。

