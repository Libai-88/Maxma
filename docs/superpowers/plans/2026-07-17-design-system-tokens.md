# 2026-07-17 设计系统 Token 化工作计划

> 范围：`web/src/assets/styles/{tokens,design-system,animations}.css`、`web/src/themes/*.css`（11 个）、`web/src/composables/useTheme.ts`
> 审查发现：P1-5 / P1-9 / P2-1 / P2-2 / P2-3 / P2-4
> 目标：让设计系统 token 成为单一真相来源，移除兜底和品牌遗留

## 一、theme-factory skill 关键指导原则

1. **单一真相来源**：每个 token 只在一处定义，其他位置只引用 `var(--token)`，绝不重复硬编码。
2. **主题一致性**：跨主题的相同语义 token（如 `--status-ok`）必须保持各主题的色调一致——浅色主题用低饱和深色，深色主题用高亮浅色。
3. **对比度与可读性**：状态色（ok/warn/error/info）必须与 `--bg-card` 形成足够对比，无障碍主题（high-contrast / midnight-contrast）尤其要拉高对比。
4. **品牌统一**：所有命名前缀统一为 `maxma-*`，不留用 `hana-*` 等历史前缀。
5. **fallback 是不信任的信号**：`var(--x, #fallback)` 暴露了对设计系统的不信任，token 完整覆盖后应清除所有 fallback。

## 二、现状盘点

### 2.1 独占文件清单（已读完）

| 文件 | 行数 | 状态 |
| --- | --- | --- |
| `web/src/assets/styles/tokens.css` | 83 | 含 `--sidebar-width: 240px`，未定义任何状态色 |
| `web/src/assets/styles/design-system.css` | 192 | 行 122-137 硬编码状态色 |
| `web/src/assets/styles/animations.css` | 160 | 全文使用 `hana-*` 前缀 |
| `web/src/composables/useTheme.ts` | 189 | isDark 硬编码 `midnight || midnight-contrast` |
| `web/src/themes/*.css`（11 个） | 56-114 | 已定义 `--status-ok/warn/error`，未定义 `--status-info` |

### 2.2 styles/ 和 themes/ 中的 `var(--xxx, #fallback)` 兜底

**搜索结果：0 处**。`web/src/assets/styles/` 与 `web/src/themes/` 中没有任何 `var(--xxx, #fallback)` 兜底写法。
P1-9 中"15+ 文件"实际全部位于 `.vue` 组件中（共 43 个 .vue 文件，详见附录 A）。

**结论**：P1-9 在我的独占范围内无需修改，仅需在计划中记录 .vue 兜底清单供后续 agent 处理。

### 2.3 `hana-*` 在 .vue 文件中的引用

**搜索结果：0 处**。`*.vue` 文件中没有任何 `hana-` 字样。
`.vue` 组件当前未直接引用 `animations.css` 中的 `hana-*` 类名或 keyframe 名（已通过 Grep `glob: *.vue` 确认）。

**结论**：`hana-*` → `maxma-*` 迁移在独占范围内可独立完成，不会破坏 .vue 文件。

### 2.4 P2-4 sidebar 宽度差异

- `tokens.css:62` 定义 `--sidebar-width: 240px`
- `App.vue:453` 硬写 `width: 220px; min-width: 220px;`

**结论**：App.vue 不在我的独占范围，不能修改。token 值 240px 是设计系统的真相来源，220px 是 App.vue 的历史遗留。
本计划不调整 token 值（保持 240px），在最终报告中标记差异，建议后续 agent 把 App.vue 改用 `var(--sidebar-width)`。

## 三、执行任务清单

### 任务 A：状态色 token 化（P1-5）

**A1. 在 `tokens.css` 增补状态色默认值**

在 `--sidebar-width` 附近新增一段：
```css
/* ── 状态色（默认值，由各主题覆盖） ── */
--status-ok:    #16a34a;
--status-warn:  #d97706;
--status-error: #dc2626;
--status-info:  #2563eb;
```
> 说明：默认值与 Tailwind 调色板一致，仅作为兜底；实际生效值由各主题文件覆盖。

