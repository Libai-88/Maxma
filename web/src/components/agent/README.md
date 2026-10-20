# MaxmaHere Agent 前端组件

## 概述

后台子 Agent（deferred runs）的可视化管理界面：**读真实后端数据**，
不造演示假数据。设计跟随 MaxmaHere 品牌规范（6 主题，旗舰素影：宣纸白 + 朱砂红）。

### 核心原则

1. **数据为真**——只消费后端 `deferred-runs` 接口返回的 `DeferredRun` 投影
2. **不做假功能**——没有对应后端端点的按钮一律不做
3. **简约克制**——界面不喧宾夺主，让任务执行成为焦点
4. **尊重既有约定**——token、动画、隐私边界都沿用仓库现有方案

### 视觉特点

- **配色**：全部走主题 token（旗舰素影：宣纸白 `#F4F0E8` + 朱砂红 `#C23B22`），
  **不写死色值**
- **圆角**：`var(--radius-lg)`（各主题取值不同，2–12px）
- **阴影**：`var(--shadow-md)` 等 token
- **动画**：GSAP + 仓库的 `useGsap` 组合式，支持 `prefers-reduced-motion`
- **字体**：`var(--font-display)` / `var(--font-mono)` / 系统字体栈

### 入口

- 页面：`/agent-tasks`（Dock 左侧栏「Agent」）
- 视图：`web/src/views/AgentTasksView.vue`
- 数据：`web/src/composables/useAgentTasks.ts`

## 核心组件

### 1. AgentCard.vue

**用途**: 展示单个 agent 任务的详细信息

**特性**:
- 状态指示器（带脉冲动画）
- 可折叠的详情面板
- 实时进度显示
- 执行时间线
- 取消操作支持

**Props**:
```typescript
interface AgentCardProps {
  agentId: string
  title?: string
  description?: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempts?: number
  duration?: number // 毫秒
  progress?: number // 0-100
  result?: string
  error?: string
  cancelReason?: string
  timeline?: Array<{ timestamp: number; message: string }>
  cancellable?: boolean
  interactive?: boolean
}
```

**Events**:
- `cancel` - 用户取消任务
- `expand` - 展开详情
- `collapse` - 收起详情

**使用示例**:
```vue
<AgentCard
  agent-id="agent-001"
  title="数据分析任务"
  description="分析用户行为数据"
  status="running"
  :progress="65"
  @cancel="handleCancel"
/>
```

### 2. AgentOrchestrator.vue

**用途**: Agent 编排中心，管理多个 agent 任务

**特性**:
- 双视图模式（流程图 / 列表）
- 统计概览面板
- 批量操作（取消全部运行中任务）
- 实时状态更新
- 浮动操作栏

**Props**:
```typescript
interface Agent {
  id: string
  title?: string
  description?: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempts?: number
  duration?: number
  progress?: number
  result?: string
  error?: string
  cancelReason?: string
  timeline?: Array<{ timestamp: number; message: string }>
  cancellable?: boolean
  dependencies?: string[]
}

interface AgentDependency {
  from: string
  to: string
  type?: 'sequential' | 'parallel' | 'conditional'
}

// Props
{
  agents: Agent[]
  dependencies?: AgentDependency[]
}
```

**Events**:
- `cancelAgent` - 取消单个任务
- `cancelAll` - 取消所有运行中任务
- `selectAgent` - 选中某个任务
- `expandAgent` / `collapseAgent` - 展开 / 收起任务详情

> 原先还有 `pauseAll` / `resumeAll` 两个事件与「暂停全部」按钮。
> 后端**没有**暂停端点，属于假功能，已一并移除。
- `selectAgent` - 选中某个任务
- `expandAgent` - 展开任务详情
- `collapseAgent` - 收起任务详情

**使用示例**:
```vue
<AgentOrchestrator
  :agents="agents"
  :dependencies="dependencies"
  :auto-refresh="true"
  :refresh-interval="3000"
  @cancel-agent="handleCancelAgent"
  @cancel-all="handleCancelAll"
/>
```

