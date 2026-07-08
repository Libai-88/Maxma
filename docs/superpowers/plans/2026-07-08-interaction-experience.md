# 交互体验增强 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 openhanako 的 5 大交互体验功能迁移到 Maxma：树阴光影氛围层、全屏媒体查看器、悬停滑入侧边栏、选区引用+浮动输入、全局快捷键 Quick Chat 弹窗，让桌面应用在细节交互上达到 openhanako 级别的精致度。

**Architecture:** 纯前端功能（Task 1-6）使用 Vue 3 Composable + CSS 变量 + 主题 token，与 Phase 1 主题系统无缝集成。Quick Chat（Task 7-8）需要 Tauri `tauri-plugin-global-shortcut` 插件 + 独立 Web 入口（Vite 多入口构建）。所有功能通过 `localStorage` 持久化用户偏好，通过 `prefers-reduced-motion` 尊重无障碍设置。

**Tech Stack:** Vue 3 + TypeScript + Pinia + 原生 CSS（主题变量）+ Tauri 2（global-shortcut 插件）+ Vite 多入口

---

## Scope Check

本 plan 覆盖 5 个独立子系统，按依赖关系和复杂度排序：

| 模块 | Task | 依赖 | 复杂度 | 纯前端 |
|------|------|------|--------|--------|
| LeavesOverlay 氛围层 | Task 1 | 无 | 低 | ✅ |
| MediaViewer 全屏查看器 | Task 2-3 | 无 | 中 | ✅ |
| Float Sidebar 悬停滑入 | Task 4 | useSidebar | 中 | ✅ |
| 选区引用+浮动输入 | Task 5-6 | ChatInput | 高 | ✅ |
| Quick Chat 全局快捷键 | Task 7-8 | Tauri 插件 | 高 | ❌ |

**建议执行顺序：** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。纯前端模块可独立提交，Quick Chat 需要 `cargo build` 验证。

---

## 文件结构

### 新建文件

| 文件路径 | 职责 |
|---------|------|
| `web/src/components/LeavesOverlay.vue` | 树阴光影氛围层（CSS 动画模拟，无需 mp4） |
| `web/src/composables/useMediaViewer.ts` | 媒体查看器全局状态（当前图片列表+索引+开关） |
| `web/src/composables/useMediaTransform.ts` | 图像变换 hook（缩放/拖拽/双击/键盘） |
| `web/src/components/MediaViewer.vue` | 全屏媒体查看器组件（2.5s 空闲淡出+键盘快捷键） |
| `web/src/composables/useFloatSidebar.ts` | 悬停滑入侧边栏 hook（200ms 防抖+enter/leave 互斥） |
| `web/src/components/FloatSidebar.vue` | 悬停滑入面板组件（退出动画） |
| `web/src/composables/useSelectionQuote.ts` | 选区引用 hook（selectionchange/mouseup 监听） |
| `web/src/utils/floatingPosition.ts` | 浮动定位算法（clamp+preferredPlacement+origin） |
| `web/src/components/QuotedSelectionCard.vue` | 已引用选区卡片（显示选中文本+删除按钮） |
| `web/src/quick-chat/main.ts` | Quick Chat 独立入口 |
| `web/src/quick-chat/QuickChatApp.vue` | Quick Chat 根组件（精简聊天界面） |
| `web/quick-chat.html` | Quick Chat HTML 入口 |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `web/src/App.vue` | 在根布局末尾添加 `<LeavesOverlay />` 和 `<MediaViewer />`；在 sidebar 折叠时添加 FloatSidebar 触发区 |
| `web/src/components/RenderMarkdown.vue` | 为 `<img>` 添加点击事件委托，触发 MediaViewer |
| `web/src/components/ChatInput.vue` | 添加选区引用卡片栏 + `quotedSelections` prop/event |
| `web/src/views/ChatView.vue` | 添加 SelectionQuote 监听 + 传递 quotedSelections 到 ChatInput |
| `web/vite.config.ts` | 添加 quick-chat 多入口配置 |
| `web/src/router/index.ts` | 无需改动（Quick Chat 是独立窗口） |
| `desktop/src-tauri/Cargo.toml` | 添加 `tauri-plugin-global-shortcut = "2"` |
| `desktop/src-tauri/src/main.rs` | 注册 global-shortcut 插件 + Quick Chat 窗口创建命令 |
| `desktop/src-tauri/tauri.conf.json` | 添加 quick-chat 窗口配置 + global-shortcut 权限 |
| `desktop/src-tauri/capabilities/default.json` | 添加 global-shortcut 权限声明 |

### 资源文件

LeavesOverlay 使用纯 CSS 动画（径向渐变 + blur + drift keyframes）模拟树阴光影，无需外部 mp4 资源，避免增大安装包和版权问题。

---

## Task 1: LeavesOverlay 树阴光影氛围层

**Files:**
- Create: `web/src/components/LeavesOverlay.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 创建 LeavesOverlay 组件**

```vue
<!-- web/src/components/LeavesOverlay.vue -->
<template>
  <div
    v-if="enabled"
    class="leaves-overlay"
    aria-hidden="true"
    @click="onToggle"
    title="点击切换树阴光影"
  >
    <div class="leaves-layer leaves-layer--1"></div>
    <div class="leaves-layer leaves-layer--2"></div>
    <div class="leaves-layer leaves-layer--3"></div>
    <div class="leaves-compensation"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const STORAGE_KEY = 'maxma.leaves_overlay'
const enabled = ref(true)

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) enabled.value = saved === 'true'
  } catch { /* noop */ }
})

function onToggle() {
  enabled.value = !enabled.value
  try { localStorage.setItem(STORAGE_KEY, String(enabled.value)) } catch { /* noop */ }
}
</script>

<style scoped>
.leaves-overlay {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  z-index: 0;
  mix-blend-mode: multiply;
  opacity: 0.28;
  cursor: pointer;
}

.leaves-layer {
  position: absolute;
  inset: -20%;
  background-repeat: no-repeat;
  background-size: 50% 50%;
  will-change: transform;
}

/* 第一层：大叶片光斑，缓慢漂移 */
.leaves-layer--1 {
  background-image:
    radial-gradient(ellipse 40% 30% at 20% 30%, rgba(80, 120, 70, 0.4) 0%, transparent 70%),
    radial-gradient(ellipse 35% 25% at 70% 60%, rgba(60, 100, 50, 0.35) 0%, transparent 70%),
    radial-gradient(ellipse 30% 20% at 50% 80%, rgba(70, 110, 60, 0.3) 0%, transparent 70%);
  filter: blur(8px);
  animation: leaves-drift-1 25s ease-in-out infinite alternate;
}

