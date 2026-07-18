# Vue 文件硬编码颜色与兜底写法清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 25 个 .vue 文件中的硬编码颜色和 `var(--xxx, #fallback)` 兜底写法，统一使用设计系统 token。

**Architecture:** 逐文件读取上下文后，将硬编码颜色替换为语义等价的 CSS 变量（`--status-ok/warn/error/info`、`--text-primary`、`--bg-card` 等），移除所有 `var(--xxx, #fallback)` 中的兜底值。对非标准变量（`--border-color`/`--accent-color`/`--accent-bg`/`--bg-hover`）归一化到标准 token。每 5-8 个文件提交一次。

**Tech Stack:** Vue 3 + TypeScript + Vite + Vitest

---

## 背景

前一轮 Agent 31 完成了 styles/ 和 themes/ 中的 token 化，但 .vue 文件中仍有大量硬编码颜色和兜底写法。本计划清理 Agent 38 独占范围内的 25 个 .vue 文件。

## 设计系统 token 参考

### 标准 token（已定义，可安全移除兜底）
- 状态色：`--status-ok`(#16a34a)、`--status-warn`(#d97706)、`--status-error`(#dc2626)、`--status-info`(#2563eb)
- 文本色：`--text-primary`、`--text-secondary`、`--text-tertiary`
- 背景色：`--bg-card`、`--bg-primary`、`--bg-secondary`
- 边框：`--border`
- 强调：`--accent`

### 颜色映射规则
| 硬编码颜色 | 替换为 |
|---|---|
| `#16a34a` / `#22c55e` / `#15803d` | `var(--status-ok)` |
| `#d97706` / `#f59e0b` / `#f97316` | `var(--status-warn)` |
| `#dc2626` / `#b91c1c` | `var(--status-error)` |
| `#2563eb` / `#3b82f6` | `var(--status-info)` |
| `#000` / `#000000`（文本） | `var(--text-primary)` |
| `#000` / `#000000`（accent 背景） | `var(--accent)` |
| `#fff` / `#ffffff`（背景） | `var(--bg-card)` 或 `var(--bg-primary)` |
| `#fff` / `#ffffff`（accent/状态色上的文本） | `var(--bg-primary)` |

### 非标准变量归一化
| 非标准变量 | 归一化为 |
|---|---|
| `--border-color` | `--border` |
| `--accent-color` | `--accent` |
| `--bg-hover` | `--bg-secondary` |
| `--accent-bg` | `color-mix(in srgb, var(--accent) 12%, var(--bg-card))` |

### 特殊处理
- `--status-success` → `--status-ok`（SubAgentCard.vue:194）
- `color: white` 关键字：保留不变（不在 grep 范围内，且设计系统也使用 `white` 关键字）

### 不在映射范围内的颜色（保留原样）
- 浅色 tint（如 `#86efac`、`#f0fdf4`、`#fef2f2`、`#fffbeb` 等）：无对应 token，保留
- 非状态色（如 `#7c3aed` 紫色、`#e65100` 深橙）：无语义 token，保留

---

## File Structure

25 个文件，分 5 批提交：

| 批次 | 文件 | 路径 |
|---|---|---|
| 1 | ApprovalBubble, AutocompletePanel, ChatHeader, ContextUsageBadge, ErrorCard, HealthPanel | components/ |
| 2 | ModelSettingsPanel, PermissionModeControl, SessionPermissionModeControl, SubAgentCard, ToolPanel | components/ |
| 3 | PlanCard, PulsePanel, WorkbenchPanel, CanvasTabs, AskUserBubble, WeatherBubble | components/ + tools/ |
| 4 | ActivityView, EnvVarsView, KbView, MemoryView, PathWhitelistView | views/ |
| 5 | PlaygroundView, ProvidersView, McpView | views/ |

---

### Task 1: Commit 1 — components 批次 A（6 文件）

**Files:**
- Modify: `web/src/components/ApprovalBubble.vue`
- Modify: `web/src/components/AutocompletePanel.vue`
- Modify: `web/src/components/ChatHeader.vue`
- Modify: `web/src/components/ContextUsageBadge.vue`
- Modify: `web/src/components/ErrorCard.vue`
- Modify: `web/src/components/HealthPanel.vue`

每个文件的改动：
1. **ApprovalBubble.vue**: 移除所有 `var(--status-*, #fallback)` 兜底；`#15803d` → `var(--status-ok)`；`#b91c1c` → `var(--status-error)`；`color: #fff`（状态色按钮上） → `var(--bg-primary)`
2. **AutocompletePanel.vue**: `var(--accent, #2563eb)` → `var(--accent)`
3. **ChatHeader.vue**: 移除所有兜底（`#fff`、`#e5e7eb`、`#1f2937`、`#9ca3af`、`#6b7280`）
4. **ContextUsageBadge.vue**: 移除兜底；`#f59e0b` → `var(--status-warn)`；`var(--accent, #000)` → `var(--accent)`；`var(--bg-card, #fff)` → `var(--bg-card)`
5. **ErrorCard.vue**: 移除兜底；`#3b82f6` → `var(--status-info)`；`#f97316` → `var(--status-warn)`；`#d97706` → `var(--status-warn)`；`var(--accent, #000)` → `var(--accent)`；`var(--bg-primary, #fff)` → `var(--bg-primary)`
6. **HealthPanel.vue**: `#d97706` → `var(--status-warn)`

- [ ] Step 1: 逐文件读取并修改
- [ ] Step 2: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit` 验证类型
- [ ] Step 3: 提交 `git add -A && git commit -m "refactor(vue): remove hardcoded colors and fallbacks in components batch A"`

---

### Task 2: Commit 2 — components 批次 B（5 文件）

**Files:**
- Modify: `web/src/components/ModelSettingsPanel.vue`
- Modify: `web/src/components/PermissionModeControl.vue`
- Modify: `web/src/components/SessionPermissionModeControl.vue`
- Modify: `web/src/components/SubAgentCard.vue`
- Modify: `web/src/components/ToolPanel.vue`

每个文件的改动：
1. **ModelSettingsPanel.vue**: 移除兜底；`background: #000; color: #fff; border-color: #000`（toggle-btn.active）→ `var(--accent)` / `var(--bg-primary)` / `var(--accent)`
2. **PermissionModeControl.vue**: 移除 `var(--status-warn, #d97706)` 兜底
3. **SessionPermissionModeControl.vue**: 移除 `var(--status-warn, #b45309)` 兜底
4. **SubAgentCard.vue:194**: `var(--status-success, #198754)` → `var(--status-ok)`
5. **ToolPanel.vue**: 移除所有兜底；`background: #000; color: #fff`（tool-badge.custom）→ `var(--accent)` / `var(--bg-primary)`

- [ ] Step 1: 逐文件读取并修改
- [ ] Step 2: 验证类型
- [ ] Step 3: 提交 `refactor(vue): remove hardcoded colors and fallbacks in components batch B`

---

### Task 3: Commit 3 — components 批次 C + tools（6 文件）

**Files:**
- Modify: `web/src/components/PlanCard.vue`
- Modify: `web/src/components/PulsePanel.vue`
- Modify: `web/src/components/workbench/WorkbenchPanel.vue`
- Modify: `web/src/components/workbench/CanvasTabs.vue`
- Modify: `web/src/components/tools/AskUserBubble.vue`
- Modify: `web/src/components/tools/WeatherBubble.vue`

每个文件的改动：
1. **PlanCard.vue**: `#16a34a` → `var(--status-ok)`；`#15803d` → `var(--status-ok)`；`#dc2626` → `var(--status-error)`；`#2563eb` → `var(--status-info)`；`color: white`（按钮文本）→ `var(--bg-primary)`；保留浅色 tint
2. **PulsePanel.vue**: `#d97706` → `var(--status-warn)`
3. **WorkbenchPanel.vue**: 非标准变量归一化（`--border-color`→`--border`、`--accent-color`→`--accent`、`--bg-hover`→`--bg-secondary`、`--accent-bg`→`color-mix`）；`color: #fff` → `var(--bg-primary)`；移除所有兜底
4. **CanvasTabs.vue**: 非标准变量归一化；移除 `var(--accent, #2563eb)` 兜底；移除其他兜底
5. **AskUserBubble.vue**: `#b91c1c` → `var(--status-error)`；`#dc2626` → `var(--status-error)`；`color: #fff`（按钮上）→ `var(--bg-primary)`；`#4caf50` → `var(--status-ok)`；保留 `#fef2f2`/`#fecaca` 浅色 tint
6. **WeatherBubble.vue**: `#b91c1c` → `var(--status-error)`；`#dc2626` → `var(--status-error)`；`#2563eb` → `var(--status-info)`；保留 `#7c3aed`/`#ea580c`/`#ca8a04`（无语义 token）；移除 `var(--text-tertiary, #bbb)` 兜底

- [ ] Step 1: 逐文件读取并修改
- [ ] Step 2: 验证类型
- [ ] Step 3: 提交 `refactor(vue): remove hardcoded colors and fallbacks in components batch C and tools`

---

### Task 4: Commit 4 — views 批次 A（5 文件）

**Files:**
- Modify: `web/src/views/ActivityView.vue`
- Modify: `web/src/views/EnvVarsView.vue`
- Modify: `web/src/views/KbView.vue`
- Modify: `web/src/views/MemoryView.vue`
- Modify: `web/src/views/PathWhitelistView.vue`

每个文件的改动：
1. **ActivityView.vue**: 移除所有 `var(--status-*, #fallback)` 兜底
2. **EnvVarsView.vue**: `#22c55e` → `var(--status-ok)`；`#16a34a` → `var(--status-ok)`
3. **KbView.vue**: `color: #fff` → `var(--bg-primary)`；`#16a34a` → `var(--status-ok)`；`#d97706` → `var(--status-warn)`
4. **MemoryView.vue**: 移除所有兜底
5. **PathWhitelistView.vue**: `var(--accent, #3b82f6)` → `var(--accent)`

- [ ] Step 1: 逐文件读取并修改
- [ ] Step 2: 验证类型
- [ ] Step 3: 提交 `refactor(vue): remove hardcoded colors and fallbacks in views batch A`

---

### Task 5: Commit 5 — views 批次 B（3 文件）

**Files:**
- Modify: `web/src/views/PlaygroundView.vue`
- Modify: `web/src/views/ProvidersView.vue`（只改颜色，不改 any 类型）
- Modify: `web/src/views/McpView.vue`（同上）

每个文件的改动：
1. **PlaygroundView.vue**: `#d97706` → `var(--status-warn)`
2. **ProvidersView.vue**: `#ffffff` → `var(--bg-card)` 或 `var(--bg-primary)`；`#d97706` → `var(--status-warn)`；保留 `#fffbeb`（浅色 tint）
3. **McpView.vue**: `color: #fff` → `var(--bg-primary)`；`background: #fff` → `var(--bg-card)`；移除所有兜底；保留 `#fff3e0`/`#e65100`（transport-badge 专属色）

- [ ] Step 1: 逐文件读取并修改
- [ ] Step 2: 验证类型
- [ ] Step 3: 提交 `refactor(vue): remove hardcoded colors and fallbacks in views batch B`

---

### Task 6: 最终验证

- [ ] Step 1: `cd d:\Maxma\MaxmaHere\web && npx vitest run`
- [ ] Step 2: `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`
- [ ] Step 3: Grep 验证目标文件中不再有硬编码颜色和兜底

---

## Self-Review

1. **Spec coverage**: 所有 25 个独占文件已覆盖；`--status-success`→`--status-ok` 已覆盖；兜底移除已覆盖；硬编码状态色替换已覆盖。
2. **Placeholder scan**: 无占位符，所有步骤都有具体文件和改动说明。
3. **Type consistency**: token 名称与 tokens.css/design-system.css 定义一致。
4. **排除文件**: CanvasContainer.vue（Agent 37）、ModelSelector/ChatInput（Agent 36）、ChatView/ChatWindow（Agent 37）、App/SessionSidebar/MarkdownEditor/SoulView（Agent 39）等均不在本计划范围内。
