# 组件库设计与抽象 — 实施计划

- **日期**：2026-07-17
- **执行者**：Agent 34（独立前端组件设计工程师）
- **工作目录**：`d:\Maxma\MaxmaHere\web`
- **参考 skill**：`frontend-design`（已加载）

---

## 1. 背景与目标

审查发现当前独占文件范围内存在三处明显重复/耦合，需要在不改变功能与视觉的前提下抽象为可复用单元：

| 编号   | 问题                                                                            | 解决方案                          |
| ------ | ------------------------------------------------------------------------------- | --------------------------------- |
| P1-3   | `SessionSidebar.vue` 行 17-60（已保存）与 65-107（临时）结构几乎完全相同；`(sessionStatuses ?? {})[s.session_id]` 重复 6 次 | 抽 `SessionItem.vue` 组件         |
| P1-4   | `MarkdownEditor.vue` 与 `SoulView.vue` 共享 `loadContent` / `saveContent` / `onBlur` / `saveState` 三态 / Codemirror 配置 / placeholder 逻辑 | 抽 `useMarkdownPersist(type)` composable |
| P1 部分 | `ChatView.vue` 向 `ChatInput` 传 8 个 props（行 110-122），状态分散             | 抽 `useChatInput()` composable（仅骨架，不改 ChatView/ChatInput） |

---

## 2. frontend-design skill 的关键指导原则

加载该 skill 后提取的可应用于本次重构的指导：

1. **生产级、有意图的设计**：每个组件都要有清晰的概念方向，而不是机械拆分。
2. **避免通用 AI 美学**：不使用 Inter/Roboto 等通用字体、不使用紫色渐变白底等老套配色。本次为**重构**，因此保留现有的 `var(--text-primary)` / `var(--bg-card)` / `var(--accent)` 设计 token 体系，沿用现有 typography，**视觉零变化**。
3. **细节精炼**：CSS 变量一致性、空间组合、过渡动画都需保留原作意图。重构后所有 `:deep(.cm-*)` 样式、所有 session-item 状态过渡必须 1:1 保留。
4. **实现复杂度匹配愿景**：本组件库是「克制的重构」而非「最大化装饰」，所以代码应当精简、类型严格、无多余抽象。

---

## 3. 独占文件范围

可修改/新增的文件：

- `web/src/components/SessionSidebar.vue`（重构）
- `web/src/components/SessionItem.vue`（新增）
- `web/src/components/MarkdownEditor.vue`（重构）
- `web/src/views/SoulView.vue`（重构）
- `web/src/composables/useMarkdownPersist.ts`（新增）
- `web/src/composables/useChatInput.ts`（新增）

**严禁触碰**：`components/ui/*`、`WelcomeScreen/ModelSelector/PersonaCard/ChatView/App.vue`、`ChatWindow/router/types`、`styles/themes/*`、`ChatInput.vue`。

---

## 4. 详细任务分解

### 任务 A：SessionItem.vue + SessionSidebar.vue 重构（P1-3）

#### A.1 SessionItem.vue 设计

**Props 接口**（`defineProps`）：

```ts
interface SessionItemProps {
  session: SessionInfo
  isActive: boolean
  status?: { connected: boolean; isStreaming: boolean; isAwaitingUser: boolean }
  isConst: boolean            // 是否为已保存会话（决定图标和 class）
  displayIndex?: number       // 临时会话显示序号；const 会话不使用
}
```

**Emits**：

```ts
interface SessionItemEmits {
  switch: [id: string]
  contextmenu: [event: MouseEvent, session: SessionInfo]
  mouseenter: [event: MouseEvent, session: SessionInfo]
  mouseleave: []
  delete: [session: SessionInfo]
}
```

**模板要点**：
- 根元素 `class="session-item"` + `:class="{ active: isActive, 'is-const': isConst }"`
- 主区域 `session-item-main`：
  - const 模式：`<Icon name="pin" :size="12" class="pin-icon" />` + `const-name-text` 显示 `session.const_name || '未命名'`
  - temp 模式：`Session #{{ displayIndex }}`
  - 共享 `sub-badge`（`v-if="session.is_subagent"`）
  - 共享 `session-count` 显示 `formatRelativeTime(session.last_active ?? session.created_at) · {{ session.message_count }} 条消息`