/* 第二层：中等光斑，不同速度漂移 */
.leaves-layer--2 {
  background-image:
    radial-gradient(ellipse 25% 20% at 80% 20%, rgba(90, 130, 75, 0.3) 0%, transparent 65%),
    radial-gradient(ellipse 20% 15% at 30% 70%, rgba(75, 115, 65, 0.25) 0%, transparent 65%),
    radial-gradient(ellipse 18% 12% at 60% 40%, rgba(85, 125, 70, 0.2) 0%, transparent 65%);
  filter: blur(6px);
  animation: leaves-drift-2 20s ease-in-out infinite alternate;
}

/* 第三层：小光斑，快速闪烁模拟风动 */
.leaves-layer--3 {
  background-image:
    radial-gradient(ellipse 15% 10% at 40% 50%, rgba(100, 140, 80, 0.25) 0%, transparent 60%),
    radial-gradient(ellipse 12% 8% at 75% 35%, rgba(80, 120, 65, 0.2) 0%, transparent 60%);
  filter: blur(4px);
  animation: leaves-drift-3 15s ease-in-out infinite alternate;
}

/* 亮度补偿层：在 multiply 混合下提亮画面 */
.leaves-compensation {
  position: absolute;
  inset: 0;
  background: rgba(255, 253, 247, 0.12);
  mix-blend-mode: normal;
  pointer-events: none;
}

@keyframes leaves-drift-1 {
  0% { transform: translate(0, 0) rotate(0deg); }
  100% { transform: translate(3%, 2%) rotate(2deg); }
}
@keyframes leaves-drift-2 {
  0% { transform: translate(0, 0) rotate(0deg); }
  100% { transform: translate(-2%, 3%) rotate(-1.5deg); }
}
@keyframes leaves-drift-3 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(1%, -1%) scale(1.05); }
  100% { transform: translate(-1%, 1%) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .leaves-layer { animation: none; }
}
</style>
```

- [ ] **Step 2: 在 App.vue 集成 LeavesOverlay**

在 `web/src/App.vue` 的 `<template>` 中，在 `</div>` （app-layout 闭合标签）前添加：

```vue
    <!-- 树阴光影氛围层 -->
    <LeavesOverlay />
  </div>
</template>
```

在 `<script setup>` 中添加导入：

```typescript
import LeavesOverlay from '@/components/LeavesOverlay.vue'
```

- [ ] **Step 3: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

Run: `cd web && npx vite build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 4: 手动验证**

Run: `cd web && npx vite` 然后浏览器打开 `http://localhost:5173`

验证：
1. 页面上能看到淡淡的绿色光斑漂移
2. 点击光影层可切换开关
3. 刷新后开关状态保持

- [ ] **Step 5: 提交**

```bash
cd web && git add src/components/LeavesOverlay.vue src/App.vue
git commit -m "feat: add LeavesOverlay ambient layer with CSS animated dappled light"
```

---

## Task 2: MediaViewer 状态管理 + 图像变换 Hook

**Files:**
- Create: `web/src/composables/useMediaViewer.ts`
- Create: `web/src/composables/useMediaTransform.ts`

- [ ] **Step 1: 创建 useMediaViewer composable**

```typescript
// web/src/composables/useMediaViewer.ts
import { ref, computed } from 'vue'

export interface MediaItem {
  src: string
  alt?: string
}

// 模块级状态（全局单例，所有组件共享）
const items = ref<MediaItem[]>([])
const currentIndex = ref(-1)
const isOpen = computed(() => currentIndex.value >= 0)
const currentItem = computed(() =>
  currentIndex.value >= 0 ? items.value[currentIndex.value] : null
)

function open(list: MediaItem[], startIndex = 0) {
  if (!list.length) return
  items.value = list
  currentIndex.value = Math.max(0, Math.min(startIndex, list.length - 1))
}

function close() {
  currentIndex.value = -1
}

function next() {
  if (currentIndex.value < items.value.length - 1) currentIndex.value++
}

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}

export function useMediaViewer() {
  return { items, currentIndex, isOpen, currentItem, open, close, next, prev }
}
```

- [ ] **Step 2: 创建 useMediaTransform hook**

```typescript
// web/src/composables/useMediaTransform.ts
import { ref, computed, onUnmounted } from 'vue'

interface Transform {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.5
const MAX_SCALE = 8
const WHEEL_SENSITIVITY = 0.002
const DRAG_THRESHOLD = 3

export function useMediaTransform() {
  const transform = ref<Transform>({ scale: 1, x: 0, y: 0 })
  const isDragging = ref(false)

  let dragStartX = 0
  let dragStartY = 0
  let dragStartTx = 0
  let dragStartTy = 0
  let hasMoved = false

  const transformStyle = computed(() =>
    `translate(${transform.value.x}px, ${transform.value.y}px) scale(${transform.value.scale})`
  )

  function reset() {
    transform.value = { scale: 1, x: 0, y: 0 }
  }

  /** 计算适应窗口的缩放比例 */
  function computeFitScale(naturalW: number, naturalH: number, viewW: number, viewH: number) {
    const scaleX = viewW / naturalW
    const scaleY = viewH / naturalH
    return Math.min(scaleX, scaleY, 1)
  }

  function setScale(scale: number) {
    transform.value.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  }

  /** 滚轮缩放，以鼠标位置为中心 */
  function onWheel(e: WheelEvent, containerEl: HTMLElement) {
    e.preventDefault()
    const delta = e.deltaY
    // factor = exp(-delta * sensitivity) → 向上滚 delta<0 → factor>1 放大
    const factor = Math.exp(-delta * WHEEL_SENSITIVITY)
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.value.scale * factor))

    // 以鼠标位置为缩放中心
    const rect = containerEl.getBoundingClientRect()
    const cx = e.clientX - rect.left - rect.width / 2
    const cy = e.clientY - rect.top - rect.height / 2

    const ratio = newScale / transform.value.scale
    transform.value.x = cx - (cx - transform.value.x) * ratio
    transform.value.y = cy - (cy - transform.value.y) * ratio
    transform.value.scale = newScale
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    isDragging.value = true
    hasMoved = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragStartTx = transform.value.x
    dragStartTy = transform.value.y
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging.value) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      hasMoved = true
    }
    transform.value.x = dragStartTx + dx
    transform.value.y = dragStartTy + dy
  }

  function onPointerUp(e: PointerEvent) {
    isDragging.value = false
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  /** 双击：在 fit 和 1x 之间切换 */
  function onDoubleClick(fitScale: number) {
    if (transform.value.scale > fitScale * 1.1) {
      reset()
    } else {
      transform.value = { scale: 1, x: 0, y: 0 }
    }
  }

  /** 键盘缩放 */
  function onKeyZoom(key: string) {
    if (key === '+' || key === '=') setScale(transform.value.scale * 1.2)
    else if (key === '-') setScale(transform.value.scale / 1.2)
    else if (key === '0') reset()
  }

  return {
    transform,
    isDragging,
    transformStyle,
    hasMoved: computed(() => hasMoved),
    reset,
    computeFitScale,
    setScale,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onKeyZoom,
  }
}
```

