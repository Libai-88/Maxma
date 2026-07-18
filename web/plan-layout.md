# Layout & Spacing 精修计划

## 审计发现总结

以下是对 `ProvidersView.vue`、`McpView.vue`、`SkillsView.vue`、`EnvVarsView.vue`、`MemoryView.vue` 等视图的 CSS 全面审计结果。

---

### 1. 页面内边距（呼吸空间）

**现状**：所有视图根容器统一使用 `padding: 24px` （硬编码）。
**问题**：值一致，但未使用 token。
**处理**：全部替换为 `var(--space-24)`。

涉及文件：
- `ProvidersView.vue` L520
- `McpView.vue` L675
- `SkillsView.vue` L449
- `EnvVarsView.vue` L154
- `MemoryView.vue` L35
- `ActivityView.vue` L99

---

### 2. 卡片网格间距

**现状**：所有 `.card-grid` 统一使用 `gap: 16px`（硬编码）。
**问题**：值一致，但未使用 token。
**处理**：全部替换为 `var(--space-16)`。

涉及文件：
- `ProvidersView.vue` L565
- `McpView.vue` L724
- `SkillsView.vue` L538

---

### 3. Header 下边距

**现状**：各视图 `.header` 统一使用 `margin-bottom: 20px`（硬编码）。
**问题**：`--space` token 中没有 20px，最近的选项是 `--space-16` (16px) 或 `--space-24` (24px)。
**建议**：保留 20px 不变（视觉上舒适且与其他 token 比例协调），或改用 `--space-16`。
**处理**：暂时保留 20px 不修改，如需收紧可后续改为 `--space-16`。

---

### 4. 卡片内边距 — 不一致

| 视图 | 当前值 | 建议 |
|------|--------|------|
| ProvidersView `.provider-card` | `padding: 20px` | `var(--space-16)` (16px) 或保留 20px |
| McpView `.mcp-card` | `padding: 16px` | `var(--space-16)` |
| SkillsView `.skill-card` | `padding: 16px` | `var(--space-16)` |

**处理**：统一为 `var(--space-16)`。
- ProvidersView 从 20px → 16px（变化较小，视觉一致优先）
- McpView / SkillsView 直接从硬编码换 token

---

### 5. 卡片内部 gap — 不一致

| 视图 | 当前值 | 建议 |
|------|--------|------|
| ProvidersView `.provider-card` | `gap: 16px` | `var(--space-16)` |
| McpView `.mcp-card` | `gap: 10px` | `var(--space-12)` (12px) 或保留 10px |
| SkillsView `.skill-card` | `gap: 10px` | `var(--space-12)` (12px) 或保留 10px |

**建议**：对准 McpView 和 SkillsView 统一为 `var(--space-12)`，ProvidersView 保持 `var(--space-16)` 不变（其卡片内容更密集需要更大间距）。

---

### 6. 卡片按钮底部对齐 — Bug

**现状**：
- `ProvidersView` 的 `.card-actions` **缺少** `margin-top: auto`
- `McpView` 的 `.card-actions` 已有 `margin-top: auto`
- `SkillsView` 的 `.card-footer` 已有 `margin-top: auto`

**问题**：Provider 卡片高度不同时，操作按钮不会贴在底部。
**处理**：在 `ProvidersView.vue` 的 `.card-actions` 上添加 `margin-top: auto`。

---

### 7. 卡片网格列数 — 不一致

| 视图 | 布局 |
|------|------|
| ProvidersView | `grid-template-columns: repeat(3, 1fr)` |
| McpView | `repeat(auto-fill, minmax(320px, 1fr))` |
| SkillsView | `repeat(auto-fill, minmax(300px, 1fr))` |

**建议**：ProvidersView 的固定三列布局可能是有意为之（提供商卡片信息密集，适合固定列）。本次不修改网格列数策略，仅处理间距 token 化。

---

### 8. 按钮样式不一致（次要）

各视图 `.action-btn` / `.btn` 存在细微 padding 和 border-radius 差异。这些属于组件级而非布局级问题，本次暂不处理。

---

## 修改清单汇总

| # | 文件 | 行号 | 修改内容 | 原值 | 新值 |
|---|------|------|---------|------|------|
| 1 | ProvidersView.vue | 520 | view padding | `24px` | `var(--space-24)` |
| 2 | ProvidersView.vue | 565 | card-grid gap | `16px` | `var(--space-16)` |
| 3 | ProvidersView.vue | 572 | card padding | `20px` | `var(--space-16)` |
| 4 | ProvidersView.vue | 576 | card flex gap | `16px` | `var(--space-16)` |
| 5 | ProvidersView.vue | 729 | card-actions 底部对齐 | _(无)_ | `margin-top: auto` |
| 6 | McpView.vue | 675 | view padding | `24px` | `var(--space-24)` |
| 7 | McpView.vue | 724 | card-grid gap | `16px` | `var(--space-16)` |
| 8 | McpView.vue | 731 | card padding | `16px` | `var(--space-16)` |
| 9 | McpView.vue | 734 | card flex gap | `10px` | `var(--space-12)` |
| 10 | SkillsView.vue | 449 | view padding | `24px` | `var(--space-24)` |
| 11 | SkillsView.vue | 538 | card-grid gap | `16px` | `var(--space-16)` |
| 12 | SkillsView.vue | 545 | card padding | `16px` | `var(--space-16)` |
| 13 | SkillsView.vue | 548 | card flex gap | `10px` | `var(--space-12)` |
| 14 | EnvVarsView.vue | 154 | view padding | `24px` | `var(--space-24)` |
| 15 | MemoryView.vue | 35 | view padding | `24px` | `var(--space-24)` |
| 16 | ActivityView.vue | 99 | view padding | `24px` | `var(--space-24)` |
| 17 | HooksView.vue | 24 | header padding | `24px 32px 16px` | `var(--space-24) var(--space-32) var(--space-16)` |

**总计**：17 处修改，涉及 7 个文件。

## 执行后验证

1. 运行 `npm run type-check` 或 `npx vue-tsc --noEmit` 确保 TypeScript 无报错
2. 视觉回归检查：卡片网格对齐、按钮底部对齐、页面左右呼吸空间

---

## 不处理项（本次 scope 外）

- `.btn` / `.action-btn` 的 padding 和 border-radius 不一致（组件级，非布局）
- `.header` 的 `margin-bottom: 20px`（无 exact token 匹配，暂时保留）
- ProvidersView 固定三列网格（有意设计）
- HooksView 的 `.hooks-view` 容器无 padding（其布局特殊，有 `.empty-state-wrapper` 居中处理）