- 右侧 `session-item-right`：
  - 三态 status-dot（`isAwaitingUser` / `isStreaming` / `connected`）—— 由 `status` prop 驱动，**消除 6 次重复的 `(sessionStatuses ?? {})[s.session_id]?.xxx`**
  - `btn-delete` 触发 `emit('delete', session)`

**注意**：`formatRelativeTime` 函数从 SessionSidebar 中抽到 SessionItem 内部（仅本组件使用）。SessionSidebar 中 `getAgentStatus` 仍保留在父组件（用于 hover card），不抽。

**样式**：将 SessionSidebar 中与 session-item 相关的 CSS（`.session-item`、`.session-item-main`、`.session-id`、`.pin-icon`、`.const-name-text`、`.sub-badge`、`.session-count`、`.btn-delete`、`.session-item-right`、`.status-dot`、`@keyframes pulse`、`.session-sidebar.collapsed .session-item*`、`.session-sidebar.collapsed .btn-delete`）整体迁移到 SessionItem 的 `<style scoped>` 中。

但 collapsed 状态下的样式需要从父组件穿透到子组件。方案：在 SessionItem 上使用 `:deep()` 不行（scoped 子组件样式不会被父选择器穿透）。**改用方案**：在 SessionItem 上暴露一个 `collapsed` prop，由子组件内部应用 collapsed 样式。或者更简单——**保留父组件的 collapsed CSS 规则，但通过 `:deep()` 选择 SessionItem 根元素的 class**。

实际最简洁方案：SessionItem 根元素 class 为 `session-item`，父组件 `SessionSidebar` 的 `.session-sidebar.collapsed .session-item` 规则使用 `:deep(.session-item)`，因为 SessionItem 是子组件，根元素会同时拥有父组件 scoped 属性（Vue 3 默认根元素继承父 scoped attribute）。**验证**：Vue 3 scoped 默认情况下子组件根元素会被父组件 scoped 样式命中（因为根元素同时携带两个 scoped hash）。所以 collapsed 相关的父组件 CSS 规则可以保留在 SessionSidebar，无需 :deep。

但子组件内部的 `.session-item-main`、`.btn-delete` 等元素不会携带父组件的 scoped hash，所以父组件的 `.session-sidebar.collapsed .session-item-main { max-height: 0; ... }` 不会命中子组件内部元素。

**最终方案**：
1. 在 SessionItem 上添加 `collapsed?: boolean` prop
2. SessionItem 根元素根据 collapsed 加上 `collapsed` class（如 `:class="{ collapsed }"`）
3. SessionItem 内部 scoped CSS 写 `.session-item.collapsed .session-item-main { ... }` 等规则
4. SessionSidebar 模板调用时传入 `:collapsed="collapsed"`
5. SessionSidebar 中 `.session-sidebar.collapsed .session-item.is-const { border-left: none }` 这条规则迁移到 SessionItem：`.session-item.collapsed.is-const { border-left: none }`

这样既保持视觉一致，又避免跨 scoped 穿透问题。

#### A.2 SessionSidebar.vue 重构

- 删除行 17-60 和 65-107 的重复模板，替换为两个 `<SessionItem v-for=... />` 调用
- 删除 `formatRelativeTime`（已移到 SessionItem）
- 保留 `getAgentStatus`（hover card 用）
- 保留所有其他逻辑（hover card、右键菜单、constify 卡片、删除确认）
- 删除迁移到 SessionItem 的 CSS 规则
- 保留 `.session-sidebar.collapsed .session-item`（根元素命中）这条规则本身可保留也可删除（因为 SessionItem 内部已经处理），为安全起见删除父组件中已迁移到子组件的规则，但保留 `.session-sidebar.collapsed .nav-item`、`.session-sidebar.collapsed .sidebar-section-header` 等仍在父组件的规则

#### A.3 验证

- 视觉对比：重构前后 session-item 在普通/active/hover/collapsed 状态下必须一致
- 功能对比：switch、delete、contextmenu、mouseenter/mouseleave 事件链必须畅通
- 类型检查通过

---

### 任务 B：useMarkdownPersist composable + MarkdownEditor/SoulView 重构（P1-4）

#### B.1 useMarkdownPersist API 设计