- [ ] **Step 3: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
cd web && git add src/composables/useMediaViewer.ts src/composables/useMediaTransform.ts
git commit -m "feat: add useMediaViewer state and useMediaTransform hook"
```

---

## Task 3: MediaViewer 组件 + RenderMarkdown 集成

**Files:**
- Create: `web/src/components/MediaViewer.vue`
- Modify: `web/src/components/RenderMarkdown.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 创建 MediaViewer 组件**

```vue
<!-- web/src/components/MediaViewer.vue -->
<template>
  <Teleport to="body">
    <Transition name="mv-fade">
      <div
        v-if="isOpen"
        class="mv-root"
        :class="{ 'mv-controls-hidden': controlsHidden }"
        @click="onBackdropClick"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @dblclick="onDoubleClick"
        tabindex="0"
        ref="rootRef"
      >
        <img
          v-if="currentItem"
          :src="currentItem.src"
          :alt="currentItem.alt || ''"
          class="mv-image"
          :style="{ transform: transformStyle, transition: isDragging ? 'none' : 'transform 0.1s ease-out' }"
          draggable="false"
          @click.stop
        />
        <!-- 控件栏 -->
        <div class="mv-controls" @click.stop>
          <button class="mv-btn" @click="prev" :disabled="currentIndex <= 0" title="上一张">‹</button>
          <span class="mv-counter">{{ currentIndex + 1 }} / {{ items.length }}</span>
          <button class="mv-btn" @click="next" :disabled="currentIndex >= items.length - 1" title="下一张">›</button>
          <div class="mv-divider"></div>
          <button class="mv-btn" @click="zoomOut" title="缩小 (−)">−</button>
          <button class="mv-btn" @click="resetView" title="重置 (0)">⊙</button>
          <button class="mv-btn" @click="zoomIn" title="放大 (+)">+</button>
          <div class="mv-divider"></div>
          <button class="mv-btn mv-close" @click="close" title="关闭 (Esc)">✕</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMediaViewer } from '@/composables/useMediaViewer'
import { useMediaTransform } from '@/composables/useMediaTransform'

const { isOpen, currentItem, items, currentIndex, close, next, prev } = useMediaViewer()
const { transform, transformStyle, isDragging, reset, computeFitScale, setScale, onWheel: doWheel, onPointerDown: doPointerDown, onPointerMove: doPointerMove, onPointerUp: doPointerUp, onDoubleClick: doDoubleClick, onKeyZoom } = useMediaTransform()

const rootRef = ref<HTMLElement | null>(null)
const controlsHidden = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | null = null

function showControls() {
  controlsHidden.value = false
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { controlsHidden.value = true }, 2500)
}

function onWheel(e: WheelEvent) {
  if (rootRef.value) doWheel(e, rootRef.value)
  showControls()
}
function onPointerDown(e: PointerEvent) { doPointerDown(e); showControls() }
function onPointerMove(e: PointerEvent) { doPointerMove(e); showControls() }
function onPointerUp(e: PointerEvent) { doPointerUp(e) }
function onDoubleClick() {
  const img = rootRef.value?.querySelector('img')
  if (img) {
    const fitScale = computeFitScale(img.naturalWidth, img.naturalHeight, window.innerWidth, window.innerHeight)
    doDoubleClick(fitScale)
  }
}

function onBackdropClick(e: MouseEvent) {
  // 点击背景（非图片、非控件）关闭
  if (e.target === e.currentTarget) close()
}

function zoomIn() { setScale(transform.value.scale * 1.2); showControls() }
function zoomOut() { setScale(transform.value.scale / 1.2); showControls() }
function resetView() { reset(); showControls() }

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  switch (e.key) {
    case 'Escape': close(); break
    case 'ArrowLeft': prev(); break
    case 'ArrowRight': next(); break
    case '+': case '=': zoomIn(); break
    case '-': zoomOut(); break
    case '0': resetView(); break
    default: onKeyZoom(e.key)
  }
  showControls()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (idleTimer) clearTimeout(idleTimer)
})

// 打开时重置变换 + 聚焦
watch(isOpen, (open) => {
  if (open) {
    reset()
    showControls()
    nextTick(() => rootRef.value?.focus())
  }
})

// 切换图片时重置变换
watch(currentIndex, () => reset())
</script>

<style scoped>
.mv-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  outline: none;
}
.mv-root:active { cursor: grabbing; }

.mv-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
  transform-origin: center center;
  will-change: transform;
}

.mv-controls {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(30, 30, 30, 0.85);
  border-radius: 100px;
  backdrop-filter: blur(12px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.mv-controls-hidden .mv-controls {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
  pointer-events: none;
}

.mv-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.2em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mv-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
.mv-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.mv-close { font-size: 1em; }

.mv-counter {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  min-width: 50px;
  text-align: center;
}

.mv-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 4px;
}

/* 过渡动画 */
.mv-fade-enter-active, .mv-fade-leave-active {
  transition: opacity 0.25s ease;
}
.mv-fade-enter-from, .mv-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .mv-controls { transition: none; }
  .mv-fade-enter-active, .mv-fade-leave-active { transition: none; }
}
</style>
```

- [ ] **Step 2: 修改 RenderMarkdown.vue 添加图片点击委托**

在 `web/src/components/RenderMarkdown.vue` 的 `<template>` 中，为 `.markdown-body` 添加 `@click` 委托：

