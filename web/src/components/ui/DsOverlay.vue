<!-- web/src/components/ui/DsOverlay.vue -->
<template>
  <Teleport to="body">
    <Transition name="ds-overlay" appear @after-enter="onAfterEnter" @after-leave="onAfterLeave">
      <div
        v-if="modelValue"
        ref="rootRef"
        class="ds-overlay"
        :class="[`ds-overlay--${variant}`, { 'ds-overlay--contained': contained }]"
        tabindex="-1"
        @click.self="onBackdropClick"
        @keydown.esc="onEsc"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  variant?: 'dim' | 'blur' | 'none'
  contained?: boolean
  closeOnEsc?: boolean
  closeOnBackdrop?: boolean
}>(), {
  variant: 'dim',
  contained: false,
  closeOnEsc: true,
  closeOnBackdrop: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const rootRef = ref<HTMLElement | null>(null)
let savedFocus: HTMLElement | null = null
let lastFocused: HTMLElement | null = null

/**
 * 选择器覆盖：a[href]、button:not([disabled])、input/select/textarea:not([disabled])、
 * [tabindex]:not([tabindex="-1"])、[contenteditable="true"]、summary、audio[controls]、video[controls]。
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  'summary',
  'audio[controls]',
  'video[controls]',
].join(',')

function getFocusable(): HTMLElement[] {
  if (!rootRef.value) return []
  const nodes = rootRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  return Array.from(nodes).filter((el) => {
    // 过滤不可见节点（display:none / visibility:hidden / 隐藏的 input[type=hidden]）
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    if (Number(el.getAttribute('tabindex')) < 0) return false
    return true
  })
}

function close() {
  emit('update:modelValue', false)
}

function onBackdropClick() {
  if (props.closeOnBackdrop) close()
}

function onEsc() {
  if (props.closeOnEsc) close()
}

/**
 * Tab 边界 wrap：当焦点在 first/last focusable 上按 Tab/Shift+Tab 时，循环到对端。
 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !rootRef.value) return
  const focusable = getFocusable()
  if (focusable.length === 0) {
    // 没有 focusable 时，把焦点锁在 root 自身
    e.preventDefault()
    rootRef.value.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey) {
    if (active === first || !rootRef.value.contains(active)) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (active === last || !rootRef.value.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }
}

/**
 * focusin 监听：捕获焦点逃逸（点击非 focusable 区域 / 脚本聚焦到外部），
 * 把焦点拉回 overlay 内部（优先 lastFocused，否则 first focusable，否则 root 自身）。
 */
function onFocusIn(e: FocusEvent) {
  if (!rootRef.value) return
  const target = e.target as HTMLElement | null
  if (target && rootRef.value.contains(target)) {
    lastFocused = target
    return
  }
  // 焦点逃逸：拉回
  const focusable = getFocusable()
  const restore = lastFocused && rootRef.value.contains(lastFocused)
    ? lastFocused
    : (focusable[0] ?? rootRef.value)
  // 避免无限循环：仅在 target 不等于 restore 时聚焦
  if (restore !== target) {
    restore.focus()
  }
}

function onAfterEnter() {
  savedFocus = document.activeElement as HTMLElement
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  nextTick(() => {
    if (!rootRef.value) return
    const focusable = getFocusable()
    const first = focusable[0] ?? rootRef.value
    first.focus()
    lastFocused = first
  })
}

function onAfterLeave() {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('focusin', onFocusIn, true)
  lastFocused = null
  if (savedFocus && typeof savedFocus.focus === 'function') {
    savedFocus.focus()
  }
  savedFocus = null
}

// 若 modelValue 在外部被设为 false 但未触发 Transition（如组件卸载），仍清理监听
watch(() => props.modelValue, (v) => {
  if (!v) {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('focusin', onFocusIn, true)
  }
})

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('focusin', onFocusIn, true)
})
</script>

<style scoped>
.ds-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-16);
  /* 防止模态内滚动链影响背景 */
  overscroll-behavior: contain;
  /* 自身可聚焦，用于焦点兜底 */
  outline: none;
}
.ds-overlay--contained {
  position: absolute;
}
.ds-overlay--dim {
  background: var(--overlay-medium);
}
.ds-overlay--blur {
  background: var(--overlay-light);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ds-overlay--none {
  background: transparent;
  pointer-events: none;
}
.ds-overlay--none > * {
  pointer-events: auto;
}

.ds-overlay-enter-active,
.ds-overlay-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}
.ds-overlay-enter-from,
.ds-overlay-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ds-overlay-enter-active,
  .ds-overlay-leave-active {
    transition: none;
  }
}
</style>