### 3. AgentFlowCanvas.vue

**用途**: 可视化展示 agent 任务流程图

**特性**:
- 自动布局算法（基于依赖关系）
- 三种连接类型（顺序、并行、条件）
- 节点拖拽（可选）
- 缩放控制
- 网格背景
- SVG 连接线动画

**Props**:
```typescript
{
  agents: Agent[]
  dependencies: AgentDependency[]
}
```

**Events**:
- `select` - 选中节点
- `cancel` - 取消节点任务

**使用示例**:
```vue
<AgentFlowCanvas
  :agents="agents"
  :dependencies="dependencies"
  @select="handleSelectAgent"
  @cancel="handleCancelAgent"
/>
```

### 4. AgentStatusTimeline.vue

**用途**: 显示 agent 执行的时间线历史

**特性**:
- 事件过滤（全部 / 进行中 / 已完成）
- 实时更新指示器
- 相对时间显示
- 元数据标签
- 事件操作按钮

**Props**:
```typescript
interface TimelineEvent {
  id: string
  type: 'start' | 'progress' | 'complete' | 'error' | 'info'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  title: string
  description?: string
  timestamp: number
  duration?: number
  metadata?: Record<string, string | number>
  actions?: Array<{ label: string; type: string }>
}

// Props
{
  events: TimelineEvent[]
  isLive?: boolean
}
```

**Events**:
- `action` - 用户点击事件操作按钮

**使用示例**:
```vue
<AgentStatusTimeline
  :events="timelineEvents"
  :is-live="true"
  @action="handleTimelineAction"
/>
```

### 5. SubAgentCard.vue（既有组件，非本次新增）

**用途**: 对话气泡里的后台子任务卡片

> **澄清**：`SubAgentCard` 是仓库**原有**的已跟踪文件
> （`web/src/components/SubAgentCard.vue`），不是本次新增的组件。
> 本次对它做了视觉重做，并恢复了它原有的对外契约
> （标题文案 `后台子任务`、取消按钮类名 `.cancel-run`）——
> 上一版重写时改掉了这两处，导致 `tests/subAgentCard.spec.ts` 2 条测试变红，
> 且 GSAP hover 钩子依赖的 `.cancel-run` 一并失效。

**它与本套编排组件的区别**：

| | `SubAgentCard` | `components/agent/*` |
|---|---|---|
| 数据来源 | `getDeferredRun` 单点查询（按 `runIds` 逐个拉） | `listDeferredRuns` 列表 |
| 出现位置 | 对话气泡内（跟着某条 turn） | 独立页面 `/agent-tasks` |
| 知道哪些任务 | 只有父 turn 的 `deferredRunIds` | 当前会话的全部任务 |

**使用示例**:
```vue
<SubAgentCard
  :session-id="sessionId"
  :run-ids="runIds"
/>
```

## 与后端集成

### API 端点

1. **获取 deferred runs 列表**
   ```
   GET /api/sessions/:sessionId/deferred-runs
   ```

2. **获取单个 deferred run**
   ```
   GET /api/sessions/:sessionId/deferred-runs/:runId
   ```

3. **取消 deferred run**
   ```
   POST /api/sessions/:sessionId/deferred-runs/:runId/cancel
   ```

### 数据流

```
api.listDeferredRuns() -> useAgentTasks(映射 + 轮询) -> AgentTasksView -> 组件 props
                                          ^
                          api.cancelDeferredRun()  <-- 取消操作
```

### 实时更新机制

1. 页面挂载时 `useAgentTasks` 立即拉一次列表（`watch` + `immediate`）
2. 有 `queued` / `running` 任务时每 4 秒轮询一次；全终态后自动停止
3. 取消后就地更新该条任务状态
4. 会话切换时重新拉取，并丢弃切换前的在途响应（防竞态）