```vue
<template>
  <HtmlSandbox v-if="useSandbox" :html="sandboxHtml" />
  <div v-else class="markdown-body" v-html="renderedHtml" @click="onImageClick"></div>
</template>
```

在 `<script setup>` 中添加：

```typescript
import { useMediaViewer } from '@/composables/useMediaViewer'

const { open } = useMediaViewer()

function onImageClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG') {
    e.preventDefault()
    const img = target as HTMLImageElement
    // 收集同一容器内所有图片，支持画廊切换
    const container = img.closest('.markdown-body')
    const allImgs = container ? Array.from(container.querySelectorAll('img')) : [img]
    const items = allImgs.map(im => ({ src: (im as HTMLImageElement).src, alt: (im as HTMLImageElement).alt }))
    const startIndex = allImgs.indexOf(img)
    open(items, startIndex)
  }
}
```

- [ ] **Step 3: 在 App.vue 集成 MediaViewer**

在 `web/src/App.vue` 的 `<template>` 中，在 `<LeavesOverlay />` 后添加：

```vue
    <!-- 全屏媒体查看器 -->
    <MediaViewer />
```

在 `<script setup>` 中添加导入：

```typescript
import MediaViewer from '@/components/MediaViewer.vue'
```

- [ ] **Step 4: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

Run: `cd web && npx vite build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 5: 手动验证**

Run: `cd web && npx vite`

验证：
1. 发送包含图片的消息（或粘贴图片 URL）
2. 点击 Markdown 中的图片 → 全屏打开
3. 滚轮缩放、拖拽平移、双击切换 fit/1x
4. 键盘 ←/→ 切换，+/-/0 缩放，Esc 关闭
5. 2.5s 不动后控件栏自动淡出

- [ ] **Step 6: 提交**

```bash
cd web && git add src/components/MediaViewer.vue src/components/RenderMarkdown.vue src/App.vue
git commit -m "feat: add full-screen MediaViewer with zoom/pan/keyboard shortcuts"
```

---

## Task 4: Float Sidebar 悬停滑入面板

**Files:**
- Create: `web/src/composables/useFloatSidebar.ts`
- Create: `web/src/components/FloatSidebar.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: 创建 useFloatSidebar hook**

```typescript
// web/src/composables/useFloatSidebar.ts
import { ref } from 'vue'

const HOVER_DELAY = 200 // ms

// 模块级定时器（enter/leave 互斥清除）
let _enterTimer: ReturnType<typeof setTimeout> | null = null
let _leaveTimer: ReturnType<typeof setTimeout> | null = null

const isVisible = ref(false)

function clearEnter() {
  if (_enterTimer) { clearTimeout(_enterTimer); _enterTimer = null }
}
function clearLeave() {
  if (_leaveTimer) { clearTimeout(_leaveTimer); _leaveTimer = null }
}

function onEnter() {
  // 进入时取消正在进行的 leave 延迟
  clearLeave()
  if (isVisible.value) return
  _enterTimer = setTimeout(() => {
    isVisible.value = true
    _enterTimer = null
  }, HOVER_DELAY)
}

function onLeave() {
  // 离开时取消正在进行的 enter 延迟
  clearEnter()
  if (!isVisible.value) return
  _leaveTimer = setTimeout(() => {
    isVisible.value = false
    _leaveTimer = null
  }, HOVER_DELAY)
}

function forceClose() {
  clearEnter()
  clearLeave()
  isVisible.value = false
}

export function useFloatSidebar() {
  return { isVisible, onEnter, onLeave, forceClose }
}
```

- [ ] **Step 2: 创建 FloatSidebar 组件**

```vue
<!-- web/src/components/FloatSidebar.vue -->
<template>
  <Transition name="float-sidebar">
    <div v-if="isVisible" class="float-sidebar" @mouseenter="onEnter" @mouseleave="onLeave">
      <!-- 复用主侧边栏的导航内容 -->
      <nav class="fs-nav">
        <router-link to="/" class="fs-nav-item" @click="forceClose">
          <Icon name="chat" :size="18" /> <span>对话</span>
        </router-link>
        <router-link to="/memory" class="fs-nav-item" @click="forceClose">
          <Icon name="memory" :size="18" /> <span>记忆</span>
        </router-link>
        <router-link to="/kb" class="fs-nav-item" @click="forceClose">
          <Icon name="memory" :size="18" /> <span>知识库</span>
        </router-link>
      </nav>
      <SessionSidebar
        :sessions="sessions"
        :active-id="sessionId"
        :session-statuses="allSessionStatuses"
        :collapsed="false"
        @create="createSession"
        @switch="onSwitch"
        @delete="deleteSession"
        @constify="onConstify"
        @unconstify="onUnconstify"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import SessionSidebar from '@/components/SessionSidebar.vue'
import { useFloatSidebar } from '@/composables/useFloatSidebar'
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const { isVisible, onEnter, onLeave, forceClose } = useFloatSidebar()

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { createSession, switchSession, deleteSession } = sessionStore

const chatStore = useChatStore()
const { allSessionStatuses } = storeToRefs(chatStore)

const router = useRouter()

function onSwitch(id: string) {
  switchSession(id)
  router.push('/')
  forceClose()
}

function onConstify(id: string, name: string) {
  if (name && name.trim()) sessionStore.constifySession(id, name.trim())
}

function onUnconstify(id: string) {
  if (window.confirm('确定取消固定此会话？')) sessionStore.unconstifySession(id)
}
</script>

<style scoped>
.float-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.fs-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fs-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9em;
  transition: background 0.15s, color 0.15s;
}
.fs-nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
.fs-nav-item.router-link-active {
  background: var(--bg-card);
  color: var(--accent);
  font-weight: 600;
}

/* 滑入/滑出动画 */
.float-sidebar-enter-active {
  animation: fs-slide-in 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.float-sidebar-leave-active {
  animation: fs-slide-out 0.2s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

@keyframes fs-slide-in {
  from { transform: translateX(-100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes fs-slide-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .float-sidebar-enter-active,
  .float-sidebar-leave-active { animation: none; }
}
</style>
```

- [ ] **Step 3: 在 App.vue 添加 FloatSidebar 触发区 + 组件**

在 `web/src/App.vue` 的 `<template>` 中，在 `<aside class="sidebar" ...>` 前添加触发条（仅折叠时显示）：

```vue
    <!-- 折叠时的悬停触发条 -->
    <div
      v-if="effectiveCollapsed"
      class="sidebar-hover-trigger"
      @mouseenter="onFloatSidebarEnter"
      @mouseleave="onFloatSidebarLeave"
    ></div>
```

