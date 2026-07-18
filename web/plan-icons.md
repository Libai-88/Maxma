# Plan: 统一 Maxma 图标艺术风格 — fill 属性审计与修复

## 审计结果

### 范围
总共 **56 个 SVG 文件**，分布在 `src/assets/icons/` 下 7 个子目录 + 根目录的 `logo.svg`。

### 结论：仅 `logo.svg` 需要修复

#### 55/56 个图标已正确使用 `currentColor`

| 类别 | 文件数 | fill 策略 |
|------|--------|-----------|
| `chat-input/` | 11 | 部分 `fill="currentColor"`（实心风格），部分 `fill="none"` + `stroke="currentColor"`（线性风格） |
| `context-menu/` | 3 | `fill="currentColor"`（实心风格） |
| `sidebar/` | 5 | `fill="currentColor"` 或 `fill="none"` + `stroke="currentColor"`（混合） |
| `status/` | 2 | `fill="none"` + `stroke="currentColor"`（线性风格） |
| `tools/` | 24 | `fill="none"` + `stroke="currentColor"`，少数 `fill="currentColor"` 点缀（如圆点） |
| `weather/` | 7 | `fill="none"` + `stroke="currentColor"`，少数 `fill="currentColor"` 点缀 |
| `welcome/` | 2 | `fill="none"` + `stroke="currentColor"`（线性风格） |
| **小计** | **55** | **全部使用 `currentColor`，零硬编码颜色** |

grep 验证：`grep -rn 'fill="[^n]'` 排除 `currentColor` 和 `none` 后无匹配项。

#### logo.svg — 需修复

**文件**: `src/assets/icons/logo.svg`

**问题**: `<svg>` 和 `<path>` 均**缺少 `fill` 属性**，SVG 默认渲染为黑色实心，不响应 CSS `color` / `currentColor`，导致深色主题下 logo 无法自动适配颜色。

**当前内容（单行压缩）**:
```xml
<?xml version="1.0" ?><svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M21.956,48.12,..."/></svg>
```

### Icon.vue 引用情况
- `Icon.vue` 通过 `?raw` 导入并注入内联 SVG，未引用 `logo.svg`（logo 通常在 header 等处单独渲染）
- `Icon.vue` 内联定义的两个图标（`settings`、`sticker`、`image`）已全部使用 `stroke="currentColor"` / `fill="none"`，无需修改

## 执行计划

### 步骤 1：修复 logo.svg
添加 `fill="currentColor"` 到 `<svg>` 标签，使 logo 继承父元素文本颜色。

变更：
```diff
- <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
+ <svg fill="currentColor" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
```

无需修改 `<path>`，因为 SVG 的 fill 会被子元素继承（path 无显式 fill 时）。

### 步骤 2：验证
运行 `npx vue-tsc --noEmit` 确保无类型错误。

### 步骤 3：确认摘要
打印修改文件列表和 diff。

## 约束
- 仅修改 SVG 文件，不触及 `.vue` / `.ts` / `.css`
- 不改变任何 path / 形状 / viewBox
- 只处理 `fill` 属性