> **注意**：这里**没有** WebSocket 推送。后端 `deferred_subagent_submitted`
> 事件只带一个不透明的 `run_id`，状态始终由上面的 REST 接口拉取。
> `SubAgentCard`（对话气泡里的卡片）走的是 `getDeferredRun` 单点查询，
> 与本套编排组件不是同一条数据路径。

## 使用指南

### 快速开始

1. **安装依赖**（如果需要）
   ```bash
   cd web
   npm install
   ```

2. **引入组件**
   ```vue
   <script setup>
   import AgentOrchestrator from '@/components/agent/AgentOrchestrator.vue'
   import AgentCard from '@/components/agent/AgentCard.vue'
   import AgentStatusTimeline from '@/components/agent/AgentStatusTimeline.vue'
   </script>
   ```

3. **准备数据**
   ```typescript
   const agents = ref<Agent[]>([
     {
       id: 'agent-1',
       title: '数据处理任务',
       status: 'running',
       progress: 45,
     }
   ])
   ```

4. **使用组件**
   ```vue
   <AgentOrchestrator
     :agents="agents"
     :dependencies="dependencies"
     :selected-id="selectedId"
     @cancel-agent="handleCancel"
     @cancel-all="handleCancelAll"
     @select-agent="handleSelect"
   />
   ```

   > 事件名是 `cancel-agent` / `cancel-all` / `select-agent`（kebab-case，
   > 对应 script 里的 `cancelAgent` / `cancelAll` / `selectAgent`）。

### 查看实际效果

任务中心页面读的是**真实后端数据**，不是演示假数据：

```
/agent-tasks
```

或在开发环境中运行：
```bash
npm run dev
```

然后打开浏览器访问对应路由。需要在对话中派发过子 Agent 才会有内容，
否则显示「暂无后台子任务」空状态。

数据获取逻辑见 `web/src/composables/useAgentTasks.ts`。

## 主题定制

### CSS 变量

所有组件使用以下 CSS 变量，可以在主题文件中覆盖：

### 使用的主题 token

下面是**旗舰主题素影（`suying`）**的真实取值，逐字抄自
`web/src/themes/suying.css`，不是通用默认值——**换主题这些值都会变**，
所以组件里永远用 `var(--token)`，不要抄色值。

```css
/* 表面 */
--bg-primary:    #F4F0E8;   /* 宣纸 — 最深，主画布 */
--bg-secondary:  #EEE9E0;   /* 旧纸 — 侧边栏，微沉 */
--bg-card:       #F8F5EF;   /* 素笺 — 卡片/气泡，浮于画布 */

/* 文字 */
--text-primary:   #1C1C1C;  /* 浓墨 — 正文 */
--text-secondary: #3D3D3D;  /* 重墨 — 辅助 */
--text-tertiary:  #646464;  /* 淡墨 — 占位/禁用 */

/* 状态色（作描边/图标/装饰图形用） */
--status-ok:    #6B8E6B;    /* 松烟绿 */
--status-error: #C5554A;    /* 胭脂红 */
--status-warn:  #C99A5A;    /* 藤黄 */
--status-info:  #5A8A9A;    /* 石青 */

/* 状态色·文字版（当文字色用，见「可访问性」一节） */
--status-ok-text / --status-error-text / --status-warn-text / --status-info-text

/* 强调色 */
--accent: #C23B22;          /* 朱砂 — 描边/图标/渐变端点 */
--accent-text               /* 强调色·文字版 */
--accent-solid              /* 实底（配 --accent-solid-text） */

/* 边框 / 圆角 / 动效 */
--border:     rgba(200, 196, 188, 0.40);
--radius-lg:  10px;
--ease-out:   cubic-bezier(0.23, 1, 0.32, 1);
```

> **结构 token**（间距 / 字号 / 字体 / 圆角档位 / 阴影层级 / 缓动曲线）
> 定义在 `web/src/assets/styles/tokens.css`，6 个主题共享；**配色 token**
> 定义在各主题文件里。

