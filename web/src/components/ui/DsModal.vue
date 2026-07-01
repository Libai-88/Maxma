<template>
  <Teleport to="body">
    <div v-if="modelValue" class="ds-modal-overlay" @click.self="$emit('update:modelValue', false)">
      <div class="ds-modal">
        <h3 v-if="title" class="ds-modal__title">{{ title }}</h3>
        <slot />
        <div v-if="$slots.actions" class="ds-modal__actions">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
  title?: string
}>()

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
