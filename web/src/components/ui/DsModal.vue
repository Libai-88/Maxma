<!-- web/src/components/ui/DsModal.vue -->
<template>
  <DsOverlay
    :model-value="modelValue"
    :variant="backdrop"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <Transition
      :css="false"
      appear
      @before-enter="onBeforeEnter"
      @enter="onEnter"
      @leave="onLeave"
    >
      <div
        v-if="modelValue"
        ref="dialogRef"
        class="ds-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-describedby="describedby || undefined"
        tabindex="-1"
      >
        <h3 v-if="title" :id="titleId" class="ds-modal__title">{{ title }}</h3>
        <div class="ds-modal__body">
          <slot />
        </div>
        <div v-if="$slots.actions" class="ds-modal__actions">
          <slot name="actions" />
        </div>
      </div>
    </Transition>
  </DsOverlay>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import DsOverlay from './DsOverlay.vue'
import { gsap, useGsap } from '@/composables/useGsap'

withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  backdrop?: 'dim' | 'blur' | 'none'
  /** 透传 aria-describedby，指向额外描述元素的 id */
  describedby?: string
}>(), {
  backdrop: 'dim',
})

defineEmits<{ 'update:modelValue': [value: boolean] }>()

// 稳定的唯一 id（项目 vue ^3.4，未使用 useId；Math.random 已足够稳定）
const titleId = `ds-modal-title-${Math.random().toString(36).slice(2, 9)}`
const dialogRef = ref<HTMLElement | null>(null)

defineExpose({ dialogRef })

// ── 弹窗动画：scale 弹出 + 内容分层上浮（JS 过渡钩子，:css=false） ──
let onBeforeEnter = (_el: Element) => {}
let onEnter = (_el: Element, done: () => void) => done()
let onLeave = (_el: Element, done: () => void) => done()

useGsap((_ctx, contextSafe) => {
  function beforeEnter(el: Element) {
    gsap.set(el, { opacity: 0, scale: 0.95, y: 12 })
  }
  function enter(el: Element, done: () => void) {
    gsap.to(el, { opacity: 1, scale: 1, y: 0, duration: 0.22, ease: 'power3.out', onComplete: done })
    const node = el as HTMLElement
    const title = node.querySelector('.ds-modal__title')
    const body = node.querySelector('.ds-modal__body')
    const actions = node.querySelector('.ds-modal__actions')
    if (title) gsap.from(title, { opacity: 0, y: -6, duration: 0.2, ease: 'power2.out' })
    if (body) gsap.from(body, { opacity: 0, y: 6, duration: 0.2, ease: 'power2.out' })
    if (actions) gsap.from(actions, { opacity: 0, y: 6, duration: 0.2, ease: 'power2.out' })
  }
  function leave(el: Element, done: () => void) {
    gsap.to(el, { opacity: 0, scale: 0.96, y: 8, duration: 0.15, ease: 'power2.in', onComplete: done })
  }
  onBeforeEnter = contextSafe(beforeEnter)
  onEnter = contextSafe(enter)
  onLeave = contextSafe(leave)
})
</script>

<style scoped>
.ds-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 480px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* 模态内滚动链不外溢 */
  overscroll-behavior: contain;
  /* dialog 可作为焦点兜底，但不显示 outline */
  outline: none;
}
.ds-modal__title {
  margin: 0;
  padding: var(--space-4) var(--space-6);
  font-size: var(--fs-ui);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
}
.ds-modal__body {
  padding: var(--space-6);
  overflow-y: auto;
  flex: 1;
  overscroll-behavior: contain;
}
.ds-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border);
}

/* 弹窗动画由 GSAP JS 过渡钩子控制（:css=false） */
</style>
