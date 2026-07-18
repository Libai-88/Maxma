# Plan: Hover/Active 交互动效与状态审计

## Audit Findings Summary

### 1. 按钮 hover 状态
**现状：** 大多数按钮有 hover 样式但缺少 `transform` 位移。
- `.ds-btn` (design-system.css:46-49): 仅有 `border-color` 和 `background` 变化，缺少 `translateY(-1px)`
- `.ds-btn--primary` (design-system.css:59-61): 仅有 `opacity: 0.9`，缺少向右上位移
- `.ds-btn--danger` (design-system.css:66-68): 仅有背景混合，缺少位移
- `.ds-btn--ghost` (DsButton.vue:72-76): 仅有背景变化
- `.ds-btn--subtle` (DsButton.vue:83-85): 仅有背景变化
- `.ds-btn--success` (DsButton.vue:92-94): 仅有 `opacity: 0.9`
- `.nav-item` (SessionSidebar.vue:527-529): 仅有背景变化
- `.btn-new` (SessionSidebar.vue:508-511): 有背景+颜色变化，无位移

### 2. Active/pressed 反馈
**现状：** 几乎全线缺失。
- 唯一例外：`.btn-send:active` 有 `transform: scale(0.95)` (ChatInput.vue:1719-1721)
- `.ds-btn` 及所有变体均无 `:active` 样式

### 3. 过渡时长
- `--duration-instant: 0.1s` (100ms) — 用于 hover/close/exit
- `--duration-fast: 0.15s` (150ms) — 用于按钮/面板/focus
- `--duration-slow: 0.25s` (250ms) — 用于模态/大块进场
- **结论：** 项目设计 token 有意使用 150ms 作为按钮过渡，虽低于 200ms 但符合"快速反馈"的 HIG 原则。**不做全局修改**，仅在 hover 过渡中添加 transform 属性。

### 4. 导航 active 状态
**现状：** `.nav-item.router-link-active` (App.vue:359-363) 有 `background: var(--bg-card)` + `color: var(--accent)` + `font-weight: 600`。
**问题：** hover 和 active 的背景色相同（都是 `var(--bg-card)`），导致 hover 时用户无法区分"悬浮中"和"已激活"。
**改进：** 在 active 项左侧增加 3px accent 色条（与 SessionItem 的 active 状态一致）。

---

## 修改清单（CSS only，不碰 template/script）

### A. `design-system.css` — 基础按钮动效增强

| 位置 | 修改内容 |
|------|----------|
| `.ds-btn` 增加 `transition` 中的 `transform` | 添加 `transform var(--duration-fast) var(--ease-out)` 到 transition list |
| `.ds-btn:hover` 增加 lift | 追加 `transform: translateY(-1px)` |
| `.ds-btn:active` **新增** | `transform: scale(0.98)` |
| `.ds-btn--primary:hover` 增强 | 追加 `transform: translateY(-1px)`，保持 `opacity: 0.9` |
| `.ds-btn--danger:hover` 增强 | 追加 `transform: translateY(-1px)` |
| `.ds-btn--ghost:hover`（DsButton.vue）增强 | 追加 `transform: translateY(-1px)` |
| `.ds-btn--subtle:hover`（DsButton.vue）增强 | 追加 `transform: translateY(-1px)` |
| `.ds-btn--success:hover`（DsButton.vue）增强 | 追加 `transform: translateY(-1px)` |

### B. `App.vue` — 导航 active 状态增强

| 位置 | 修改内容 |
|------|----------|
| `.nav-item.router-link-active` 增加左侧色条 | 追加 `::before` 伪元素：左侧 3px accent 色条（类似 SessionItem 的 active 样式） |

### C. `SessionSidebar.vue` — 工具按钮 hover 增强

| 位置 | 修改内容 |
|------|----------|
| `.nav-item:hover`（SessionSidebar 内） | 追加 `transform: translateY(-1px)` |
| `.btn-new:hover` | 追加 `transform: translateY(-1px)` |

### D. `prefers-reduced-motion` 保护

所有涉及 `transform` 的 hover/active 修改均使用以下结构包裹：
```css
@media (prefers-reduced-motion: no-preference) {
  /* transform 相关的动效 */
}
```
以保证无障碍用户不受影响。

已有 `animations.css` 末尾的全局 `prefers-reduced-motion: reduce` 规则会覆盖所有 transition duration，可作为第二层保护。

---

## 执行顺序

1. 修改 `design-system.css` — 基础按钮 hover lift + active scale
2. 修改 `DsButton.vue` (scoped style) — ghost/subtle/success 变体 hover lift
3. 修改 `App.vue` — 导航 active 状态增强
4. 修改 `SessionSidebar.vue` — nav-item 和 btn-new hover lift
5. `prefers-reduced-motion` 已由 `animations.css` 全局兜底，各文件内的 `@media` 块再局部保护 transform

## 验证方式

- TypeScript 编译检查：`npx vue-tsc --noEmit`（仅类型检查，不影响 CSS）
- 视觉验证：hover 按钮应有轻微上浮 + pressed 时有下沉效果
- active 导航项左侧应有色条
