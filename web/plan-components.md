# plan-components.md — Component Patterns 统一审计

## 1. 卡片模式 (Card Patterns)

### 现状对比

| 属性 | `.provider-card` | `.mcp-card` | `.skill-card` |
|------|-----------------|-------------|---------------|
| `border-radius` | `12px` (hardcoded) | `12px` (hardcoded) | `12px` (hardcoded) |
| `padding` | **20px** | **16px** | **16px** |
| `box-shadow` | `var(--shadow-sm)` | 无 | 仅 hover 时有 `var(--shadow-sm)` |
| `background` | `var(--bg-card)` | `var(--bg-card)` | `var(--bg-card)` |
| `border` | `1px solid var(--border)` | `1px solid var(--border)` | `1px solid var(--border)` |
| `gap` | **16px** | **10px** | **10px** |

### 发现的不一致
1. **border-radius**: 均为 12px，值一致但未使用 design-token `var(--radius-lg)`
2. **padding**: provider-card 为 `20px`，另外两个为 `16px`
3. **box-shadow**: provider-card 始终有 shadow，mcp-card 没有 shadow，skill-card 仅 hover 有
4. **gap**: provider-card 为 `16px`，另外两个为 `10px`

### 修复方案（不改布局结构）
- 统一 `border-radius: var(--radius-lg)`（替换硬编码 12px）— 三个文件
- 统一 `padding: 16px`（将 provider-card 的 20px 改为 16px）— ProvidersView.vue
- 统一 `box-shadow: var(--shadow-sm)` — 给 mcp-card 加 shadow；skill-card 已有 hover shadow，保持现状（hover 增强不冲突）
- 注意 gap 差异属于布局间距，不改动

---

## 2. 弹窗/Modal 统一

### 现状对比

| 属性 | `.settings-popup` | `.ds-modal` |
|------|------------------|-------------|
| `border-radius` | `var(--radius)` (别名, 实际=8px) | `var(--radius-lg)` (12px) |
| `box-shadow` | `var(--shadow-lg)` | `var(--shadow-xl)` |
| `background` | `var(--bg-card)` | `var(--bg-card)` |
| `border` | `1px solid var(--border)` | `1px solid var(--border)` |
| `padding` | `6px` | 结构不同（title/body/actions） |

### 发现的不一致
1. `.settings-popup` 使用 `var(--radius)` 而非直接的 token（`--radius` 定义在 App.vue 中为 `var(--radius-md)`）
2. 模态框使用 `var(--shadow-xl)`，设置弹窗使用 `var(--shadow-lg)` — 这是合理差异（模态需要更强视觉层次）

### 修复方案
- 将 `.settings-popup` 的 `border-radius: var(--radius)` 改为 `border-radius: var(--radius-md)`（消除间接别名，明确意图）
- DsModal 的 border-radius 已使用 `var(--radius-lg)`，符合规范，无需修改

---

## 3. 按钮统一

### 3.1 `.btn` 普通按钮

| 属性 | ProvidersView | McpView | SkillsView |
|------|--------------|---------|------------|
| `padding` | **6px 14px** | **8px 16px** | **8px 16px** |
| `border-radius` | **6px** | **8px** | **8px** |
| `font-size` | **13px** | **14px** | **14px** |
| `background` | `var(--bg-card)` | `var(--bg-secondary)` | `var(--bg-secondary)` |
| hover | `opacity: 0.8` | 默认浏览器 | 默认浏览器 |
| `.btn.primary` bg | `var(--accent)` | `var(--accent)` | `var(--accent)` |

### 发现的不一致
1. **padding**: ProvidersView 的 `.btn` 为 `6px 14px`，其余为 `8px 16px`
2. **border-radius**: ProvidersView 为 `6px`，其余为 `8px`
3. **font-size**: ProvidersView 为 `13px`，其余为 `14px`
4. **background**: ProvidersView 为 `var(--bg-card)`，其余为 `var(--bg-secondary)`

### 修复方案
- 将 ProvidersView 的 `.btn` 统一为:
  - `padding: 8px 16px`
  - `border-radius: var(--radius-md)` (8px)
  - `font-size: 14px`
  - `background: var(--bg-secondary)`
- 保持 `.btn.sm` 子变体不变（已经是 `padding: 4px 10px; font-size: 12px`）

### 3.2 `.action-btn` 卡片操作按钮

| 属性 | ProvidersView | McpView | SkillsView |
|------|--------------|---------|------------|
| `padding` | **6px 14px** | **5px 12px** | **4px 10px** |
| `border-radius` | 6px | 6px | 6px |
| `font-size` | 12px | 12px | 12px |
| `background` | `var(--bg-card)` | `var(--bg-secondary)` | `var(--bg-secondary)` |
| `color` | `var(--text-secondary)` | `var(--text-primary)` | `var(--text-primary)` |
| hover | `opacity: 0.7` | `border-color: var(--accent)` | `border-color: var(--accent)` |

### 发现的不一致
1. **padding**: 三种不同的值！
2. **background**: ProvidersView 用 `var(--bg-card)`，其他用 `var(--bg-secondary)`
3. **color**: ProvidersView 用 `var(--text-secondary)`，其他用 `var(--text-primary)` 
4. **hover**: 三种不同的表现

### 修复方案
- 统一 `padding: 6px 12px`（折中值，接近所有变体的中间值）
- 统一 `background: var(--bg-secondary)`
- 统一 `color: var(--text-primary)`
- 统一 hover: `border-color: var(--accent)`
- 保持 `border-radius: 6px`（已是 `var(--radius-input)`）

---

## 4. 头像模式

| 元素 | 路径 | `border-radius` |
|------|------|----------------|
| `.logo-img` (侧边栏) | App.vue | `50%` (圆形) |
| `.logo-favicon` (折叠) | App.vue | `50%` (圆形) |
| `.persona-avatar-img` | PersonaCard.vue | `50%` (圆形) |

### 结论
- 所有头像均已一致使用 `border-radius: 50%`，符合预期
- **无需修改**

---

## 5. 修改清单

### 文件列表
| # | 文件 | 修改内容 |
|---|------|---------|
| 1 | `src/views/ProvidersView.vue` | `.provider-card`: 统一 padding, border-radius, box-shadow；统一 `.btn` 样式；统一 `.action-btn` 样式 |
| 2 | `src/views/McpView.vue` | `.mcp-card`: 统一 border-radius, 加 box-shadow；统一 `.action-btn` 样式 |
| 3 | `src/views/SkillsView.vue` | `.skill-card`: 统一 border-radius；统一 `.action-btn` 样式 |
| 4 | `src/components/AppSettingsMenu.vue` | `.settings-popup`: 将 `var(--radius)` 改为 `var(--radius-md)` |

### 不修改的内容
- 布局结构（grid 列数、gap、flex 排列等）
- 表单样式（Input、label 等非 checklist 范围）
- DsModal（已使用正确 token）
- 头像（已一致）

---

## 6. 验证

执行 `tsc --noEmit` 验证 TypeScript 编译无报错。