在 `<main class="main">` 前添加 FloatSidebar 组件：

```vue
    <!-- 悬停滑入侧边栏 -->
    <FloatSidebar />
```

在 `<script setup>` 中添加：

```typescript
import FloatSidebar from '@/components/FloatSidebar.vue'
import { useFloatSidebar } from '@/composables/useFloatSidebar'

const { onEnter: onFloatSidebarEnter, onLeave: onFloatSidebarLeave } = useFloatSidebar()
```

在 `<style>` 中添加触发条样式：

```css
.sidebar-hover-trigger {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 8px;
  z-index: 140;
  cursor: default;
}
```

- [ ] **Step 4: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 5: 手动验证**

Run: `cd web && npx vite`

验证：
1. 点击侧边栏空白处折叠侧边栏
2. 鼠标移到屏幕最左边缘 8px 区域
3. 200ms 后 FloatSidebar 滑入
4. 鼠标移开，200ms 后滑出
5. 点击导航项后面板关闭并导航

- [ ] **Step 6: 提交**

```bash
cd web && git add src/composables/useFloatSidebar.ts src/components/FloatSidebar.vue src/App.vue
git commit -m "feat: add hover-triggered FloatSidebar with debounce enter/leave"
```

---

## Task 5: 选区引用 Hook + 浮动定位算法

**Files:**
- Create: `web/src/composables/useSelectionQuote.ts`
- Create: `web/src/utils/floatingPosition.ts`

- [ ] **Step 1: 创建 floatingPosition 工具**

```typescript
// web/src/utils/floatingPosition.ts

export interface PlacementRect {
  width: number
  height: number
}

export interface PlacementResult {
  left: number
  top: number
  origin: string // CSS transform-origin
}

const FLOATING_INPUT_WIDTH_RATIO = 2 / 9 // 视口宽度的 2/9
const VIEWPORT_PADDING = 16

/**
 * 智能定位浮动元素，确保不超出视口边界。
 * @param anchorRect 锚点（如选区）的 BoundingClientRect
 * @param elementSize 浮动元素的宽高
 * @param viewportW 视口宽度
 * @param viewportH 视口高度
 * @param preferredPlacement 优先方向 'top' | 'bottom' | 'right' | 'left'
 */
export function computeFloatingInputPosition(
  anchorRect: DOMRect,
  elementSize: PlacementRect,
  viewportW: number,
  viewportH: number,
  preferredPlacement: 'top' | 'bottom' | 'right' | 'left' = 'bottom',
): PlacementResult {
  const width = elementSize.width || viewportW * FLOATING_INPUT_WIDTH_RATIO
  const height = elementSize.height || 120

  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top + anchorRect.height / 2

  let left: number
  let top: number
  let origin: string

  switch (preferredPlacement) {
    case 'top':
      left = anchorCenterX - width / 2
      top = anchorRect.top - height - 8
      origin = 'center bottom'
      break
    case 'bottom':
      left = anchorCenterX - width / 2
      top = anchorRect.bottom + 8
      origin = 'center top'
      break
    case 'right':
      left = anchorRect.right + 8
      top = anchorCenterY - height / 2
      origin = 'left center'
      break
    case 'left':
      left = anchorRect.left - width - 8
      top = anchorCenterY - height / 2
      origin = 'right center'
      break
  }

  // clamp 到视口内
  left = Math.max(VIEWPORT_PADDING, Math.min(left, viewportW - width - VIEWPORT_PADDING))
  top = Math.max(VIEWPORT_PADDING, Math.min(top, viewportH - height - VIEWPORT_PADDING))

  // 如果 preferredPlacement 被截断，调整 origin
  if (preferredPlacement === 'top' && top > anchorRect.top - height) {
    origin = 'center top'
    top = anchorRect.bottom + 8
  }
  if (preferredPlacement === 'bottom' && top < anchorRect.bottom) {
    origin = 'center bottom'
    top = anchorRect.top - height - 8
  }

  return { left, top, origin }
}
```

- [ ] **Step 2: 创建 useSelectionQuote hook**

```typescript
// web/src/composables/useSelectionQuote.ts
import { ref, onMounted, onUnmounted } from 'vue'

export interface QuotedSelection {
  id: string
  text: string
  source: string // 来源标签（如 '用户' / 'AI' / '思考过程'）
  rect: { left: number; top: number; width: number; height: number }
}

export interface QuoteCandidate {
  text: string
  source: string
  rect: DOMRect
}

const quoteCandidate = ref<QuoteCandidate | null>(null)
const quotedSelections = ref<QuotedSelection[]>([])

let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null

function getSelectionSource(): string {
  // 通过 data-source 属性或最近的 cite-source 元素判断来源
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return '未知'
  const range = selection.getRangeAt(0)
  let node: Node | null = range.commonAncestorContainer
  while (node && node !== document.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      if (el.dataset?.source) return el.dataset.source
      // 从 cite-source 的 contextmenu data 推断
      const citeSource = el.closest?.('[data-source]')
      if (citeSource) return citeSource.getAttribute('data-source') || '未知'
    }
    node = node.parentNode
  }
  return '对话'
}

function checkSelection() {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    quoteCandidate.value = null
    return
  }

  const text = selection.toString().trim()
  if (text.length < 2) {
    quoteCandidate.value = null
    return
  }

  // 确保选区在对话区域内
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const chatWindow = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)
    ?.closest('.chat-window, .messages-list')
  if (!chatWindow) {
    quoteCandidate.value = null
    return
  }

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    quoteCandidate.value = null
    return
  }

  quoteCandidate.value = {
    text,
    source: getSelectionSource(),
    rect,
  }
}

function onSelectionChange() {
  // 防抖：selectionchange 频繁触发
  if (selectionChangeTimer) clearTimeout(selectionChangeTimer)
  selectionChangeTimer = setTimeout(checkSelection, 100)
}

function onMouseUp() {
  // mouseup 后稍等，确保 selection 已更新
  setTimeout(checkSelection, 10)
}

function commitCandidate(): boolean {
  if (!quoteCandidate.value) return false
  const c = quoteCandidate.value
  quotedSelections.value.push({
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: c.text,
    source: c.source,
    rect: { left: c.rect.left, top: c.rect.top, width: c.rect.width, height: c.rect.height },
  })
  // 清除选区
  window.getSelection()?.removeAllRanges()
  quoteCandidate.value = null
  return true
}

function removeQuote(id: string) {
  quotedSelections.value = quotedSelections.value.filter(q => q.id !== id)
}

function clearQuotes() {
  quotedSelections.value = []
}

export function useSelectionQuote() {
  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', onMouseUp)
  })
  onUnmounted(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('mouseup', onMouseUp)
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer)
  })

  return {
    quoteCandidate,
    quotedSelections,
    commitCandidate,
    removeQuote,
    clearQuotes,
  }
}
```