### 自定义样式

如果需要覆盖组件样式，可以使用 `:deep()` 选择器：

```vue
<style scoped>
:deep(.agent-card) {
  border-width: 2px;
}

:deep(.agent-card-header) {
  /* 覆盖样式时同样要用 token，不要写死色值——否则换主题就露馅，
     而且会被 web/scripts/check-hardcoded-colors.mjs 拦下。 */
  background: linear-gradient(135deg, var(--bg-card), var(--bg-secondary));
}
</style>
```

## 性能优化

### 已实施的优化

1. **懒加载**: 详情面板按需渲染（`v-if="expanded"`）
2. **条件渲染**: 使用 `v-if` 控制非必要 DOM
3. **轮询有开关**: 仅当存在 `queued` / `running` 任务时才轮询（4s），
   全终态后自动停止（`useAgentTasks.ts`）
4. **动画属性**: GSAP 只动 `opacity` / `x` / `y` / `scale` / `strokeDashoffset`
5. **入场动画有边界**: 流程图只给**新增**节点做动画，不会整张图重新淡入
6. **GSAP 上下文**: 所有动画经 `useGsap` + `contextSafe`，卸载时统一撤销

### 已知的性能取舍（诚实清单）

- **进度条用 CSS `transition: width`**（`.progress-bar` / `.progress-fill`），
  这会触发布局。这是进度条的常规做法，但与「只用 transform/opacity」不一致。
- **卡片展开过渡用 `max-height`**（0 → 600px）：超出 600px 的内容会被裁切，
  且 `max-height` 动画期间会触发重排。更优解是 `grid-template-rows: 0fr → 1fr`。
- **流程图无虚拟化**：节点数多时（>100）DOM 开销线性增长。

### 性能建议

1. **限制 agents 数量**: 超过 100 个建议分页或虚拟滚动
2. **控制轮询频率**: 按需调整 `useAgentTasks.ts` 里的 `POLL_INTERVAL_MS`
3. **减少动画**: 在低性能设备上自动禁用非必要动画

## 可访问性

### 已实现

- ✅ 语义化 HTML（`<article>` / `<section>` / `<header>`）
- ✅ 图标按钮一律带 `aria-label`（取消、放大、缩小、重置、取消全部）
- ✅ 可展开区域带 `aria-expanded`（卡片展开按钮、卡片头、流程图节点）
- ✅ 互斥切换组带 `aria-pressed`（编排器视图切换、时间线过滤器）
- ✅ 卡片头与流程图节点是 `role="button"` + `tabindex="0"`，
      支持 Enter / Space 键盘操作
- ✅ 过滤按钮组有 `role="group"` + `aria-label`
- ✅ 状态图标 `role="img"` + `aria-label`
- ✅ 支持 `prefers-reduced-motion`

### 颜色对比度（重要约定）

组件**不要**直接拿 `--accent` / `--status-ok` / `--status-error` 当文字色——
它们在多个主题下不达 WCAG AA。仓库为此提供了三套专用 token：

| 用途 | 用这个 |
|------|--------|
| 状态色/强调色作**文字** | `--accent-text`、`--status-ok-text`、`--status-error-text`、`--status-warn-text`、`--status-info-text` |
| 不透明**实底**上压字（accent 按钮、error 按钮） | `--accent-solid` + `--accent-solid-text`；`--status-error-solid` + `--status-error-solid-text` |
| 描边 / 图标 / 渐变端点 / 纯装饰图形 | 原始 `--accent` / `--status-*` |

所有这些配对都由 `web/tests/themeTokens.spec.ts` 守着（≥4.5:1）；
新增主题时漏配即测试红。详见 `assets/styles/tokens.css` 里的注释。

### 未实现（诚实清单）

- ❌ **`aria-live`**：任务状态在变化，但没有 live region 播报给读屏。
  实现时应放在汇总区（如「N 个任务正在执行」）。
