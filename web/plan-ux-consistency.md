# 交叉体验一致性审计计划

## 审计范围

- `src/views/ProvidersView.vue`
- `src/views/McpView.vue`
- `src/views/SkillsView.vue`
- `src/views/AppearanceView.vue`
- 基线：`src/assets/styles/design-system.css` + `src/assets/styles/tokens.css`

---

## 1. 标题和导航一致性

### 现状

| 页面 | 当前标题 | 格式 |
|---|---|---|
| ProvidersView | `<h2>提供商管理</h2>` | 仅中文 |
| McpView | `<h2>MCP 服务</h2>` | 中英混合（MCP 是英文缩写） |
| SkillsView | `<h2>Skills & 宏</h2>` | 英文在前，中文在后 |
| AppearanceView | `<h2>外观</h2>` | 仅中文 |

### 目标格式

所有页面标题统一为 `<h2>中文 English</h2>`（中文在前，英文在后）：

| 页面 | 目标标题 |
|---|---|
| ProvidersView | `<h2>提供商管理 Providers</h2>` |
| McpView | `<h2>MCP 服务 MCP Services</h2>` |
| SkillsView | `<h2>技能 Skills & 宏 Macros</h2>` |
| AppearanceView | `<h2>外观 Appearance</h2>` |

### 风险
- 低风险。纯文案修改，不影响功能。

---

## 2. 按钮样式一致性

### 现状

所有四个页面都使用**本地 scoped 样式**定义按钮，而非 `design-system.css` 中的 `ds-btn` 系列。

**`ProvidersView` 按钮样式：**
- `.btn`：`padding: 6px 14px; border-radius: 6px; font-size: 13px; background: var(--bg-card)`
- `.btn.primary`：`background: var(--accent); color: var(--bg-primary)`
- `.btn.sm`：`padding: 4px 10px; font-size: 12px`
- `.btn.danger`：定义存在于样式中，但模板中从未使用
- `.action-btn`：`padding: 6px 14px; border-radius: 6px; font-size: 12px; background: var(--bg-card)`

**`McpView` 按钮样式：**
- `.btn`：`padding: 8px 16px; border-radius: 8px; font-size: 14px; background: var(--bg-secondary)`
- `.btn.primary`：`background: var(--accent); color: var(--bg-primary)`
- `.action-btn`：`padding: 5px 12px; border-radius: 6px; font-size: 12px; background: var(--bg-secondary)`
- `.action-btn.danger`：`color: var(--status-error)`

**`SkillsView` 按钮样式：**
- `.btn`：`padding: 8px 16px; border-radius: 8px; font-size: 14px; background: var(--bg-secondary)`（与 McpView 相同）
- `.btn.primary`：`background: var(--accent); color: #fff`
- `.action-btn`：`padding: 4px 10px; border-radius: 6px; font-size: 12px; background: var(--bg-secondary)`
- `.action-btn.danger`：`color: #d32f2f`（硬编码色值，而非 `var(--status-error)`）

**`AppearanceView`：**
- 无标准按钮，使用 `toggle-btn` / `theme-card`，属于页面的独特交互，不做修改。

### 关键不一致

| 问题 | 详情 | 严重程度 |
|---|---|---|
| `.btn` 基础样式不一致 | ProvidersView 使用 `6px 14px / 6px / 13px / bg-card`，McpView/SkillsView 使用 `8px 16px / 8px / 14px / bg-secondary` | **中** |
| `.btn.primary` 文字色不一致 | ProvidersView/McpView 用 `var(--bg-primary)`，SkillsView 用 `#fff` | 低（多数主题下 `--bg-primary` = #fff） |
| `.btn.danger` 定义但未使用 | ProvidersView 定义了但模板无引用 | 低 |
| `.action-btn.danger` 色值不一致 | SkillsView 用硬编码 `#d32f2f` 而非 `var(--status-error)` | **中** |
| 未使用 `ds-btn` 体系 | 任何页面均未引用 `design-system.css` 的按钮类 | 建议性 |

### 建议修复