- [ ] **Step 3: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
cd web && git add src/composables/useSelectionQuote.ts src/utils/floatingPosition.ts
git commit -m "feat: add useSelectionQuote hook and floatingPosition algorithm"
```

---

## Task 6: 选区引用 UI + ChatInput 集成

**Files:**
- Create: `web/src/components/QuotedSelectionCard.vue`
- Modify: `web/src/components/ChatInput.vue`
- Modify: `web/src/views/ChatView.vue`

- [ ] **Step 1: 创建 QuotedSelectionCard 组件**

```vue
<!-- web/src/components/QuotedSelectionCard.vue -->
<template>
  <div class="quoted-card">
    <div class="quoted-card-header">
      <span class="quoted-source">{{ quote.source }}</span>
      <button class="quoted-remove" @click="$emit('remove')" title="移除引用">✕</button>
    </div>
    <div class="quoted-text">{{ quote.text }}</div>
  </div>
</template>

<script setup lang="ts">
import type { QuotedSelection } from '@/composables/useSelectionQuote'

defineProps<{ quote: QuotedSelection }>()
defineEmits<{ remove: [] }>()
</script>

<style scoped>
.quoted-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 6px 10px;
  max-width: 300px;
  font-size: 0.85em;
}

.quoted-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.quoted-source {
  font-size: 0.75em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.quoted-remove {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.9em;
  padding: 0 4px;
  border-radius: 3px;
}
.quoted-remove:hover {
  color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 10%, transparent);
}

.quoted-text {
  color: var(--text-secondary);
  line-height: 1.5;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
```

- [ ] **Step 2: 修改 ChatView.vue 添加选区引用监听**

在 `web/src/views/ChatView.vue` 的 `<script setup>` 中添加：

```typescript
import { useSelectionQuote } from '@/composables/useSelectionQuote'
import type { QuotedSelection } from '@/composables/useSelectionQuote'

const {
  quoteCandidate,
  quotedSelections,
  commitCandidate,
  removeQuote,
  clearQuotes,
} = useSelectionQuote()

// 发送时清空引用
function onSendWithQuotes(text: string, refs: ParsedRef[], providerId?: string, modelName?: string) {
  // 将选区引用作为 refs 的一部分传给后端
  const quoteRefs: ParsedRef[] = quotedSelections.value.map(q => ({
    type: 'selection' as any,
    label: q.source,
    preview: q.text,
  }))
  send(text, [...refs, ...quoteRefs], providerId, modelName)
  clearQuotes()
}
```

修改 `<ChatInput>` 的 `@send` 绑定：

```vue
    <ChatInput
      v-if="!isSubagent"
      ref="chatInputRef"
      :is-streaming="isStreaming"
      :disabled="false"
      :can-send="connected"
      :initial-provider-id="selectedProviderId"
      :initial-model-name="selectedModelName"
      :quoted-selections="quotedSelections"
      :quote-candidate="quoteCandidate"
      @send="onSendWithQuotes"
      @stop="cancel"
      @model-change="onModelChange"
      @commit-quote="commitCandidate"
      @remove-quote="removeQuote"
    />
```

- [ ] **Step 3: 修改 ChatInput.vue 接收 quotedSelections**

在 `web/src/components/ChatInput.vue` 的 `defineProps` 中添加：

```typescript
const props = withDefaults(defineProps<{
  // ...现有 props...
  quotedSelections?: QuotedSelection[]
  quoteCandidate?: QuoteCandidate | null
}>(), {
  // ...现有默认值...
  quotedSelections: () => [],
  quoteCandidate: null,
})
```

在 `defineEmits` 中添加：

```typescript
defineEmits<{
  // ...现有 emits...
  commitQuote: []
  removeQuote: [id: string]
}>()
```

在 `<script setup>` 中添加导入：

```typescript
import type { QuotedSelection, QuoteCandidate } from '@/composables/useSelectionQuote'
import QuotedSelectionCard from '@/components/QuotedSelectionCard.vue'
import { computeFloatingInputPosition } from '@/utils/floatingPosition'
```

在 template 中，`file-refs-bar` 后添加引用选区卡片栏和浮动引用按钮：

```vue
    <!-- 已引用选区卡片栏 -->
    <div v-if="quotedSelections.length" class="quoted-selections-bar">
      <QuotedSelectionCard
        v-for="q in quotedSelections"
        :key="q.id"
        :quote="q"
        @remove="$emit('removeQuote', q.id)"
      />
    </div>
```

在 template 末尾（`chat-input-wrapper` 闭合标签内）添加浮动引用按钮：

```vue
    <!-- 选区引用浮层 -->
    <Transition name="quote-pop">
      <button
        v-if="quoteCandidate"
        class="quote-float-btn"
        :style="quoteFloatStyle"
        @click="$emit('commitQuote')"
        title="引用选中文本"
      >
        + 引用
      </button>
    </Transition>
```

在 `<script setup>` 中添加定位计算：

```typescript
import { computed } from 'vue'

const quoteFloatStyle = computed(() => {
  if (!props.quoteCandidate) return {}
  const result = computeFloatingInputPosition(
    props.quoteCandidate.rect,
    { width: 100, height: 32 },
    window.innerWidth,
    window.innerHeight,
    'top',
  )
  return {
    left: `${result.left}px`,
    top: `${result.top}px`,
    transformOrigin: result.origin,
  }
})
```

在 `<style scoped>` 中添加样式：

```css
.quoted-selections-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
  margin-bottom: 4px;
}

.quote-float-btn {
  position: fixed;
  z-index: 300;
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: 100px;
  font-size: 0.8em;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  white-space: nowrap;
}
.quote-float-btn:hover {
  opacity: 0.9;
}

