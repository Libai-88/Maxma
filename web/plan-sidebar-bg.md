# 计划：侧边栏背景基于当前主题动态变化

## 现状分析

### 当前实现（App.vue 第 472-499 行）

```css
/* ::before — 模糊背景图 */
.sidebar::before {
  background-image: url('/images/sidebar-bg.jpg');
  filter: blur(10px);
  transform: scale(1.05);
}

/* ::after — 半透明纯色叠加层 */
.sidebar::after {
  background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
}
```

所有主题共享同一张 `sidebar-bg.jpg`，仅通过叠加层的 `--bg-primary` 颜色适应各主题。

### 可用背景图片

`public/images/` 下仅有一张图片：

| 文件 | 说明 |
|------|------|
| `sidebar-bg.jpg` | 暖色/自然风格，适合浅色主题 |

缺少一张适合深色主题的背景图（如深青蓝/雨夜氛围）。

### 主题分类

| 类别 | 主题 | 特点 |
|------|------|------|
| **浅色/暖色** | warm-paper (默认), contemplation, coral, delve, deep-think, absolutely, grass-aroma, high-contrast | `--bg-primary` 均为浅色，现有 sidebar-bg.jpg 适用 |
| **深色** | midnight, midnight-contrast | `--bg-primary` 为深青蓝/深灰，需要深色调背景图 |
| **特殊** | dawn | 已有自定义 `.sidebar` 样式（`backdrop-filter: blur(12px)` + `rgba` 背景），需单独评估 |

---

## 实施步骤

### Step 0: 创建深色主题专用背景图

用 Python/Pillow 在 `public/images/` 下生成 `sidebar-bg-dark.jpg`：
- 深青蓝到墨色的渐变，匹配 midnight 色调
- 尺寸与现有 sidebar-bg.jpg 一致
- 作为深色主题的 `--sidebar-bg-image` 值

### Step 1: 修改 App.vue

将 `.sidebar::before` 中的硬编码 `background-image` 替换为 CSS 变量：

```css
.sidebar::before {
  background-image: var(--sidebar-bg-image, url('/images/sidebar-bg.jpg'));
  /* 其余保持不变 */
}
```

将 `.sidebar::after` 的叠加层透明度从 85% 微调为 88%（按任务要求）：

```css
.sidebar::after {
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
}
```

### Step 2: 为各主题添加 `--sidebar-bg-image` 变量

| 主题文件 | `--sidebar-bg-image` 值 | 说明 |
|----------|------------------------|------|
| warm-paper.css | **(不设，用 fallback)** | 默认暖纸主题，现有图最搭 |
| contemplation.css | **(不设，用 fallback)** | 灰蓝调，现有图仍协调 |
| coral.css | **(不设，用 fallback)** | 暖色底，现有图可用 |
| delve.css | **(不设，用 fallback)** | 纯白冷调，无图更干净 |
| deep-think.css | **(不设，用 fallback)** | 干净白底，无图更干净 |
| absolutely.css | **(不设，用 fallback)** | 暖奶油底，现有图可用 |
| grass-aroma.css | **(不设，用 fallback)** | 青草绿调，现有图可用 |
| high-contrast.css | **(不设，用 fallback)** | 高对比浅色，保持简洁 |
| **midnight.css** | `url('/images/sidebar-bg-dark.jpg')` | 深色主题专用深色图 |
| **midnight-contrast.css** | `url('/images/sidebar-bg-dark.jpg')` | 深色主题专用深色图 |
| **dawn.css** | **(不设)** | 已有自定义 `.sidebar` 样式，不受影响 |

#### 关于 dawn 主题的特殊处理

dawn.css 已定义：
```css
[data-theme="dawn"] .sidebar {
  background: rgba(234, 245, 246, 0.7);
  backdrop-filter: blur(12px);
}
```

这通过 `backdrop-filter` 实现了另一种毛玻璃效果。由于 dawn 的 `.sidebar` 用了 `background` 而非 `::before`/`::after` 方案，`--sidebar-bg-image` 变量和 `::before`/`::after` 不会影响它。不需要额外修改。

### Step 3: 创建深色背景图

用 Python 生成 `public/images/sidebar-bg-dark.jpg`：
- 渐变方向：从左到右
- 颜色范围：深青蓝 `#2C3E50` → 深墨蓝 `#1A252F`
- 可叠加细微纹理噪点增加质感
- 尺寸：与现有图片一致

### 不涉及修改的文件

以下主题文件无需修改（不设置变量，走 fallback）：
- warm-paper.css
- contemplation.css
- coral.css
- delve.css
- deep-think.css
- absolutely.css
- grass-aroma.css
- high-contrast.css
- dawn.css

---

## 验证

1. 运行 `npx vue-tsc --noEmit` 确保无类型错误
2. 视觉检查各主题下侧边栏背景效果

---

## 变更文件清单

| 文件 | 操作 |
|------|------|
| `public/images/sidebar-bg-dark.jpg` | **新建** — 深色主题背景图 |
| `src/App.vue` | **修改** — 2 处 CSS 变更 |
| `src/themes/midnight.css` | **修改** — 添加 `--sidebar-bg-image` |
| `src/themes/midnight-contrast.css` | **修改** — 添加 `--sidebar-bg-image` |
