# 计划：替换组件文件中的硬编码 CSS 值为主题变量

## 概述

在 `ChatWindow.vue`、`ChatView.vue`、`FloatSidebar.vue`、`HealthPanel.vue` 四个组件文件中，将符合设计 token 体系的硬编码值替换为 CSS 变量。

## 可用的 CSS 变量映射（来自 tokens.css + 主题文件）

| 类别 | 硬编码值 | 替换为 | 备注 |
|------|---------|--------|------|
| 圆角 | `border-radius: 4px` | `var(--radius-sm)` (5px) | 略微变化 4→5px，对齐设计系统 |
| 圆角 | `border-radius: 6px` | `var(--radius-input)` (6px) | 精确匹配 |
| 圆角 | `border-radius: 8px` | `var(--radius-md)` (8px) | 精确匹配 |
| 间距 | `8px` / `12px` / `16px` / `24px` / `32px` / `40px` | `--space-*` | 4px 网格体系 |
| 间距 | `4px` | `--space-4` | 精确匹配 |
| 字号 | `11px` | `var(--fs-hint)` (0.7rem) | 精确匹配 |
| 字号 | `12px` | `var(--fs-caption)` (0.78rem) | 精确匹配 |
| 字号 | `13px` | 保留 | 无精确 token 对应 |
| 字号 | `16px` | `var(--fs-title)` (1rem) | 语义上用于图标按钮，可替换 |
| 状态色 | `#22c55e` | `var(--status-ok)` | 成功状态 |
| 状态色 | `#b91c1c` | `var(--status-error)` | 错误状态 |
| 非标准变量 | `--bg-hover` | 改为 `--bg-secondary` | 不存在此变量 |
| 非标准变量 | `--accent-color` | 改为 `--accent` | 不存在此变量 |
| 无用 fallback | `var(--text-secondary, #666)` | `var(--text-secondary)` | fallback 多余 |

## 不替换的内容

1. **color-mix() 内部的颜色** — 如 `color-mix(in srgb, #f59e0b 10%, ...)` 保留不动
2. **布局固定尺寸** — 如 `width: 220px`、`max-width: 768px`、`height: 26px`、`min-width: 62px` 等
3. **动画关键帧内的值** — 如 `@keyframes` 中的数值
4. **无 token 对应的值** — 如 `10px`、`20px`、`0.9em`、`0.82em`、`0.8em` 等 em 字号
5. **元素固有尺寸** — 图标容器 `width: 48px; height: 48px;` 等

---

## 详细修改清单

### 1. ChatWindow.vue (D:\Maxma\MaxmaHere\web\src\components\ChatWindow.vue)

| # | 行号 | 当前值 | 替换为 | 说明 |
|---|------|--------|--------|------|
| 1 | 677 | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 系统事件气泡圆角 |
| 2 | 787 | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | kbd 标签圆角 |
| 3 | 832 | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 复制按钮圆角 |
| 4 | 856 | `color: #22c55e;` | `color: var(--status-ok);` | 复制成功图标色 |
| 5 | 1002 | `color: #22c55e;` | `color: var(--status-ok);` | 记忆检查勾号色 |
| 6 | 1006 | `color: #b91c1c;` | `color: var(--status-error);` | 记忆失败叉号色 |
| 7 | 1020 | `color: #b91c1c;` | `color: var(--status-error);` | 记忆状态错误色 |
| 8 | 1043 | `padding: 12px 16px;` | `padding: var(--space-12) var(--space-16);` | 打字指示器内边距 |
| 9 | 1044 | `margin: 8px 0;` | `margin: var(--space-8) 0;` | 打字指示器外边距 |
| 10 | 1089 | `gap: 12px;` | `gap: var(--space-12);` | 骨架屏间隙 |
| 11 | 1090 | `padding: 12px 24px;` | `padding: var(--space-12) var(--space-24);` | 骨架屏内边距 |
| 12 | 1110 | `border-radius: 6px;` | `border-radius: var(--radius-input);` | 骨架线圆角 |

### 2. ChatView.vue (D:\Maxma\MaxmaHere\web\src\views\ChatView.vue)