```ts
// web/src/composables/useMarkdownPersist.ts
export interface UseMarkdownPersistOptions {
  /** 人格类型，决定 API 路径 */
  type: 'soul' | 'user'
  /** 可选 variant（SoulView 切换人格时使用），返回 undefined 表示默认 SOUL.md */
  getVariant?: () => string | undefined
}

export interface UseMarkdownPersistReturn {
  // 状态
  content: Ref<string>
  savedContent: Ref<string>
  loading: Ref<boolean>
  saving: Ref<boolean>
  saveState: Ref<'saved' | 'saving' | ''>
  saveError: Ref<string>
  loadError: Ref<string>
  // Codemirror 配置（统一）
  extensions: Extension[]
  // 计算属性
  saveStateText: ComputedRef<string>
  isDirty: ComputedRef<boolean>  // content !== savedContent
  // 方法
  loadContent: () => Promise<void>
  saveContent: () => Promise<void>
  onBlur: () => void
  retryLoad: () => void
}

export function useMarkdownPersist(options: UseMarkdownPersistOptions): UseMarkdownPersistReturn
```

**封装内容**：
- `content` / `savedContent` / `loading` / `saving` / `saveState` / `saveError` / `loadError` 七个 ref
- `extensions = [markdown(), EditorView.lineWrapping]`（统一 Codemirror 配置）
- `saveStateText` computed
- `isDirty` computed（替代 `content === savedContent` 的散落判断）
- `loadContent()`：调用 `api.getPersona(type, variant)`，处理 loading 和 loadError
- `saveContent()`：调用 `api.updatePersona(type, content, variant)`，处理 saving 和 saveState 三态
- `onBlur()`：dirty 时触发 saveContent
- `retryLoad()`：调用 loadContent

**关键差异处理**：
- MarkdownEditor 不使用 variant（`getVariant` 不传或返回 undefined）
- SoulView 使用 `activeFile` 作为 variant 源（`getVariant: () => activeFile.value !== 'SOUL.md' ? activeFile.value : undefined`）
- SoulView 有额外的 `loadError` 显示和 retry 按钮 —— composable 暴露 `loadError` 和 `retryLoad` 供其使用
- MarkdownEditor 没有 loadError 显示，但仍可使用 composable 的 `loadError`（不渲染即可）

#### B.2 MarkdownEditor.vue 重构

- 替换 `<script setup>` 中的状态和方法为 `const { content, savedContent, loading, saving, saveState, saveError, saveStateText, extensions, loadContent, saveContent, onBlur } = useMarkdownPersist({ type: props.type })`
- 模板不变（除了 `content === savedContent` 可改为 `!isDirty` 但保留原样也可——为最小改动，保留 `content === savedContent`，因为模板里这么写也清晰）
- 实际上模板中 `:disabled="saving || content === savedContent"` 可以保留原样，composable 返回的 ref 在模板中可直接访问
- `<style scoped>` 完全不变

#### B.3 SoulView.vue 重构

- 替换 `content/savedContent/loading/saving/saveState/saveError/loadError/extensions/saveStateText/loadContent/saveContent/onBlur/retryLoad` 为 composable 返回值
- 保留 SoulView 独有的：`personas`、`personasLoaded`、`activeFile`、`loadPersonas`、`onPersonaChange`、`showCreateDialog`、`createForm`、`creating`、`doCreate`
- `getVariant: () => activeFile.value !== 'SOUL.md' ? activeFile.value : undefined`
- `onMounted` 中仍先 `loadPersonas()` 再 `loadContent()`
- `<style scoped>` 完全不变

#### B.4 验证

- MarkdownEditor：加载、保存、自动保存、saveState 三态、disabled 逻辑一致
- SoulView：人格切换、加载失败重试、创建新人格、保存逻辑一致
- 类型检查通过

---

### 任务 C：useChatInput composable 骨架（P1 部分）

#### C.1 设计

仅创建骨架文件，**不修改 ChatView.vue 和 ChatInput.vue**（不在独占范围）。composable 提供未来收敛 ChatInput 8 个 props 的状态接口：