- ❌ **焦点管理**：展开/收起卡片后焦点不转移；视图切换（列表↔流程图）
  后焦点会丢。
- ❌ 时间戳的 `datetime` 属性未标注机器可读时间。

### 测试建议

1. 使用屏幕阅读器测试（NVDA / JAWS / VoiceOver）
2. 纯键盘操作测试：Tab 遍历 + Enter/Space 激活
3. 高对比度模式测试
4. 缩放至 200% 测试

## 浏览器兼容性

### 支持的浏览器

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

### Polyfills

如需支持更旧的浏览器，请添加以下 polyfills：
- `color-mix()` polyfill
- `dvh` 单位 polyfill

## 故障排除

### 常见问题

**Q: 页面显示「后台子任务功能未启用」？**
A: `GET /api/sessions/:id/deferred-runs` 返回了 404——后端没挂这个路由。
这是刻意为之的降级：能力不存在时不报错，而是说明原因。

**Q: 任务列表是空的，但明明派发过子 Agent？**
A: 确认当前会话 id 正确（页面读的是 `useSessionStore().sessionId`）。
子任务只在**它所属的会话**下可见。

**Q: 状态不自动刷新？**
A: 轮询只在存在 `queued` / `running` 任务时进行，全终态后自动停。
要手动刷新点右上角「刷新」按钮。

**Q: 缩放没反应？**
A: 检查 `.flow-viewport` 是否被外部样式覆盖了 `transform`。

**Q: 动画卡顿？**
A: 减少同时渲染的组件数量，检查是否触发了重排
（已知取舍见「性能优化」一节）。

**Q: 样式不对 / 颜色奇怪？**
A: 确保引入了主题 CSS 文件（`App.vue` 里 `@import '@/themes/*.css'`），
检查 CSS 变量是否正确定义。**不要**在覆盖样式里写死色值。

### 调试技巧

1. 开启 Vue DevTools
2. 检查网络请求（`/api/sessions/*/deferred-runs`）
3. 使用 Performance 面板分析性能
4. 主题相关的问题跑 `cd web && npx vitest run tests/themeTokens.spec.ts`

## 未来计划（未做，非承诺）

### 已确认的缺口

- [ ] `aria-live`：任务状态变化不播报给读屏（见「可访问性」）
- [ ] 焦点管理：展开/收起、切换视图后焦点会丢
- [ ] 节点拖拽与画布平移：`AgentFlowCanvas` 只做了缩放
- [ ] `max-height` 展开动画的裁切问题（超过 600px 会截断）

### 可能的增强

- [ ] 拖拽排序 / 批量操作
- [ ] 更多图表类型（甘特图、泳道图）
- [ ] 结果全文检索与过滤

### 需要后端先支持

- [ ] 子任务间的真实依赖关系（当前依赖边是从 `parent_turn_id` **推导**的）
- [ ] 任务进度百分比（后端 `DeferredRun` 未提供 `progress` 字段，
      当前进度条是模拟动画）
- [ ] 暂停 / 恢复（后端无对应端点，故前端不做）

## 贡献指南

改这套组件时，除仓库通用规范外特别注意：

1. **先跑测试**：`cd web && npx vitest run`
2. **不写死色值**：会被 `node scripts/check-hardcoded-colors.mjs` 拦下；
   状态色/强调色作文字或实底必须用 `--*-text` / `--*-solid` 配对 token
   （见「可访问性」一节）
3. **不加假功能**：按钮必须有真实后端端点支撑
4. **不加不可达的交互**：可点击元素要么是 `<button>`，要么补
   `role="button"` + `tabindex` + 键盘事件
5. **动画走 `useGsap` + `contextSafe`**，并在需要 DOM 时加 `flush: 'post'`
6. **隐私**：不要把 `task` / `name` 等后端字段透到 UI（ADR 0003）

## 许可证

与 MaxmaHere 项目保持一致

---

**更新日期**: 2026-10-20