| # | 行号 | 当前值 | 替换为 | 说明 |
|---|------|--------|--------|------|
| 13 | 343 | `padding: 4px 12px;` | `padding: var(--space-4) var(--space-12);` | toggle 按钮内边距 |
| 14 | 345 | `border-radius: 6px;` | `border-radius: var(--radius-input);` | toggle 按钮圆角 |
| 15 | 384 | `padding: 8px 12px;` | `padding: var(--space-8) var(--space-12);` | hover-card 内边距 |
| 16 | 387 | `border-radius: 8px;` | `border-radius: var(--radius-md);` | hover-card 圆角 |
| 17 | 488 | `padding: 24px;` | `padding: var(--space-24);` | no-provider-overlay 内边距 |
| 18 | 493 | `padding: 40px 32px;` | `padding: var(--space-40) var(--space-32);` | no-provider-card 内边距 |
| 19 | 505 | `margin: 0 auto 16px;` | `margin: 0 auto var(--space-16);` | 图标下边距 |
| 20 | 527 | `padding: 10px 24px;` | `padding: 10px var(--space-24);` | 按钮内边距 (24px 部分替换) |
| 21 | 531 | `border-radius: 8px;` | `border-radius: var(--radius-md);` | 按钮圆角 |
| 22 | 558 | `font-size: 16px;` | `font-size: var(--fs-title);` | 工作台按钮字号 |
| 23 | 559 | `color: var(--text-secondary, #666);` | `color: var(--text-secondary);` | 移除无用 fallback |
| 24 | 561 | `padding: 4px 8px;` | `padding: var(--space-4) var(--space-8);` | 工作台按钮内边距 |
| 25 | 562 | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 工作台按钮圆角 |
| 26 | 567 | `background: var(--bg-hover, #f0f0f0);` | `background: var(--bg-secondary);` | 修复非标准变量名 (--bg-hover 不存在) |
| 27 | 571 | `color: var(--accent-color, #1a73e8);` | `color: var(--accent);` | 修复非标准变量名 (--accent-color 不存在) |
| 28 | 575 | `color: var(--text-secondary, #999);` | `color: var(--text-secondary);` | 移除无用 fallback |
| 29 | 577 | `padding: 40px 16px;` | `padding: var(--space-40) var(--space-16);` | placeholder 内边距 |

### 3. FloatSidebar.vue (D:\Maxma\MaxmaHere\web\src\components\FloatSidebar.vue)

| # | 行号 | 当前值 | 替换为 | 说明 |
|---|------|--------|--------|------|
| 30 | 72 | `padding: 24px 20px;` | `padding: var(--space-24) 20px;` | 侧边栏内边距 (24px 部分替换，20px 无对应) |
| 31 | 75 | `gap: 16px;` | `gap: var(--space-16);` | flex 间隙 |
| 32 | 83 | `gap: 4px;` | `gap: var(--space-4);` | nav 项间隙 |
| 33 | 89 | `padding: 8px 12px;` | `padding: var(--space-8) var(--space-12);` | nav 项内边距 |

### 4. HealthPanel.vue (D:\Maxma\MaxmaHere\web\src\components\HealthPanel.vue)

| # | 行号 | 当前值 | 替换为 | 说明 |
|---|------|--------|--------|------|
| 34 | 82 | `font-size: 11px;` | `font-size: var(--fs-hint);` | 标题字号精确匹配 |
| 35 | 87 | `margin-bottom: 8px;` | `margin-bottom: var(--space-8);` | 标题下边距 |
| 36 | 124 | `background: var(--text-tertiary, #999);` | `background: var(--text-tertiary);` | 移除无用 fallback |
| 37 | 127 | `font-size: 12px;` | `font-size: var(--fs-caption);` | 标签字号精确匹配 |

---

## 执行顺序

1. ChatWindow.vue — 12 处修改
2. ChatView.vue — 17 处修改
3. FloatSidebar.vue — 4 处修改
4. HealthPanel.vue — 4 处修改
5. 运行 `npx vue-tsc --noEmit` 验证类型/样式无误

总计约 37 处替换。