```ts
// web/src/composables/useChatInput.ts
export interface UseChatInputOptions {
  isStreaming?: Ref<boolean>
  canSend?: Ref<boolean>
  initialProviderId?: Ref<string | null>
  initialModelName?: Ref<string | null>
  thinkPathEnabled?: Ref<boolean>
  quotedSelections?: Ref<...>
  quoteCandidate?: Ref<...>
}

export interface UseChatInputReturn {
  // 输入框状态
  text: Ref<string>
  isStreaming: Ref<boolean>
  disabled: Ref<boolean>
  canSend: Ref<boolean>
  providerId: Ref<string | null>
  modelName: Ref<string | null>
  thinkPathEnabled: Ref<boolean>
  quotedSelections: Ref<...>
  quoteCandidate: Ref<...>
  // 派生
  canSubmit: ComputedRef<boolean>
  // 方法
  send: (text: string) => void
  stop: () => void
  onModelChange: (payload: { providerId: string; modelName: string }) => void
  commitQuote: () => void
  removeQuote: () => void
}

export function useChatInput(options: UseChatInputOptions = {}): UseChatInputReturn
```

骨架实现：内部 ref 占位，emit 事件通过可选回调（暂不接线）。文件头注释说明：「本 composable 为 ChatView/ChatInput 状态收敛预留，当前为骨架；接入由 Agent 33/35 协调」。

---

## 5. 执行顺序与提交计划

| 顺序 | 任务                                       | 提交 message                                            |
| ---- | ------------------------------------------ | ------------------------------------------------------- |
| 1    | 写计划文件                                 | `docs(plan): add component library design plan`         |
| 2    | 创建 SessionItem.vue                       | `feat(ui): extract SessionItem from SessionSidebar`     |
| 3    | 重构 SessionSidebar.vue 使用 SessionItem   | `refactor(ui): SessionSidebar uses SessionItem`         |
| 4    | 创建 useMarkdownPersist.ts                 | `feat(composable): add useMarkdownPersist`              |
| 5    | 重构 MarkdownEditor.vue                    | `refactor(ui): MarkdownEditor uses useMarkdownPersist`  |
| 6    | 重构 SoulView.vue                          | `refactor(ui): SoulView uses useMarkdownPersist`        |
| 7    | 创建 useChatInput.ts 骨架                  | `feat(composable): add useChatInput skeleton`           |
| 8    | 验证 vitest + vue-tsc                      | （不提交，仅验证）                                      |

任务 2 和 3 可合并为一次提交（SessionItem 创建后立即用于 SessionSidebar 才有意义）。任务 4-6 同理可分开提交（每次重构后类型检查应通过）。

**实际策略**：按上表逐个提交，每个提交前确保不破坏构建。任务 2+3 合并为一次提交（"extract SessionItem and refactor SessionSidebar"）以保持原子性。

---

## 6. 风险与缓解

| 风险                                                       | 缓解                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| SessionItem scoped 样式在 collapsed 状态下与原行为不一致  | 通过 `collapsed` prop + 内部 `.session-item.collapsed` class 实现，逐条对比原 CSS                |
| useMarkdownPersist 的 variant 闭包过期（SoulView 切换人格）| 使用 `getVariant: () => ...` 函数式获取，每次 save/load 调用时读取最新值                          |
| SoulView 中 `onPersonaChange` 调用 `saveContent` 时序      | 保留原有顺序：先 saveContent（如 dirty）→ switchPersona → loadContent，composable 不改变此顺序   |
| 测试失败                                                   | 重构是机械性的，逻辑未变；若 vitest 失败需检查是否触碰了测试 mock                                |
| vue-tsc 类型错误                                           | SessionItem props 类型严格、composable 返回类型显式标注                                           |

---

## 7. 验证清单

- [ ] `cd d:\Maxma\MaxmaHere\web && npx vitest run`（47 个测试通过）
- [ ] `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`（无错误）
- [ ] SessionSidebar 视觉与重构前一致（普通/active/hover/collapsed × const/temp）
- [ ] MarkdownEditor 加载/保存/自动保存行为一致
- [ ] SoulView 人格切换/创建/重试/保存行为一致
- [ ] 每个子任务有独立 commit

---

## 8. 完成报告模板

完成后向父 agent 报告：
1. 计划文件路径
2. frontend-design skill 的关键指导原则
3. 每个 commit 的 hash 和 message
4. 修改/新增的文件清单和每个文件的具体改动
5. SessionItem.vue 的 props 接口
6. useMarkdownPersist 的 API 接口
7. 消除的重复代码行数估算
8. 测试结果（vitest + vue-tsc）
9. 任何偏差或意外问题
