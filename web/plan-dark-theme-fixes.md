# 暗色主题视觉适配修复计划

## 现状分析

### 主题系统
- `useTheme.ts` 管理主题，通过 `document.documentElement.setAttribute('data-theme', themeId)` 应用
- 暗色主题 ID: `midnight`, `midnight-contrast`（以及 `auto` 在系统暗色时解析为 `midnight`）
- 所有主题通过 CSS 变量（`[data-theme="..."]`）定义颜色值
- `useTheme()` 暴露 `isDark` computed 属性

### 背景图片
- `src/assets/images/brand/empty-bg-day.jpg` 和 `empty-bg-night.jpg` 均存在

---

## 问题 1：LeavesOverlay 暗色主题适配

**文件**: `src/components/LeavesOverlay.vue`

### 当前代码
- `.leaves-overlay`: `mix-blend-mode: multiply; opacity: 0.28`（第 59-60 行）
- `.leaves-compensation`: `background: rgba(255, 253, 247, 0.12)`（第 104 行）
- 暗色主题下 `multiply` 让深色背景更暗，暖白补偿层也不适合

### 修复方案

在 `<script setup>` 中引入 `useTheme()` 获取 `isDark`，动态绑定样式：

```typescript
import { useTheme } from '@/composables/useTheme'
const { isDark } = useTheme()
```

在模板中:

```vue
<div
  v-if="enabled"
  class="leaves-overlay"
  :style="overlayStyle"
  aria-hidden="true"
>
```

添加 computed:

```typescript
const overlayStyle = computed(() => ({
  mixBlendMode: isDark.value ? 'screen' as const : 'multiply' as const,
  opacity: isDark.value ? 0.12 : 0.28,
}))
```

补偿层动态化（第 11 行 + 第 104 行）:

```vue
<div
  class="leaves-compensation"
  :style="compensationStyle"
></div>
```

```typescript
const compensationStyle = computed(() => ({
  background: isDark.value
    ? 'rgba(0, 0, 0, 0.08)'
    : 'rgba(255, 253, 247, 0.12)',
}))
```

在 `<style scoped>` 中将 `.leaves-overlay` 的 `mix-blend-mode` 和 `opacity` 移到内联样式（移除 CSS 类中的静态声明）。

---

## 问题 2：ChatWindow 空状态背景适配

**文件**: `src/components/ChatWindow.vue`

### 当前代码
- `.empty-state` 使用 `background-image: url('@/assets/images/brand/empty-bg-day.jpg')`（第 675 行）
- `.empty-state-overlay` 使用 `rgba(255, 255, 255, 0.55)` 渐变（第 685 行）
- 暗色主题下白天图片过亮，白色叠加层也不合适

### 修复方案

在 `<script setup>` 中引入 `useTheme()`:

```typescript
import { useTheme } from '@/composables/useTheme'
const { isDark } = useTheme()
```

在 `.empty-state` 上添加动态 `:style` 绑定背景图片：

```vue
<div v-if="turns.length === 0 && !currentTurn" class="empty-state" :style="emptyStateStyle">
```

```typescript
const emptyStateStyle = computed(() => ({
  backgroundImage: `url(${isDark.value
    ? '@/assets/images/brand/empty-bg-night.jpg'
    : '@/assets/images/brand/empty-bg-day.jpg'
  })`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
}))
```

同时暗色主题下 overlay 改为深色渐变（从透明到半透明黑），让文字可读：

直接在 CSS 中添加 `[data-theme]` 作用域规则，或者在 `empty-state-overlay` 上也动态绑定：

```typescript
const overlayStyle = computed(() => ({
  background: isDark.value
    ? 'linear-gradient(to bottom, transparent 35%, rgba(0, 0, 0, 0.7) 100%)'
    : 'linear-gradient(to bottom, transparent 35%, rgba(255, 255, 255, 0.55) 100%)',
}))
```

**但更简洁的方案**：直接在 CSS 中利用 `data-theme` 属性选择器覆盖：

```css
[data-theme="midnight"] .empty-state,
[data-theme="midnight-contrast"] .empty-state {
  background-image: url('@/assets/images/brand/empty-bg-night.jpg');
}

[data-theme="midnight"] .empty-state-overlay,
[data-theme="midnight-contrast"] .empty-state-overlay {
  background: linear-gradient(to bottom, transparent 35%, rgba(0, 0, 0, 0.7) 100%);
}
```

**推荐方案**：使用 JS 动态绑定（和 LeavesOverlay 一致），因为：
1. `data-theme` 在 `<html>` 上，`<style scoped>` 中的属性选择器无法穿透到根元素——Vue scoped styles 会添加 data-v-xxx 属性，而 `[data-theme]` 选择器需要全局作用域
2. 使用 `useTheme().isDark` 是最可靠的方式，从 composable 层统一判断逻辑

---

## 修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/components/LeavesOverlay.vue` | template + script + style | 添加 `useTheme()`，动态绑定 overlay 和 compensation 样式 |
| `src/components/ChatWindow.vue` | template + script + style | 添加 `useTheme()`，动态绑定空状态背景和 overlay |

## 验证步骤
1. `npm run typecheck` 或 `vue-tsc --noEmit` 验证 TypeScript 编译
2. 手动切换暗色主题（midnight / midnight-contrast）检查 LeavesOverlay 在深色背景下的视觉效果
3. 切换回浅色主题确认回归
