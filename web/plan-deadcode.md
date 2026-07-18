# Dead Code Cleanup Plan

## 调查结果

### 任务 1: 删除 `useSpring.ts`
- **文件**: `src/composables/useSpring.ts`
- **引用**: 无任何 `.vue` / `.ts` / `.tsx` 文件引用它（已通过 grep 确认）
- **操作**: ✅ **删除文件**

### 任务 2: 检查其他 composables

#### `useStickerPerformance.ts`
- **文件**: `src/composables/useStickerPerformance.ts`
- **引用**:
  - `src/components/StickerInline.vue` — 导入并使用 `useFPSMonitor` 和 `useStickerPerformance`
- **操作**: ❌ **保留**（被 `StickerInline.vue` 使用）

#### `useStickerSegments.ts`
- **文件**: `src/composables/useStickerSegments.ts`
- **引用**:
  - `src/components/ChatInput.vue`
  - `src/components/MessageBubble.vue`
  - `src/components/StickerInline.vue`
  - `src/components/StickerPreviewOverlay.vue`
  - `src/components/ThinkingBlock.vue`
- **操作**: ❌ **保留**（被 5 个组件使用）

### 任务 3: `useNightMode.ts` 简化

#### 发现
- **文件**: `src/composables/useNightMode.ts`
- **内容**: 兼容层，已完整委托给 `useTheme()`：
  - `useNightModeState()`: 返回 `{ isNightMode }`，其中 `isNightMode` 即 `useTheme().isDark`
  - `useNightModeClock()`: 返回更多字段但无人使用
- **唯一使用者**: `src/components/StickerInline.vue` — 仅使用 `useNightModeState()` 获取 `isNightMode`
- **`useTheme().isDark`**: 已是 `computed` 属性，可直接在 `StickerInline.vue` 中使用

#### 操作
1. 修改 `StickerInline.vue`:
   - 将 `import { useNightModeState } from '@/composables/useNightMode'` 改为 `import { useTheme } from '@/composables/useTheme'`
   - 将 `const { isNightMode } = useNightModeState()` 改为 `const { isDark } = useTheme()` 并重命名
   - 在 `<template>` 的 `shouldUsePoster` computed 中引用 `isDark` 代替 `isNightMode`
2. 删除 `src/composables/useNightMode.ts`

---

## 执行步骤（需确认）

1. 删除 `src/composables/useSpring.ts`
2. 修改 `src/components/StickerInline.vue` — 改用 `useTheme().isDark`
3. 删除 `src/composables/useNightMode.ts`
4. 运行 `npx vue-tsc --noEmit` 验证类型检查通过