**A2. 在所有 11 个主题文件中覆盖状态色**

每个主题已有 `--status-ok/warn/error`，**只需新增 `--status-info`**。
为保持色调一致，各主题 `--status-info` 取值（与 `--bg-card` 对比度足够）：

| 主题 | `--status-info` | 备注 |
| --- | --- | --- |
| warm-paper | `#537D96` | 与 accent 同色（远山青） |
| midnight | `#8AB4D8` | 淡天蓝，深底高亮 |
| midnight-contrast | `#A0C8E0` | 高可读蓝 |
| high-contrast | `#1A3A6A` | 深蓝高对比 |
| grass-aroma | `#5A8C9A` | 灰青蓝 |
| contemplation | `#5A7A9A` | 灰蓝调 |
| coral | `#2B6878` | 墨蓝深色 |
| delve | `#4A6FB5` | 克制蓝 |
| deep-think | `#515FDC` | 与 accent 同色 |
| absolutely | `#6B7E8A` | 中性灰蓝 |
| dawn | `#6B9BA5` | 与 accent 同色 |

**A3. `design-system.css` 改用 token 引用**

行 122-137 的 `.ds-badge--ok/warn/error/info` 中：
- `color: #16a34a` → `color: var(--status-ok)`
- `color: #d97706` → `color: var(--status-warn)`
- `color: #dc2626` → `color: var(--status-error)`
- `color: #2563eb` → `color: var(--status-info)`
- 对应 `color-mix(in srgb, #XXX 10%, var(--bg-card))` 中的硬编码也替换为 `var(--status-*)`

**验证**：`vue-tsc --noEmit` + `npx vitest run`

**提交**：单独一个 commit `feat(design-system): tokenize status colors across themes`

### 任务 B：动画前缀迁移 `hana-*` → `maxma-*`（P2-1）

**B1. `animations.css` 全文替换**

- 顶部注释更新："命名前缀 hana-*" → "命名前缀 maxma-*"，删除"与 openhanoko 保持一致"一句
- 所有 `@keyframes hana-*` → `@keyframes maxma-*`（共 22 个 keyframe）
- `@media (prefers-reduced-motion: reduce)` 内部所有 `.hana-*` 选择器 → `.maxma-*`（共 9 个 class）

**安全性**：.vue 文件无 hana-* 引用，迁移无破坏性。

**验证**：`vue-tsc --noEmit` + `npx vitest run`

**提交**：单独一个 commit `refactor(animations): rename hana-* prefix to maxma-*`

### 任务 C：warm-paper.css 重复定义清理（P2-2）

**C1. 删除行 17 与 `--accent-pink` 同值的 `--accent-pink-light`**

行 16: `--accent-pink: #EC8F8D;`
行 17: `--accent-pink-light: #EC8F8D;`（同值重复）

**处理**：将 `--accent-pink-light` 改为引用而非硬编码：
```css
--accent-pink-light: var(--accent-pink);
```
> 保留语义（其他主题文件也定义 `--accent-pink-light`），但用 var 引用消除重复值。
> 注：其他主题文件也都有 `--accent-pink-light` 与 `--accent-pink` 同值的情况（一致性差），但本任务只处理 warm-paper.css（独占范围内、且 P2-2 仅指出 warm-paper）。

**C2. 删除行 54 重复定义的 `--hana-text`**

行 35: `--hana-text: #2B3A4E;`
行 54: `--hana-text: #5a7a8a;`（后定义会覆盖前一个）

**处理**：删除行 54 的重复定义，保留行 35 的值（与主色调协调）。
> 选择保留行 35 的 `#2B3A4E`（深墨色），因为更符合"5 档墨色"语义，行 54 的 `#5a7a8a` 是后加的"聊天专用语义色"段误加的重复。