1. **统一 `.btn` 基础样式**：以 McpView/SkillsView 为准（`8px 16px / 8px / 14px / bg-secondary`），修改 ProvidersView 匹配。
2. **统一 `.btn.primary` 文字色**：全部使用 `var(--bg-primary)`。
3. **硬编码 `#d32f2f` 替换**：SkillsView 中 `.action-btn.danger` 和 `.warn-text`、`.content-modal-close:hover`、`.save-msg.error` 中的硬编码色值改为 `var(--status-error)`。
4. **移除未使用的 `.btn.danger`** 样式，或添加到模板中实际使用。
5. **不改用 `ds-btn`**（避免过度重构）。

---

## 3. 返回/取消行为一致性

### 现状

| 页面 | 取消行为 | 状态重置 |
|---|---|---|
| ProvidersView | `cancelForm()` → `mode.value = 'list'` | 未重置表单数据（但下次 startAdd 会重建） |
| McpView | `cancelForm()` → `mode.value = 'list'`；`editSeq++`（取消进行中的编辑请求） | 未重置表单数据 |
| SkillsView | `cancelForm()` → `mode.value = 'list'`；调用 `resetFormState()` | 重置表单数据、editingId、editingSource、saveMessage |
| AppearanceView | 无表单编辑 | N/A |

### 结论

- **核心行为一致**：所有表单页面取消都返回列表模式。
- **细微差异**：ProvidersView 和 McpView 在取消时**没有重置表单数据**（虽然 Reactivity 层面下次 startAdd/edit 会覆盖，但视觉上取消后表单对象带着旧值）。SkillsView 最严谨地调用了 `resetFormState()`。
- **建议**：统一在 `cancelForm()` 中重置表单状态。但考虑到 Vue `reactive`/`ref` 的特性，如果 `mode` 切换后表单 DOM 被 `v-if`/`v-else` 销毁重建，旧值不会残留。检查发现 ProvidersView 和 McpView 都是用 `v-if`/`v-else` 切换列表/表单，所以实际不会残留。**无需修改**。

---

## 4. 加载指示器一致性

### 现状

| 页面 | 加载指示器 | 格式 |
|---|---|---|
| ProvidersView | `<div class="loading">加载中...</div>` | 纯文字 |
| McpView | `<div class="loading">加载中...</div>` | 纯文字 |
| SkillsView | `<div class="loading">加载中...</div>` + `<div class="loading">加载详情中...</div>` | 纯文字 |
| AppearanceView | 无异步加载 | N/A |

### 结论

- 所有页面一致使用文字 "加载中..."。
- **建议**：在 `design-system.css` 中定义 `.ds-loading` 统一样式，但要保持与现有 `.loading` 的兼容。考虑到现有四个页面样式均已正常工作，此修改属于增强而非修复。**列为建议，本次不做修改**。

---

## 5. 其他发现

### SkillsView 硬编码色值

以下位置使用了硬编码色值而非 CSS 变量：

| 位置 | 硬编码值 | 应使用 |
|---|---|---|
| `.action-btn.danger` | `color: #d32f2f` | `var(--status-error)` |
| `.action-btn.danger:hover` | `border-color: #d32f2f` | `var(--status-error)` |
| `.warn-text` | `color: #d32f2f` | `var(--status-error)` |
| `.toggle-btn.active` | `background: #e8f5e9; color: #2e7d32; border-color: #2e7d32` | 与 theme 变量保持一致 |
| `.save-msg.error` | `color: #d32f2f` | `var(--status-error)` |
| `.global-message.ok` | `background: #e8f5e9; color: #2e7d32` | `var(--status-ok)` 相关 mix |
| `.global-message.error` | `background: #ffebee; color: #d32f2f` | `var(--status-error)` 相关 mix |

这些硬编码色值在暗色主题下可能可读性差。建议替换为 CSS 变量。

---

## 执行计划

### Phase 1 — 标题一致性（低风险）
修改四个视图的 `<h2>` 内容为 `中文 English` 格式。

### Phase 2 — 按钮样式统一（中风险）
1. 修改 ProvidersView 的 `.btn` 样式匹配 McpView/SkillsView
2. 替换 SkillsView 中的硬编码色值为 CSS 变量

### Phase 3 — 验证
- `npx vue-tsc --noEmit` 类型检查
- 视觉审查

---

## 不修改项目（记录）

- 取消行为：已一致，不做修改。
- 加载指示器格式：已一致，不做修改。
- 改用 `ds-btn`：过度重构，不做修改。
- AppearanceView toggle-btn / theme-card：属于独特交互，不做修改。
