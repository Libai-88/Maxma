# Plan: WelcomeScreen 入场动画 & 视觉增强

## 当前状态
`D:/Maxma/MaxmaHere/web/src/components/WelcomeScreen.vue` — 47 行，静态展示，无动画，按钮交互只有简单的背景变色 hover。

## 改动方案

### 1. 入场动画（stagger fade-in-up）
在 `<style scoped>` 末尾追加：
- `@keyframes welcome-fade-in`（opacity 0→1 + translateY(12px)→0）
- 每个子元素以 `0.15s` 递增 delay 播放：
  - `.welcome-avatar` → `0s`
  - `.welcome-name` → `0.15s`
  - `.welcome-scene` → `0.3s`
  - `.welcome-greeting` → `0.45s`
  - `.welcome-actions` → `0.6s`
- 包裹在 `@media (prefers-reduced-motion: no-preference)` 中
- 使用项目现有的 `--ease-out` token

### 2. 按钮交互增强
为 `.action-btn` 补充：
- `transition` 增加 `transform` 和 `box-shadow`
- `:hover` → `translateY(-1px)` + `box-shadow: 0 4px 12px var(--shadow-color)`
- `:active` → `scale(0.98)`
- `prefers-reduced-motion: reduce` 时跳过位移（由 animations.css 全局处理）

### 3. 字体切换适配
利用 `body.font-sans` 类，使 `.welcome-greeting` 和 `.welcome-name` 跟随用户字体偏好：
```css
.font-sans .welcome-name,
.font-sans .welcome-greeting {
  font-family: var(--font-ui);
}
```

### 4. 验证
运行 `npx vue-tsc --noEmit` 检查类型无误。

## 风险
- 全为 CSS 改动，无运行时逻辑变化
- `--font-ui` / `--shadow-color` / `--ease-out` 均已定义
- 项目已有 `animations.css` 处理 `prefers-reduced-motion: reduce` 的全局兜底，本组件再加一层细粒度控制