.quote-pop-enter-active {
  animation: quote-pop-in 0.15s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.quote-pop-leave-active {
  animation: quote-pop-in 0.1s reverse;
}
@keyframes quote-pop-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .quote-pop-enter-active,
  .quote-pop-leave-active { animation: none; }
}
```

- [ ] **Step 4: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -30`
Expected: 无新增错误

Run: `cd web && npx vite build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 5: 手动验证**

Run: `cd web && npx vite`

验证：
1. 在 AI 回复消息中选中一段文字
2. 选中后浮层出现"+ 引用"按钮
3. 点击引用按钮，选中文本变为卡片显示在输入框上方
4. 点击卡片 ✕ 可移除
5. 发送消息后卡片清空

- [ ] **Step 6: 提交**

```bash
cd web && git add src/components/QuotedSelectionCard.vue src/components/ChatInput.vue src/views/ChatView.vue
git commit -m "feat: add selection quote with floating action button and quoted cards"
```

---

## Task 7: Quick Chat Tauri 插件配置 + 窗口创建

**Files:**
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/src/main.rs`
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: 添加 global-shortcut 依赖到 Cargo.toml**

在 `desktop/src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
tauri-plugin-global-shortcut = "2"
```

- [ ] **Step 2: 添加 Quick Chat 窗口配置到 tauri.conf.json**

在 `desktop/src-tauri/tauri.conf.json` 的 `app.windows` 数组中添加第二个窗口：

```json
      {
        "label": "quick-chat",
        "title": "Quick Chat",
        "width": 480,
        "height": 640,
        "minWidth": 360,
        "minHeight": 480,
        "resizable": true,
        "center": false,
        "visible": false,
        "decorations": true,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "focus": true
      }
```

在 `bundle` 中无需额外配置（quick-chat.html 由 frontendDist 提供）。

- [ ] **Step 3: 添加 global-shortcut 权限到 capabilities**

检查 `desktop/src-tauri/capabilities/` 目录是否存在 `default.json`，如果存在则添加权限，不存在则创建：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main", "quick-chat"],
  "permissions": [
    "core:default",
    "shell:default",
    "shell:allow-execute",
    "http:default",
    "log:default",
    "single-instance:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister"
  ]
}
```

- [ ] **Step 4: 在 main.rs 注册插件和快捷键**

在 `desktop/src-tauri/src/main.rs` 中添加 global-shortcut 导入：

```rust
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState, GlobalShortcutExt};
```

在 `main()` 函数的 `tauri::Builder::default()` 链中，在 `.plugin(tauri_plugin_single_instance::init(...))` 后添加：

```rust
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space))
                .expect("Failed to create shortcut")
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("quick-chat") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // 居中显示并聚焦
                                let _ = window.center();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build()
        )
```

添加 Tauri 命令：切换 Quick Chat 窗口（供前端调用）：

```rust
/// Tauri 命令：切换 Quick Chat 窗口可见性
#[tauri::command]
fn toggle_quick_chat(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-chat") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
```

在 `.invoke_handler` 中注册新命令：

```rust
        .invoke_handler(tauri::generate_handler![select_path, get_api_port, toggle_quick_chat])
```

- [ ] **Step 5: 构建验证**

Run: `cd desktop/src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译通过，无错误

- [ ] **Step 6: 提交**

```bash
cd desktop/src-tauri
git add Cargo.toml src/main.rs tauri.conf.json capabilities/default.json
git commit -m "feat: add global-shortcut plugin and quick-chat window config"
```

---

## Task 8: Quick Chat 前端入口 + UI

**Files:**
- Create: `web/quick-chat.html`
- Create: `web/src/quick-chat/main.ts`
- Create: `web/src/quick-chat/QuickChatApp.vue`
- Modify: `web/vite.config.ts`

- [ ] **Step 1: 创建 quick-chat.html**

```html
<!-- web/quick-chat.html -->
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/src/assets/images/brand/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Quick Chat</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600&family=Inter:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/quick-chat/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: 创建 quick-chat/main.ts**

```typescript
// web/src/quick-chat/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import QuickChatApp from './QuickChatApp.vue'
import '@/assets/styles/tokens.css'
import '@/assets/styles/animations.css'
import '@/assets/styles/design-system.css'
import '@/themes/warm-paper.css'
import '@/themes/midnight.css'

// Quick Chat 默认使用 warm-paper 主题
document.documentElement.setAttribute('data-theme', 'warm-paper')

const app = createApp(QuickChatApp)
app.use(createPinia())
app.mount('#app')
```

- [ ] **Step 3: 创建 QuickChatApp.vue**

```vue
<!-- web/src/quick-chat/QuickChatApp.vue -->
<template>
  <div class="qc-app">
    <header class="qc-header">
      <img src="@/assets/images/brand/favicon.png" alt="MaxmaHere" class="qc-logo" />
      <span class="qc-title">Quick Chat</span>
      <button class="qc-close" @click="hideWindow" title="关闭">✕</button>
    </header>

    <div class="qc-messages" ref="messagesRef">
      <div v-if="!turns.length && !currentTurn" class="qc-empty">
        <p>Ctrl+Shift+Space 召唤</p>
        <p class="qc-empty-hint">快速提问，不中断主窗口工作</p>
      </div>
      <template v-for="turn in mergedTurns" :key="turn.id">
        <div class="qc-msg qc-msg--user">{{ turn.userMessage }}</div>
        <div v-if="turn.finalAnswer" class="qc-msg qc-msg--assistant">
          <RenderMarkdown :content="turn.finalAnswer" :streaming="isStreaming" />
        </div>
      </template>
      <div v-if="showTyping" class="qc-typing">
        <span class="qc-typing-dot"></span>
        <span class="qc-typing-dot"></span>
        <span class="qc-typing-dot"></span>
      </div>
    </div>

    <div class="qc-input-area">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="qc-textarea"
        placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
        @keydown.enter.exact.prevent="onSend"
        :disabled="isStreaming"
      ></textarea>
      <button
        v-if="isStreaming"
        class="qc-stop-btn"
        @click="cancel"
      >停止</button>
    </div>

    <!-- 会话切换 -->
    <div class="qc-session-bar">
      <select v-model="selectedSessionId" class="qc-session-select" @change="onSessionChange">
        <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
          {{ s.name || s.session_id.slice(0, 8) }}
        </option>
      </select>
      <button class="qc-new-session" @click="createNewSession" title="新会话">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useChat } from '@/composables/useChat'
import { useSessionStore } from '@/stores/session'
import { storeToRefs } from 'pinia'
import RenderMarkdown from '@/components/RenderMarkdown.vue'