**C3. 删除行 58 重复定义的 `--tool-bg`**

行 36: `--tool-bg: rgba(83, 125, 150, 0.06);`
行 58: `--tool-bg: rgba(var(--accent-rgb), 0.04);`（后定义覆盖前一个）

**处理**：删除行 58 的重复定义，保留行 36 的值。
> 选择保留行 36 的 `rgba(83, 125, 150, 0.06)`，因为 warm-paper.css 的其他位置（如 `--user-bg: rgba(var(--accent-rgb), 0.08)`）已使用 `--accent-rgb` 引用模式，行 36 的硬编码与行 12 的 `--user-bubble: rgba(83, 125, 150, 0.08)` 风格一致。
> 注：行 36 的 `rgba(83, 125, 150, 0.06)` 实际等价于 `rgba(var(--accent-rgb), 0.06)`（因为 `--accent-rgb: 83, 125, 150`），可考虑改为 var 引用，但本任务范围仅"删除重复"，不优化硬编码→var。

**验证**：`vue-tsc --noEmit` + `npx vitest run`

**提交**：单独一个 commit `fix(theme/warm-paper): remove duplicate token definitions`

### 任务 D：useTheme.ts isDark 改读 ThemeMeta.isDark（P2-3）

**D1. 重构 `isDark` computed**

原代码（行 151-154）：
```ts
const isDark = computed(() => {
  const t = activeTheme.value
  return t === 'midnight' || t === 'midnight-contrast'
})
```

改为：
```ts
const isDark = computed(() => {
  const t = activeTheme.value
  return THEMES.find(m => m.id === t)?.isDark ?? false
})
```

**好处**：未来新增暗色主题只需在 `THEMES` 数组中加 `isDark: true`，无需改 composable。

**安全性**：测试 `useTheme.spec.ts` 仅验证 matchMedia listener 注册/移除，不依赖 isDark 实现，不会破坏。

**验证**：`vue-tsc --noEmit` + `npx vitest run`

**提交**：单独一个 commit `refactor(useTheme): derive isDark from ThemeMeta instead of hardcoded ids`

## 四、不在独占范围内的事项（移交清单）

### 4.1 P1-9 — .vue 中的 `var(--xxx, #fallback)` 兜底清单

完整清单见**附录 A**。共 43 个 .vue 文件。需后续 agent 处理：
- 删除所有 `var(--xxx, #fallback)` 中的 `, #fallback` 部分
- 确保对应 token 已在主题文件中定义（绝大多数已定义）

### 4.2 P2-1 — .vue 中引用 `hana-*` 前缀的清单

**搜索结果为空**：`*.vue` 文件中没有 `hana-` 字样。无需后续处理。

### 4.3 P2-4 — sidebar 宽度差异

- `tokens.css:62` `--sidebar-width: 240px`
- `App.vue:453` `width: 220px; min-width: 220px;`

**建议**：后续 agent 把 App.vue 改用 `width: var(--sidebar-width); min-width: var(--sidebar-width);`，或反过来讨论设计意图后调整 token 值。

## 五、附录

### 附录 A：.vue 中 `var(--xxx, #fallback)` 兜底清单

> 搜索命令：`Grep glob:*.vue pattern:var\(--[a-z-]+,\s*#`
> 涉及 43 个 .vue 文件，按出现频次排序，节选前 100 条（完整列表见 Grep 输出）

