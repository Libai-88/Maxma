<!-- web/src/components/ui/DsModal.vue -->
<template>
  <DsOverlay
    :model-value="modelValue"
    :variant="backdrop"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <Transition name="ds-modal" appear>
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

.ds-modal-enter-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}
.ds-modal-leave-active {
  transition: opacity var(--duration-instant) var(--ease-out),
              transform var(--duration-instant) var(--ease-out);
}
.ds-modal-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(8px);
}
.ds-modal-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .ds-modal-enter-active,
  .ds-modal-leave-active {
    transition: opacity var(--duration-instant) linear;
  }
  .ds-modal-enter-from,
  .ds-modal-leave-to {
    transform: none;
  }
}
</style>