const sessionStore = useSessionStore()
const { sessions } = storeToRefs(sessionStore)

const selectedSessionId = ref('')
const inputText = ref('')
const messagesRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const {
  turns, currentTurn, isStreaming, send, cancel, showTyping,
} = useChat(selectedSessionId)

const mergedTurns = computed(() => {
  const list = [...turns.value]
  if (currentTurn.value) list.push(currentTurn.value)
  return list
})

async function onSend() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return
  inputText.value = ''
  await send(text, [])
  await nextTick()
  scrollToBottom()
}

function scrollToBottom() {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

function onSessionChange() {
  // useChat 会自动响应 selectedSessionId 变化
}

async function createNewSession() {
  await sessionStore.createSession()
  selectedSessionId.value = sessionStore.sessionId
}

async function hideWindow() {
  // 通过 Tauri invoke 隐藏窗口
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('toggle_quick_chat')
  } catch { /* 非 Tauri 环境忽略 */ }
}

// 监听消息变化，自动滚动到底部
watch([mergedTurns, () => isStreaming.value], () => {
  nextTick(scrollToBottom)
})

onMounted(async () => {
  await sessionStore.initIfNeeded()
  if (sessions.value.length) {
    selectedSessionId.value = sessions.value[0].session_id
  }
  // 聚焦输入框
  nextTick(() => textareaRef.value?.focus())
})
</script>

<style>
.qc-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  overflow: hidden;
}

.qc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
.qc-logo {
  width: 20px;
  height: 20px;
  border-radius: 50%;
}
.qc-title {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--accent);
  flex: 1;
}
.qc-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1em;
  padding: 4px 8px;
  border-radius: 4px;
  -webkit-app-region: no-drag;
}
.qc-close:hover { background: var(--bg-card); color: var(--status-error); }

.qc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  text-align: center;
}
.qc-empty p { margin: 4px 0; }
.qc-empty-hint { font-size: 0.8em; }

.qc-msg {
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 0.9em;
  line-height: 1.6;
  max-width: 90%;
  word-break: break-word;
}
.qc-msg--user {
  align-self: flex-end;
  background: var(--user-bubble, var(--accent));
  color: var(--bg-primary);
}
.qc-msg--assistant {
  align-self: flex-start;
  background: var(--bg-card);
  border: 1px solid var(--border);
}
.qc-msg--assistant :deep(.markdown-body) { font-size: 0.9em; }

.qc-typing {
  align-self: flex-start;
  display: flex;
  gap: 4px;
  padding: 8px 12px;
}
.qc-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: qc-dot 1.4s infinite ease-in-out;
}
.qc-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.qc-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes qc-dot {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.qc-input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.qc-textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.9em;
  padding: 8px;
  max-height: 120px;
  outline: none;
  transition: border-color 0.15s;
}
.qc-textarea:focus { border-color: var(--accent); }
.qc-textarea::placeholder { color: var(--text-tertiary); }

.qc-stop-btn {
  padding: 4px 12px;
  border: 1px solid var(--status-error);
  border-radius: var(--radius);
  background: transparent;
  color: var(--status-error);
  font-size: 0.8em;
  cursor: pointer;
  white-space: nowrap;
}
.qc-stop-btn:hover {
  background: color-mix(in srgb, var(--status-error) 10%, transparent);
}

.qc-session-bar {
  display: flex;
  gap: 4px;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.qc-session-select {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.8em;
  padding: 2px 4px;
  outline: none;
}
.qc-new-session {
  width: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1em;
}
.qc-new-session:hover { border-color: var(--accent); color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  .qc-typing-dot { animation: none; }
}
</style>
```

- [ ] **Step 4: 修改 vite.config.ts 添加多入口**

在 `web/vite.config.ts` 的 `build.rollupOptions` 中添加 `input`：

```typescript
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          'quick-chat': fileURLToPath(new URL('./quick-chat.html', import.meta.url)),
        },
        output: {
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router', 'vue-virtual-scroller'],
            'markdown-vendor': ['markdown-it', 'markdown-it-task-lists', 'markdown-it-texmath', 'katex'],
            'codemirror': [
              'codemirror',
              'vue-codemirror',
              '@codemirror/lang-markdown',
              '@codemirror/theme-one-dark',
            ],
          },
        },
      },
    },
```

- [ ] **Step 5: 构建验证**

Run: `cd web && npx vue-tsc --noEmit 2>&1 | head -20`
Expected: 无新增错误

Run: `cd web && npx vite build 2>&1 | tail -10`
Expected: 构建成功，输出包含 `quick-chat.html`

- [ ] **Step 6: Tauri 构建验证**

Run: `cd desktop/src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译通过

- [ ] **Step 7: 手动验证（开发模式）**

Run: `cd web && npx vite` 在浏览器打开 `http://localhost:5173/quick-chat.html`
验证 Quick Chat 页面能正常渲染

Run: `cd desktop && pnpm tauri dev`（或等效命令）
验证：
1. 按 `Ctrl+Shift+Space` 弹出 Quick Chat 窗口
2. 窗口居中显示，始终置顶
3. 输入消息，Enter 发送，能收到 AI 回复
4. 再次按快捷键或点击 ✕ 隐藏窗口
5. 切换会话下拉框可切换不同会话

- [ ] **Step 8: 提交**

```bash
cd web && git add quick-chat.html src/quick-chat/ vite.config.ts
cd ../desktop && git add src-tauri/  # 如果 main.rs 有额外改动
git commit -m "feat: add Quick Chat window with global shortcut Ctrl+Shift+Space"
```

---

## 完成后验证清单

- [ ] 所有 8 个 Task 的 git commit 已提交
- [ ] `cd web && npx vue-tsc --noEmit` 无错误
- [ ] `cd web && npx vite build` 构建成功
- [ ] `cd desktop/src-tauri && cargo check` 编译通过
- [ ] LeavesOverlay 树阴光影可切换
- [ ] MediaViewer 图片点击全屏 + 缩放 + 拖拽 + 键盘
- [ ] Float Sidebar 折叠时悬停滑入
- [ ] 选区引用：选中文字 → 引用按钮 → 卡片显示 → 发送
- [ ] Quick Chat: Ctrl+Shift+Space 全局唤起
- [ ] 所有功能在 warm-paper 和 midnight 主题下均正常显示
- [ ] `prefers-reduced-motion` 下动画被禁用