主要文件（含状态色兜底的，与本任务直接相关）：
1. `src/components/ApprovalBubble.vue` 行 107/108/111/114/152/153/156/157/160/161/210/218/230/236 — `var(--status-error, #dc2626)`、`var(--status-warn, #d97706)`、`var(--status-ok, #16a34a)`
2. `src/views/ActivityView.vue` 行 128/181/184/204/205/206 — `var(--status-ok, #16a34a)`、`var(--status-warn, #d97706)`、`var(--status-error, #dc2626)`
3. `src/components/PermissionModeControl.vue` 行 277/308/309 — `var(--status-warn, #d97706)`
4. `src/components/SessionPermissionModeControl.vue` 行 89 — `var(--status-warn, #b45309)`
5. `src/components/SessionSidebar.vue` 行 1063 — `var(--status-error, #dc2626)`
6. `src/components/SubAgentCard.vue` 行 194 — `var(--status-success, #198754)` ⚠️ 注意 token 名为 `--status-success`，与设计系统 `--status-ok` 不一致，需后续统一
7. `src/components/AutocompletePanel.vue` 行 149 — `var(--accent, #2563eb)`
8. `src/components/MarkdownEditor.vue` 行 161 — `var(--status-error, #c0392b)`
9. `src/views/SoulView.vue` 行 323 — `var(--status-error, #c0392b)`

含 `var(--border, #e5e7eb)` 的 .vue 文件（需后续清除兜底）：
- `ChatHeader.vue:26`、`ChatInput.vue:1083`、`ContextUsageBadge.vue:53/58`、`ErrorCard.vue:155`、`MemoryView.vue:37`、`McpView.vue:1070`、`ModelSelector.vue:64/69/70`、`ModelSettingsPanel.vue:37/40/43`、`PathWhitelistView.vue:422`、`PersonaCard.vue:22/27`、`SkillsView.vue:737/779`、`ToolPanel.vue:53/63`、`WelcomeScreen.vue:30`、`WorkbenchPanel.vue:57/68`、`CanvasContainer.vue:129`、`CanvasTabs.vue:63`

含其他 `var(--xxx, #fallback)` 的 .vue 文件（颜色/背景类）：
- `ChatView.vue`、`HtmlSandbox.vue`、`FilesBubble.vue`、`CanvasContainer.vue`、`WorkbenchPanel.vue`、`CanvasTabs.vue` 等（详见 Grep 完整输出）

### 附录 B：.vue 中硬编码状态色清单（与本任务相关）

> 搜索命令：`Grep glob:*.vue pattern:#(16a34a|d97706|dc2626|2563eb|e5e7eb) -i`

1. `src/App.vue:639` — `color: #dc2626`（硬编码 error）
2. `src/components/ErrorCard.vue:110` — `color-mix(in srgb, #d97706 36%, transparent)` + `color-mix(in srgb, #d97706 10%, var(--bg-card))`
3. `src/components/HealthPanel.vue:109` — `background: #d97706`
4. `src/views/EnvVarsView.vue:337` — `color: #16a34a`
5. `src/views/KbView.vue:609/610/613/614` — `color-mix(in srgb, #16a34a 12%, var(--bg-card))` + `color: #16a34a`、`color-mix(in srgb, #d97706 12%, var(--bg-card))` + `color: #d97706`
6. `src/views/PlaygroundView.vue:867` — `color: #d97706`
7. `src/views/ProvidersView.vue:586` — `border-left: 3px solid #d97706`
8. `src/components/PlanCard.vue:273/274/276/381/383/401` — `background: #16a34a`、`background: #dc2626`、`background: #2563eb`、`background: #16a34a`、`border-color: #16a34a`、`color: #dc2626`
9. `src/components/PulsePanel.vue:82` — `background: #d97706`
10. `src/components/tools/AskUserBubble.vue:480/516` — `color: #dc2626`、`background: #dc2626`
11. `src/components/tools/WeatherBubble.vue:544/547/622/624/632/634` — `border-color: #dc2626`、`border-color: #2563eb`、`color: #dc2626`、`color: #2563eb`

### 附录 C：执行顺序与提交节点

1. 计划文件提交（本文件）
2. 任务 A：状态色 token 化
3. 任务 B：animations.css 前缀迁移
4. 任务 C：warm-paper.css 重复清理
5. 任务 D：useTheme isDark 重构

每个任务完成后立即 commit，便于回滚。
