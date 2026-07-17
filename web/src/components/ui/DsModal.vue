<!-- web/src/components/ui/DsModal.vue -->
<template>
  <DsOverlay
    :model-value="modelValue"
    :variant="backdrop"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <Transition name="ds-modal" appear>
      <div v-if="modelValue" class="ds-modal">
        <h3 v-if="title" class="ds-modal__title">{{ title }}</h3>
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
import DsOverlay from './DsOverlay.vue'

withDefaults(defineProps<{
  modelValue: boolean
  title?: string
  backdrop?: 'dim' | 'blur' | 'none'
}>(), {
  backdrop: 'dim',
})

defineEmits<{ 'update:modelValue': [value: boolean] }>()
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
  transition: opacity var(--duration-instant) var(--ease-in);
}
.ds-modal-enter-from {
  opacity: 0;
  transform: scale(0.95) translateY(8px);
}
.ds-modal-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
