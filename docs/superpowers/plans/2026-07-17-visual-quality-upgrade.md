# 视觉品质升级计划（Agent 31 — 独占文件范围）

日期：2026-07-17
工作目录：`d:\Maxma\MaxmaHere\web`
独占文件：`WelcomeScreen.vue` / `ModelSelector.vue` / `PersonaCard.vue` / `ChatView.vue`(仅 emoji→SVG) / `App.vue`(仅分组+nbsp) / `assets/icons/`

## 0. redesign-existing-projects skill 关键指导原则

加载的 skill 识别的 generic AI patterns（与本次任务相关）：

- **Hardcoded `#000` / `#fff` 黑白翻转**：纯黑背景、纯黑 hover 是 AI 默认指纹，应改用主题 token（`var(--accent)` + `color-mix`）做主题感知 hover/active
- **Emoji 当作图标**：emoji 在不同系统渲染不一致，削弱品牌感；应替换为线性 SVG 图标集，统一 stroke-width
- **纯文本头像 / 占位符**：削弱人格化，应使用品牌资产图
- **平铺无分组的列表**：弹窗/菜单里 12 个同级 item 平铺是"信息无层级"的 AI 指纹；应加 section header 分组
- **`&nbsp;` 对齐**：用 nbsp 拉齐是脆弱的对齐方式，字号变化或换行就错位；应改用 flex + gap
- **Typography**：数字/上下文窗口应使用 `var(--font-mono)` + `tabular-nums`
- **Fix Priority**：颜色 token 化 > hover/active > 替换 generic 组件 > 排版打磨

## 1. 任务清单

### T1. 新增 SVG 图标文件

在 `web/src/assets/icons/` 下新增（线性 stroke 风格，1.5 stroke-width，24×24 viewBox，`currentColor`，与 Icon.vue 中 settings/sparkles/sticker 风格一致）：

| 文件 | 用途 | 替换的 emoji |
|------|------|-------------|
| `welcome/chat-bubble.svg` | WelcomeScreen "随便聊聊" | 💬 |
| `welcome/search.svg` | WelcomeScreen "帮我个忙" | 🔍 |
| `status/warning.svg` | ChatView 后端不可用警告 | ⚠️ |

`⚙️` 复用 Icon.vue 已注册的 `settings` 图标（齿轮），无需新增文件。
`🤖` 复用已存在的 `assets/icons/sidebar/model.svg`，通过 `?raw` import 引入 ModelSelector。

### T2. ModelSelector.vue

- 行 4：`<span class="model-icon">🤖</span>` → 用 `?raw` import `sidebar/model.svg`，`v-html` 渲染（仿 Icon.vue 模式，剥 `<?xml?>`）
- 行 76：`.model-item.active { background: #000; color: #fff; ... }` → `background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent);`
- 行 78：`.model-item.active .model-item-ctx { color: rgba(255,255,255,0.6) }` → `color: var(--text-tertiary)`
- 行 77：`.model-item-ctx { font-family: 'SF Mono', monospace }` → `font-family: var(--font-mono); font-variant-numeric: tabular-nums`

### T3. WelcomeScreen.vue

- 行 9-10：`💬 随便聊聊` / `🔍 帮我个忙` → 用 `?raw` import `welcome/chat-bubble.svg` / `welcome/search.svg`，按钮内放 `<span class="action-icon" v-html="...">` + 文本，flex 对齐
- 行 31：`.action-btn:hover { background: #000; color: #fff; border-color: #000 }` → `background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, var(--border))`
- 调整 `.action-btn` 为 `display: inline-flex; align-items: center; gap: 8px` 以容纳图标

### T4. PersonaCard.vue

- 行 5：`<div class="persona-avatar">{{ store.profile.avatar }} {{ store.profile.name }}</div>` → 用品牌头像图（`@/assets/images/brand/logo-companion-opt.jpg`）+ 名称，flex 布局
- 默认 avatar emoji `✦` 不再渲染（保留 store 字段不动，只改 UI 层）
- 头像圆形 48×48，object-fit: cover

### T5. ChatView.vue（仅 emoji→SVG）

- 行 6：`<div class="no-provider-icon">⚠️</div>` → `<div class="no-provider-icon" v-html="warningIconRaw"></div>`，`?raw` import `status/warning.svg`
- 行 17：`<div class="no-provider-icon">⚙️</div>` → `<Icon name="settings" :size="48" />`，import Icon 组件
- 不改任何 props、事件、逻辑
- `.no-provider-icon` 样式调整为 `color: var(--status-warn)` / `color: var(--text-tertiary)`，让 SVG 的 currentColor 生效；保留 font-size 兜底

### T6. App.vue（仅分组 + nbsp 对齐）

**nbsp 对齐改 flex+gap**（行 22-32, 36）：
- `<span class="nav-label">对话&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CHATTING</span>` → `<span class="nav-label"><span class="nav-zh">对话</span><span class="nav-en">CHATTING</span></span>`
- 同样处理 记忆/MEMORY、知识库/KB、活动/ACTIVITY、设置/SETTINGS
- `.nav-label` 改 `display: flex; align-items: baseline; gap: 8px; justify-content: space-between`（或固定 gap）
- `.nav-en` 加 `font-size: 0.75em; color: var(--text-tertiary); letter-spacing: 0.5px`

**设置弹窗分组**（行 42-68）：
按 section header 分 3 组：
- `扩展 EXTENSIONS`：模型 MODELS, MCP 服务, Skills & 宏, 人设 SOUL, 用户 USER
- `运维 OPERATIONS`：路径白名单, 拒止锚, 环境变量, 事件钩子, 隐私仪表盘, 运行指标, 审计日志
- `系统 SYSTEM`：外观 APPEARANCE

保留 `重新开始引导` 在分组之后、divider 之前（它是 onboarding action，不属于导航）。
保留 `导出错误日志 / 日志管理 / 重启服务` 在 divider 之后（action buttons，已是现状）。

新增样式：
- `.popup-section-header`：与 `.popup-header` 类似但更小，`padding: 8px 12px 4px; font-size: 0.7em; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.6px`
- `.popup-section + .popup-section { margin-top: 4px }`
- `.popup-section-divider`：`height: 1px; background: var(--border); margin: 4px 0`

## 2. 验证

- `cd d:\Maxma\MaxmaHere\web && npx vitest run`（47 个测试通过）
- `cd d:\Maxma\MaxmaHere\web && npx vue-tsc --noEmit`（类型检查通过）

## 3. 提交策略

按组件粒度提交，每个组件一次：
1. `feat(icons): add welcome/status SVG icons for emoji replacement`
2. `fix(model-selector): use theme tokens for active state, replace emoji with SVG`
3. `fix(welcome-screen): theme-aware hover, replace emoji with SVG icons`
4. `feat(persona-card): use brand avatar image instead of emoji`
5. `refactor(chat-view): replace warning/settings emoji with SVG icons`
6. `refactor(app): group settings popup into sections, replace nbsp alignment with flex`
