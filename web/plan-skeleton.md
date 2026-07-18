# Plan: 消息流式骨架屏 + 增强空状态体验

## 概述

在 `ChatWindow.vue` 中添加消息流式加载时的骨架屏占位，并增强空状态（`#empty` 模板）的视觉动效。

## 涉及文件

| 文件 | 操作 |
|------|------|
| `D:/Maxma/MaxmaHere/web/src/components/ChatWindow.vue` | 修改（模板 + script + style） |

`WelcomeScreen.vue` 不修改（47 行内容较少，暂不动）。

---

## 修改 1：添加 `showSkeleton` computed 属性

**位置**：`<script setup>` 区域，紧邻现有的 `showTypingIndicator`（约第 347 行）。

```ts
const showSkeleton = computed(() =>
  Boolean(props.currentTurn) && !currentTurnHasVisibleActivity.value
)
```

**逻辑说明**：
- 当 `currentTurn` 存在（即正在流式生成）且 **没有任何可见活动**（无事件、无 finalAnswer）时显示骨架屏。
- 与 `showTypingIndicator` 的区别：`showTypingIndicator` 额外要求 `typingDelayElapsed` 为 true（有 1.5-3.5s 延迟），骨架屏**立即显示**，覆盖从用户发送消息到首个事件出现之间的空白期。
- 当可见活动出现后，骨架屏自动隐藏（`currentTurnHasVisibleActivity` 变为 true）。

---

## 修改 2：在模板 (`#after`) 中添加骨架屏元素

**位置**：`<template #after>` 内部，放在错误横幅之后、打字指示器之前（约第 177 行）。

```vue
<!-- 骨架屏：流式加载占位 -->
<div v-if="showSkeleton" class="message-skeleton" aria-label="AI 正在生成回复">
  <div class="skeleton-avatar"></div>
  <div class="skeleton-lines">
    <div class="skeleton-line skeleton-line--1"></div>
    <div class="skeleton-line skeleton-line--2"></div>
    <div class="skeleton-line skeleton-line--3 skeleton-line--short"></div>
  </div>
</div>
```

**说明**：
- 放在 `#after` 中，位于消息列表底部，与 `typing-indicator` 同级。
- `aria-label` 提供无障碍支持。
- 骨架屏和打字指示器可以同时存在（打字指示器是文字提示，骨架屏是视觉占位），但在实际场景中打字指示器出现时骨架屏可能已经被内容替换。

---

## 修改 3：添加骨架屏 CSS 样式

**位置**：`<style scoped>` 中，放在 typing-indicator 样式块之后（约第 1070 行）。

```css
/* ── 消息骨架屏：流式加载占位 ── */
.message-skeleton {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  align-items: flex-start;
}

.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-card);
  flex-shrink: 0;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-card);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-line--1 { width: 85%; }
.skeleton-line--2 { width: 70%; }
.skeleton-line--3 { width: 45%; }

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
```

**设计要点**：
- 使用 `var(--bg-card)` 作为骨架颜色，在明/暗主题下自动适配。
- 圆形头像 + 3 条文字占位线，模拟助手消息布局。
- `skeleton-pulse` 呼吸动画，纯 CSS 驱动。
- 线条宽度递减（85% / 70% / 45%），模拟自然文本长度。

---

## 修改 4：增强空状态动画

**位置**：`<style scoped>` 中 `.empty-desc` 附近（约第 725 行）。

添加一个微弱的上下浮动动画到 `.empty-desc`，让 Typewriter 文字更有活力：

```css
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

.empty-desc {
  /* 保留现有样式，追加： */
  animation: float 3s ease-in-out infinite;
}
```

**说明**：
- `3s` 周期，每次浮动 `4px`，非常克制，不会分散注意力。
- 仅作用于 `.empty-desc`（Typewriter 文字），不影响其他元素。

同时确保 Typewriter 光标颜色适配主题（当前已使用 `var(--text-secondary)`，无需修改）。

---

## 修改 5：更新 `prefers-reduced-motion`

**位置**：现有的 `@media (prefers-reduced-motion: reduce)` 块（约第 1072 行）。

追加：

```css
@media (prefers-reduced-motion: reduce) {
  /* ... 现有规则 ... */

  .message-skeleton,
  .skeleton-avatar,
  .skeleton-line {
    animation: none;
  }

  .empty-desc {
    animation: none;
  }
}
```

---

## 验证步骤

```bash
cd D:/Maxma/MaxmaHere/web
npx vue-tsc --noEmit
```

确认无类型错误后，运行 `pnpm dev` 进行视觉验证。

---

## 执行顺序

1. 在 `<script setup>` 中添加 `showSkeleton` computed
2. 在 `<template #after>` 中添加骨架屏 DOM
3. 在 `<style scoped>` 中添加骨架屏 CSS
4. 在 `.empty-desc` 添加浮动动画
5. 更新 `prefers-reduced-motion` 块
6. 运行类型检查验证
